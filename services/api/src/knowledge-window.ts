export type KnowledgeWindowMessage = { id: string; text: string };
export type RegenerationMessage = KnowledgeWindowMessage & { role: string };
export type ReusableConsolidation = { status: string; proposals: unknown[] };

export function shouldReuseConsolidation(run: ReusableConsolidation): boolean {
  return run.status === "generating" || run.status === "applying" || run.proposals.length > 0;
}

export function selectRegenerationContext<T extends RegenerationMessage>(
  messages: T[],
  assistantMessageId: string,
): { userMessage: T; assistantMessage: T; history: T[] } | null {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId);
  if (assistantIndex !== messages.length - 1 || messages[assistantIndex]?.role !== "brain") return null;
  const userMessage = messages[assistantIndex - 1];
  if (!userMessage || userMessage.role !== "user") return null;
  return {
    userMessage,
    assistantMessage: messages[assistantIndex],
    history: messages.slice(0, assistantIndex - 1),
  };
}

export function selectConsolidationWindow<T extends KnowledgeWindowMessage>(
  messages: T[],
  cursorId: string | null,
  maxMessages = 100,
  maxChars = 120_000,
): T[] {
  const cursorIndex = cursorId ? messages.findIndex((message) => message.id === cursorId) : -1;
  const pending = messages.slice(cursorIndex + 1);
  const selected: T[] = [];
  let characters = 0;
  for (const message of pending.slice(0, maxMessages)) {
    if (selected.length > 0 && characters + message.text.length > maxChars) break;
    selected.push(message);
    characters += message.text.length;
  }
  return selected;
}

export function proposalSyncComplete(
  kind: string,
  indexedTargetHash: string | null,
  expectedTargetHash: string,
  remainingSourceDocuments: number,
): boolean {
  const targetSynced = kind === "delete" ? indexedTargetHash === null : indexedTargetHash === expectedTargetHash;
  return targetSynced && remainingSourceDocuments === 0;
}
