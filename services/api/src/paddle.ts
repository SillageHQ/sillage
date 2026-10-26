import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);
export type PaddlePlanId = "personal" | "deep" | "archive";
export type PaddleBillingInterval = "monthly" | "yearly";

export function paddlePlanFromPriceId(priceId: string | null | undefined): PaddlePlanId | null {
  if (!priceId) return null;
  return (["personal", "deep", "archive"] as PaddlePlanId[]).find((plan) =>
    (["monthly", "yearly"] as PaddleBillingInterval[]).some((interval) => paddlePriceId(plan, interval) === priceId),
  ) ?? null;
}

export function paddleBillingIntervalFromPriceId(priceId: string | null | undefined): PaddleBillingInterval | null {
  if (!priceId) return null;
  return (["monthly", "yearly"] as PaddleBillingInterval[]).find((interval) =>
    (["personal", "deep", "archive"] as PaddlePlanId[]).some((plan) => paddlePriceId(plan, interval) === priceId),
  ) ?? null;
}

export function paddleNoteLimit(priceId: string | null | undefined) {
  return { personal: 500, deep: 2500, archive: 10000 }[paddlePlanFromPriceId(priceId) ?? "personal"];
}

export function paddlePriceId(plan: PaddlePlanId, interval: PaddleBillingInterval = "monthly") {
  const configured = interval === "yearly" ? {
    personal: process.env.PADDLE_PRICE_ID_PERSONAL_YEARLY,
    deep: process.env.PADDLE_PRICE_ID_DEEP_YEARLY,
    archive: process.env.PADDLE_PRICE_ID_ARCHIVE_YEARLY,
  }[plan] : {
    personal: process.env.PADDLE_PRICE_ID_PERSONAL || process.env.PADDLE_PRICE_ID,
    deep: process.env.PADDLE_PRICE_ID_DEEP,
    archive: process.env.PADDLE_PRICE_ID_ARCHIVE,
  }[plan];
  return configured?.trim() || null;
}

export function paddlePlanAvailability() {
  return (["monthly", "yearly"] as PaddleBillingInterval[]).reduce((availability, interval) => {
    availability[interval] = {
      personal: Boolean(paddlePriceId("personal", interval)),
      deep: Boolean(paddlePriceId("deep", interval)),
      archive: Boolean(paddlePriceId("archive", interval)),
    };
    return availability;
  }, {} as Record<PaddleBillingInterval, Record<PaddlePlanId, boolean>>);
}

function paddleApiBase() {
  return process.env.PADDLE_ENVIRONMENT === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
}

export function paddleConfigured(plan: PaddlePlanId = "personal", interval: PaddleBillingInterval = "monthly") {
  return Boolean(process.env.PADDLE_API_KEY && paddlePriceId(plan, interval) && process.env.PADDLE_WEBHOOK_SECRET);
}

export function paddleClientConfigured() {
  return Boolean(process.env.PADDLE_CLIENT_TOKEN && paddlePriceId("personal"));
}

export function hasActivePaddleSubscription(statuses: string[]) {
  return statuses.some((status) => ACTIVE_STATUSES.has(status));
}

export async function createPaddleTransaction(userId: string, plan: PaddlePlanId, interval: PaddleBillingInterval = "monthly") {
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  const priceId = paddlePriceId(plan, interval);
  if (!apiKey || !priceId) throw new Error("Paddle billing is not configured");
  const response = await fetch(`${paddleApiBase()}/transactions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      collection_mode: "automatic",
      custom_data: { sillage_user_id: userId },
    }),
  });
  const body = await response.json() as { data?: { id?: string }; error?: { detail?: string } };
  if (!response.ok || !body.data?.id) {
    throw new Error(body.error?.detail || `Paddle transaction failed (${response.status})`);
  }
  return body.data.id;
}

export async function cancelPaddleSubscription(subscriptionId: string) {
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  if (!apiKey) throw new Error("Paddle billing is not configured");
  const response = await fetch(`${paddleApiBase()}/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ effective_from: "next_billing_period" }),
  });
  const body = await response.json() as { data?: unknown; error?: { detail?: string } };
  if (!response.ok || !body.data) throw new Error(body.error?.detail || `Paddle cancellation failed (${response.status})`);
}

export function verifyPaddleWebhook(rawBody: string, signature: string, secret: string) {
  const fields = new Map(signature.split(";").map((part) => part.split("=", 2) as [string, string]));
  const timestamp = fields.get("ts");
  const received = fields.get("h1");
  if (!timestamp || !received || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(received, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

type PaddleEvent = {
  event_type?: string;
  data?: {
    id?: string;
    status?: string;
    customer_id?: string | null;
    subscription_id?: string | null;
    price_id?: string;
    items?: Array<{ price?: { id?: string } }>;
    next_billed_at?: string | null;
    scheduled_change?: { effective_at?: string | null } | null;
    custom_data?: { sillage_user_id?: string } | null;
  };
};

export async function handlePaddleWebhook(prisma: PrismaClient, event: PaddleEvent) {
  const data = event.data;
  if (!data) return;
  const userId = data.custom_data?.sillage_user_id;
  const subscriptionId = data.subscription_id || (event.event_type?.startsWith("subscription.") ? data.id : null);
  if (!subscriptionId) return;

  const existing = await prisma.paddleSubscription.findUnique({ where: { paddleSubscriptionId: subscriptionId } });
  const resolvedUserId = existing?.userId || userId;
  if (!resolvedUserId) return;
  const priceId = data.price_id || data.items?.[0]?.price?.id || process.env.PADDLE_PRICE_ID || "unknown";
  const status = event.event_type === "transaction.completed" ? "active" : (data.status || "unknown");
  const canceledAt = data.scheduled_change?.effective_at ? new Date(data.scheduled_change.effective_at) : null;
  await prisma.paddleSubscription.upsert({
    where: { paddleSubscriptionId: subscriptionId },
    create: {
      userId: resolvedUserId,
      paddleSubscriptionId: subscriptionId,
      paddleCustomerId: data.customer_id || null,
      priceId,
      status,
      nextBilledAt: data.next_billed_at ? new Date(data.next_billed_at) : null,
      canceledAt,
    },
    update: {
      paddleCustomerId: data.customer_id || undefined,
      priceId,
      status,
      nextBilledAt: data.next_billed_at ? new Date(data.next_billed_at) : null,
      canceledAt,
    },
  });
  const subscriptions = await prisma.paddleSubscription.findMany({ where: { userId: resolvedUserId }, select: { status: true } });
  await prisma.user.update({ where: { id: resolvedUserId }, data: { billingEnabled: hasActivePaddleSubscription(subscriptions.map((item) => item.status)) } });
}
