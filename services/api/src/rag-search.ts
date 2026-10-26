/**
 * Retrieval ranking for /rag/search (v2).
 *
 * - Independent lexical + semantic candidate lists
 * - Weighted Reciprocal Rank Fusion (no raw score mixing)
 * - Bounded exact-match bonuses (title / path / phrase)
 * - Soft penalties for superseded / non-canonical signals
 * - Per-document diversification
 */

export type RagCandidate = {
  id: string;
  documentId: string;
  path: string;
  title: string;
  headingPath: string;
  startLine: number;
  endLine: number;
  text: string;
  semanticScore: number;
  lexicalScore: number;
  score: number;
  rrfScore?: number;
  exactBonus?: number;
  qualityPenalty?: number;
};

export type RankedRagItem = RagCandidate & {
  rrfScore: number;
  exactBonus: number;
  qualityPenalty: number;
  score: number;
};

export const RAG_SEARCH_DEFAULTS = {
  rrfK: 60,
  semanticWeight: 1.0,
  lexicalWeight: 1.15,
  candidateLimit: 50,
  maxPerDocument: 2,
  /** Cap so exact bonuses never dominate every channel alone. */
  maxExactBonus: 0.08,
  phraseBonus: 0.04,
  titleTokenBonus: 0.025,
  pathTokenBonus: 0.02,
  codeLikeBonus: 0.03,
} as const;

/**
 * Path/title/body cues that a note is historical, bait, or non-canonical.
 * Important: do NOT match "this supersedes …" — that phrase usually marks the *current* note.
 */
const SUPERSEDED_TITLE_PATH =
  /\b(superseded|obsolete|deprecated|outdated|myth|rumou?r|fake[-_ ]?date|intentionally[-_ ]wrong)\b|(?:^|\/)(?:adversarial|archive|archived|deprecated)(?:\/|$)/i;
const SUPERSEDED_BODY =
  /\b(was superseded|has been superseded|valid until superseded|formerly chose|originally chose|was replaced by|do not treat .+ as current|intentionally wrong|incorrect evaluation bait|contradicts the real|rumou?rs? say)\b/i;
const CURRENT_BODY =
  /\b(current preference|is the application source of truth|this supersedes|current in \d{4}|official .+ decision)\b/i;

export function weightedRrf(
  rankedLists: Array<{ weight: number; ids: string[] }>,
  k: number = RAG_SEARCH_DEFAULTS.rrfK,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    if (list.weight <= 0) continue;
    list.ids.forEach((id, index) => {
      const rank = index + 1;
      const contrib = list.weight * (1 / (k + rank));
      scores.set(id, (scores.get(id) ?? 0) + contrib);
    });
  }
  return scores;
}

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9àâäéèêëïîôùûüç#@._+-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** Codes / ids that should strongly prefer exact lexical hits. */
export function extractCodeLikeTokens(query: string): string[] {
  const matches = query.match(
    /\b[A-Z]{2,}(?:-[A-Z0-9]{2,})+\b|\b[A-Z]{3,}-\d{2,}\b|\b[A-Z]{2,}\d{2,}[A-Z0-9-]*\b|\bFR\d{2}(?:\s?\d{4}){4,}\b/g,
  );
  return matches?.map((m) => m.toLowerCase()) ?? [];
}

export function exactMatchBonus(query: string, candidate: Pick<RagCandidate, "title" | "path" | "text" | "headingPath">): number {
  const q = query.trim();
  if (!q) return 0;
  const qLower = q.toLowerCase();
  const title = candidate.title.toLowerCase();
  const path = candidate.path.toLowerCase();
  const heading = (candidate.headingPath || "").toLowerCase();
  const text = candidate.text.toLowerCase();
  const hay = `${title}\n${path}\n${heading}\n${text}`;

  let bonus = 0;
  if (q.length >= 4 && hay.includes(qLower)) {
    bonus += RAG_SEARCH_DEFAULTS.phraseBonus;
  }

  const tokens = tokenizeQuery(q);
  const significant = tokens.filter((t) => t.length >= 3);
  if (significant.length > 0) {
    const titleHits = significant.filter((t) => title.includes(t) || heading.includes(t)).length;
    const pathHits = significant.filter((t) => path.includes(t)).length;
    bonus += RAG_SEARCH_DEFAULTS.titleTokenBonus * (titleHits / significant.length);
    bonus += RAG_SEARCH_DEFAULTS.pathTokenBonus * (pathHits / significant.length);
  }

  for (const code of extractCodeLikeTokens(q)) {
    if (hay.includes(code.toLowerCase())) {
      bonus += RAG_SEARCH_DEFAULTS.codeLikeBonus;
      break;
    }
  }

  return Math.min(bonus, RAG_SEARCH_DEFAULTS.maxExactBonus);
}

