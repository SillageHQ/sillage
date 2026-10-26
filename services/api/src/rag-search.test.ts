import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diversifyByDocument,
  exactMatchBonus,
  fuseRagCandidates,
  qualityPenalty,
  weightedRrf,
  type RagCandidate,
} from "./rag-search.js";

function cand(partial: Partial<RagCandidate> & Pick<RagCandidate, "id" | "path" | "title" | "text">): RagCandidate {
  return {
    documentId: partial.documentId ?? partial.id,
    headingPath: partial.headingPath ?? "",
    startLine: partial.startLine ?? 1,
    endLine: partial.endLine ?? 1,
    semanticScore: partial.semanticScore ?? 0,
    lexicalScore: partial.lexicalScore ?? 0,
    score: partial.score ?? 0,
    ...partial,
  };
}

describe("weightedRrf", () => {
  it("ranks items that appear high in multiple lists higher", () => {
    const scores = weightedRrf(
      [
        { weight: 1, ids: ["a", "b", "c"] },
        { weight: 1, ids: ["b", "a", "d"] },
      ],
      60,
    );
    assert.ok((scores.get("b") ?? 0) > (scores.get("c") ?? 0));
    assert.ok((scores.get("a") ?? 0) > (scores.get("d") ?? 0));
  });

  it("applies list weights", () => {
    const scores = weightedRrf(
      [
        { weight: 2, ids: ["lex-only"] },
        { weight: 0.1, ids: ["sem-only"] },
      ],
      60,
    );
    assert.ok((scores.get("lex-only") ?? 0) > (scores.get("sem-only") ?? 0));
  });
});

describe("exactMatchBonus", () => {
  it("rewards title and code-like tokens", () => {
    const bonus = exactMatchBonus("ALPHA-LAUNCH-0915", {
      title: "Project Alpha",
      path: "__evaluation__/projects/alpha.md",
      headingPath: "Project Alpha",
      text: "Ticket: ALPHA-LAUNCH-0915. Launch September 15.",
    });
    assert.ok(bonus > 0.02);
  });

  it("caps the bonus", () => {
    const bonus = exactMatchBonus("Project Alpha September 15 ALPHA-LAUNCH-0915", {
      title: "Project Alpha September 15 ALPHA-LAUNCH-0915",
      path: "Project Alpha September 15 ALPHA-LAUNCH-0915.md",
      headingPath: "Project Alpha",
      text: "Project Alpha September 15 ALPHA-LAUNCH-0915 everywhere",
    });
    assert.ok(bonus <= 0.08);
  });
});

describe("qualityPenalty", () => {
  it("penalizes superseded and myth notes", () => {
    const bad = qualityPenalty({
      title: "Debt ratio myth",
      path: "__evaluation__/adversarial/debt-ratio-myth.md",
      text: "This note is intentionally wrong relative to the real public-debt note.",
    });
    const good = qualityPenalty({
      title: "Public debt",
      path: "__evaluation__/finance/public-debt.md",
      text: "Public debt sustainability depends on the interest-growth differential.",
    });
    assert.ok(bad > good);
    assert.ok(bad >= 0.04);
  });
});

describe("diversifyByDocument", () => {
  it("keeps at most N chunks per document", () => {
    const items = [
      { documentId: "d1", path: "a.md", id: "1" },
      { documentId: "d1", path: "a.md", id: "2" },
      { documentId: "d1", path: "a.md", id: "3" },
      { documentId: "d2", path: "b.md", id: "4" },
    ];
    const out = diversifyByDocument(items, 10, 2);
    assert.equal(out.length, 3);
    assert.equal(out.filter((i) => i.documentId === "d1").length, 2);
  });
});

describe("fuseRagCandidates", () => {
  it("prefers the real note over a high-semantic distractor", () => {
    const good = cand({
      id: "good",
      documentId: "doc-good",
      path: "__evaluation__/finance/public-debt.md",
      title: "Public debt",
      text: "Public debt sustainability depends on the interest-growth differential.",
      semanticScore: 0.72,
      lexicalScore: 0.4,
    });
    const bad = cand({
      id: "bad",
      documentId: "doc-bad",
      path: "__evaluation__/adversarial/debt-ratio-myth.md",
      title: "Debt ratio myth",
      text: "Some blogs claim debt sustainability only depends on absolute debt size. This note is intentionally wrong.",
      semanticScore: 0.88,
      lexicalScore: 0.05,
    });

    // Semantic ranks bad first; lexical ranks good first.
    const fused = fuseRagCandidates({
      query: "What controls public debt sustainability?",
      semantic: [bad, good],
      lexical: [good, bad],
      limit: 5,
    });

    assert.equal(fused[0]?.id, "good");
  });

  it("prefers current nutrition over superseded when both match", () => {
    const current = cand({
      id: "v2",
      documentId: "n2",
      path: "__evaluation__/health/nutrition-v2.md",
      title: "Nutrition preference v2",
      text: "Current preference: three regular meals. This supersedes the 2023 nutrition preference.",
      semanticScore: 0.8,
      lexicalScore: 0.3,
    });
    const old = cand({
      id: "v1",
      documentId: "n1",
      path: "__evaluation__/health/nutrition-v1.md",
      title: "Nutrition preference (2023, superseded)",
      text: "Prefer intermittent fasting 16:8. Valid until superseded in 2024.",
      semanticScore: 0.82,
      lexicalScore: 0.28,
    });

    const fused = fuseRagCandidates({
      query: "What is my current nutrition preference?",
      semantic: [old, current],
      lexical: [current, old],
      limit: 5,
    });

    assert.equal(fused[0]?.id, "v2");
    // "This supersedes" on the current note must not be treated as a penalty.
    assert.equal(qualityPenalty(current), 0);
    assert.ok(qualityPenalty(old) > 0);
  });

  it("returns empty when both channels are empty", () => {
    const fused = fuseRagCandidates({
      query: "anything",
      semantic: [],
      lexical: [],
      limit: 5,
    });
    assert.deepEqual(fused, []);
  });
});
