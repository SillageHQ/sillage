export type PricingPlanId = "personal" | "deep" | "archive";

export type PricingPlan = {
  id: PricingPlanId;
  name: string;
  notes: string;
  monthlyPrice: string;
  yearlyPrice: string;
  yearlySavings: string;
  noteLimit: number;
  description: string;
  features: string[];
  highlighted?: boolean;
};

export const pricingPlans: PricingPlan[] = [
  {
    id: "personal",
    name: "Personal",
    notes: "500 notes",
    monthlyPrice: "9.97",
    yearlyPrice: "99.70",
    yearlySavings: "19.94",
    noteLimit: 500,
    description: "A focused memory layer for your everyday notes.",
    features: ["30-day trial", "Contextual recall", "Desktop app access"],
  },
  {
    id: "deep",
    name: "Deep",
    notes: "2,500 notes",
    monthlyPrice: "19.97",
    yearlyPrice: "199.70",
    yearlySavings: "39.94",
    noteLimit: 2500,
    description: "More room for projects, research, and long-term thinking.",
    features: ["30-day trial", "Contextual recall", "Capture and resurfacing"],
    highlighted: true,
  },
  {
    id: "archive",
    name: "Archive",
    notes: "10,000 notes",
    monthlyPrice: "39.97",
    yearlyPrice: "399.70",
    yearlySavings: "79.94",
    noteLimit: 10000,
    description: "A deep, durable memory for a life of collected knowledge.",
    features: ["30-day trial", "Contextual recall", "Priority capacity"],
  },
];

export function PricingPlans({
  onSelect,
  interval = "monthly",
  onIntervalChange,
  selectedPlan,
  availablePlans,
  ctaLabel = "Start trial",
  activePlan,
}: {
  onSelect?: (plan: PricingPlanId) => void;
  interval?: "monthly" | "yearly";
  onIntervalChange?: (interval: "monthly" | "yearly") => void;
  selectedPlan?: PricingPlanId | null;
  availablePlans?: Partial<Record<PricingPlanId, boolean>>;
  ctaLabel?: string;
  activePlan?: PricingPlanId | null;
}) {
  return <>
    <div className="billing-interval-toggle" role="group" aria-label="Billing interval">
      <button type="button" className={interval === "monthly" ? "is-active" : ""} onClick={() => onIntervalChange?.("monthly")}>Monthly</button>
      <button type="button" className={`billing-interval-yearly${interval === "yearly" ? " is-active" : ""}`} onClick={() => onIntervalChange?.("yearly")}><strong>Yearly</strong> <span>2 MONTHS FREE</span></button>
    </div>
    <div className="pricing-plans">
    {pricingPlans.map((plan) => {
      const available = availablePlans?.[plan.id] ?? true;
      const selected = selectedPlan === plan.id;
      const active = activePlan === plan.id;
      return <article className={`pricing-card${plan.highlighted ? " is-highlighted" : ""}${selected ? " is-selected" : ""}${active ? " is-current" : ""}`} key={plan.id}>
        {plan.highlighted && <span className="pricing-card-badge">MOST POPULAR</span>}
        {active && <span className="pricing-card-current">CURRENT PLAN</span>}
        <p className="pricing-card-name">{plan.name}</p>
        <h3>{plan.notes}</h3>
        <p className="pricing-card-price"><strong>${interval === "yearly" ? plan.yearlyPrice : plan.monthlyPrice}</strong><span>{interval === "yearly" ? "/ year" : "/ month"}</span></p>
        {interval === "monthly" && <p className="pricing-card-yearly-hint">Billed yearly at ${plan.yearlyPrice}</p>}
        {interval === "yearly" && <p className="pricing-card-savings">2 MONTHS FREE · SAVE ${plan.yearlySavings}</p>}
        <p className="pricing-card-description">{plan.description}</p>
        <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
        {onSelect ? <button className="primary-button" disabled={!available || active} onClick={() => onSelect(plan.id)}>{active ? "Current plan" : available ? (activePlan ? "Upgrade" : ctaLabel) : "Coming soon"}</button> : <a className="primary-button" href="/sign-up">{ctaLabel}</a>}
      </article>;
    })}
    </div>
  </>;
}