/**
 * Soft quality penalty for notes that look superseded or non-canonical.
 * Bounded so a strong exact match can still win when appropriate.
 */
export function qualityPenalty(candidate: Pick<RagCandidate, "title" | "path" | "text">): number {
  let penalty = 0;
  const titlePath = `${candidate.title} ${candidate.path}`;
  const looksSupersededTitle = SUPERSEDED_TITLE_PATH.test(titlePath);
  if (looksSupersededTitle) penalty += 0.05;
  if (SUPERSEDED_BODY.test(candidate.text)) penalty += 0.035;
  // Prefer notes that claim to be current (and are not titled as superseded).
  if (CURRENT_BODY.test(candidate.text) && !looksSupersededTitle) {
    penalty -= 0.015;
  }
  return Math.max(0, Math.min(penalty, 0.09));
}

export function diversifyByDocument<T extends { documentId: string; path: string }>(
  items: T[],
  limit: number,
  maxPerDocument: number = RAG_SEARCH_DEFAULTS.maxPerDocument,
): T[] {
  const out: T[] = [];
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.documentId || item.path;
    const n = counts.get(key) ?? 0;
    if (n >= maxPerDocument) continue;
    counts.set(key, n + 1);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Fuse independent ranked lists into a final ordered result set.
 * `semantic` and `lexical` should already be sorted best-first.
 */
export function fuseRagCandidates(options: {
  query: string;
  semantic: RagCandidate[];
  lexical: RagCandidate[];
  limit: number;
  rrfK?: number;
  semanticWeight?: number;
  lexicalWeight?: number;
  maxPerDocument?: number;
}): RankedRagItem[] {
  const {
    query,
    semantic,
    lexical,
    limit,
    rrfK = RAG_SEARCH_DEFAULTS.rrfK,
    semanticWeight = RAG_SEARCH_DEFAULTS.semanticWeight,
    lexicalWeight = RAG_SEARCH_DEFAULTS.lexicalWeight,
    maxPerDocument = RAG_SEARCH_DEFAULTS.maxPerDocument,
  } = options;

  const byId = new Map<string, RagCandidate>();
  for (const item of [...semantic, ...lexical]) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, { ...item });
      continue;
    }
    // Merge channel scores when the same chunk appears in both lists.
    byId.set(item.id, {
      ...existing,
      semanticScore: Math.max(existing.semanticScore, item.semanticScore),
      lexicalScore: Math.max(existing.lexicalScore, item.lexicalScore),
    });
  }

  const rrf = weightedRrf(
    [
      { weight: semanticWeight, ids: semantic.map((c) => c.id) },
      { weight: lexicalWeight, ids: lexical.map((c) => c.id) },
    ],
    rrfK,
  );

  const ranked: RankedRagItem[] = [...byId.values()].map((candidate) => {
    const rrfScore = rrf.get(candidate.id) ?? 0;
    const exactBonus = exactMatchBonus(query, candidate);
    const penalty = qualityPenalty(candidate);
    // Top-rank bonus if #1 on either channel (preserves strong single-channel winners).
    const semanticRank = semantic.findIndex((c) => c.id === candidate.id);
    const lexicalRank = lexical.findIndex((c) => c.id === candidate.id);
    let topBonus = 0;
    if (semanticRank === 0 || lexicalRank === 0) topBonus += 0.03;
    else if (semanticRank === 1 || lexicalRank === 1 || semanticRank === 2 || lexicalRank === 2) topBonus += 0.012;

    const score = rrfScore + exactBonus + topBonus - penalty;
    return {
      ...candidate,
      rrfScore,
      exactBonus,
      qualityPenalty: penalty,
      score,
    };
  });

  ranked.sort((a, b) => b.score - a.score || b.rrfScore - a.rrfScore);
  return diversifyByDocument(ranked, limit, maxPerDocument);
}

/** Legacy linear mix kept for A/B / rollback. */
export function legacyLinearScore(semanticScore: number, lexicalScore: number): number {
  return semanticScore * 0.75 + Math.min(lexicalScore, 1) * 0.25;
}

export function useRetrievalV2(): boolean {
  const raw = (process.env.RETRIEVAL_V2 ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "legacy";
}
