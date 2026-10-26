#!/usr/bin/env python3
"""Build the Phase 0 synthetic evaluation corpus (200+ categorized queries).

Run: python evaluation/build_rag_cases.py
Writes: evaluation/rag_cases.json
"""
from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).with_name("rag_cases.json")

# ---------------------------------------------------------------------------
# Documents — deterministic synthetic vault (never touches a real vault)
# ---------------------------------------------------------------------------

DOCUMENTS: list[dict] = [
    {
        "path": "__evaluation__/finance/public-debt.md",
        "title": "Public debt",
        "content": (
            "# Public debt\n\n"
            "Public debt sustainability depends on the interest-growth differential, "
            "the primary balance, and the maturity structure. A country can stabilize "
            "its debt ratio when nominal growth offsets financing costs.\n\n"
            "Code: DEBT-SUST-2024. Acronym: IGD (interest-growth differential)."
        ),
    },
    {
        "path": "__evaluation__/finance/emergency-fund.md",
        "title": "Emergency fund",
        "content": (
            "# Emergency fund\n\n"
            "Keep six months of essential expenses in liquid, low-risk accounts. "
            "Refill the emergency fund before increasing speculative investments.\n\n"
            "Target amount code: EF-6M-LIQUID."
        ),
    },
    {
        "path": "__evaluation__/finance/tax-id.md",
        "title": "Tax identifiers",
        "content": (
            "# Tax identifiers\n\n"
            "French personal tax number SIREN-DEMO-732849 is only for evaluation. "
            "VAT form FR-TVA-CA3 is filed quarterly. Quote: \"Always keep the original receipt.\"\n\n"
            "IBAN demo: FR76 ACCT-000035 7890 189."
        ),
    },
    {
        "path": "__evaluation__/projects/alpha.md",
        "title": "Project Alpha",
        "content": (
            "# Project Alpha\n\n"
            "The launch decision is September 15. The team chose a small private beta "
            "before public access, with Alice responsible for onboarding.\n\n"
            "Related: [[Alice]] [[Second Brain product]]\n"
            "Ticket: ALPHA-LAUNCH-0915."
        ),
    },
    {
        "path": "__evaluation__/projects/alpha-postmortem.md",
        "title": "Alpha postmortem",
        "content": (
            "# Alpha postmortem\n\n"
            "After launch, onboarding drop-off was 40% at the second screen. Alice "
            "proposed a single-step welcome flow. Decision owner: Alice. "
            "Linked project: [[Project Alpha]]."
        ),
    },
    {
        "path": "__evaluation__/projects/second-brain.md",
        "title": "Second Brain product",
        "content": (
            "# Second Brain\n\n"
            "The product should keep Obsidian as the source of truth. Assistant answers "
            "become personal knowledge only after explicit user review and vault write.\n\n"
            "Stack acronym: ORAG (Obsidian Retrieval Augmented Graph)."
        ),
    },
    {
        "path": "__evaluation__/projects/beta-rename.md",
        "title": "Product rename history",
        "content": (
            "# Product rename history\n\n"
            "2024-01: codename Nightjar.\n"
            "2024-06: renamed to Second Brain for user testing.\n"
            "2025-01: brand Sillage adopted publicly while vault paths stay Second Brain."
        ),
    },
    {
        "path": "__evaluation__/health/sleep.md",
        "title": "Sleep routine",
        "content": (
            "# Sleep routine\n\n"
            "Stop caffeine after 2 PM, dim screens one hour before bed, and keep the "
            "bedroom cool. The target is eight hours with a consistent wake time."
        ),
    },
    {
        "path": "__evaluation__/health/running.md",
        "title": "Running plan",
        "content": (
            "# Running plan\n\n"
            "Run three times per week: one easy session, one interval session, and one "
            "long slow run. Increase weekly distance by no more than ten percent."
        ),
    },
    {
        "path": "__evaluation__/health/nutrition-v1.md",
        "title": "Nutrition preference v1",
        "content": (
            "# Nutrition preference (2023)\n\n"
            "Prefer high-protein breakfasts and intermittent fasting 16:8. "
            "Avoid dairy on weekdays. Valid until superseded in 2024."
        ),
    },
    {
        "path": "__evaluation__/health/nutrition-v2.md",
        "title": "Nutrition preference v2",
        "content": (
            "# Nutrition preference (2024)\n\n"
            "Current preference: three regular meals, no intermittent fasting. "
            "Dairy is fine. This supersedes the 2023 nutrition preference."
        ),
    },
    {
        "path": "__evaluation__/books/library.md",
        "title": "Reading list",
        "content": (
            "# Reading list\n\n"
            "The library includes Thinking in Systems by Donella Meadows, "
            "The Beginning of Infinity by David Deutsch, and "
            "The Design of Everyday Things by Don Norman."
        ),
    },
    {
        "path": "__evaluation__/preferences/writing.md",
        "title": "Writing preferences",
        "content": (
            "# Writing preferences\n\n"
            "Prefer concise prose, concrete examples, and short paragraphs. "
            "Avoid inflated introductions and excessive headings."
        ),
    },
    {
        "path": "__evaluation__/preferences/language.md",
        "title": "Language preferences",
        "content": (
            "# Language preferences\n\n"
            "Répondre en français par défaut. Utiliser un ton direct et concret. "
            "Acronyme interne: FR-DEFAULT-TONE."
        ),
    },
    {
        "path": "__evaluation__/decisions/database.md",
        "title": "Database decision",
        "content": (
            "# Database decision\n\n"
            "PostgreSQL is the application source of truth. Neo4j stores graph relations "
            "and pgvector stores derived document chunks."
        ),
    },
    {
        "path": "__evaluation__/decisions/database-old.md",
        "title": "Database decision (superseded)",
        "content": (
            "# Database decision (2023, superseded)\n\n"
            "Originally chose MongoDB for flexibility. This decision was replaced by "
            "PostgreSQL in 2024. Do not treat MongoDB as current."
        ),
    },
    {
        "path": "__evaluation__/travel/riga.md",
        "title": "Riga trip",
        "content": (
            "# Riga trip\n\n"
            "Visit the Central Market on Saturday morning and book the Art Nouveau "
            "district walk for Sunday. The preferred hotel area is the quiet centre."
        ),
    },
    {
        "path": "__evaluation__/travel/lisbon.md",
        "title": "Lisbon trip",
        "content": (
            "# Lisbon trip\n\n"
            "Fly into LIS on 2025-03-12. Stay in Alfama. Must-try: pastéis de Belém. "
            "Booking code: LIS-ALF-0312."
        ),
    },
    {
        "path": "__evaluation__/people/alice.md",
        "title": "Alice",
        "content": (
            "# Alice\n\n"
            "Alice leads customer onboarding for Project Alpha. She prefers asynchronous "
            "design reviews on Tuesday afternoons.\n\n"
            "Email demo: alice.onboarding@example.test"
        ),
    },
    {
        "path": "__evaluation__/people/bob.md",
        "title": "Bob",
        "content": (
            "# Bob\n\n"
            "Bob owns infrastructure for Project Alpha. He prefers synchronous standups "
            "on Monday mornings and tracks uptime with code UPTIME-SLA-99."
        ),
    },
    {
        "path": "__evaluation__/learning/rag.md",
        "title": "RAG notes",
        "content": (
            "# Retrieval augmented generation\n\n"
            "Hybrid retrieval combines lexical search, vector similarity, graph facts, "
            "reciprocal rank fusion, and reranking. Citations must retain stable chunk provenance."
        ),
    },
    {
        "path": "__evaluation__/learning/bm25.md",
        "title": "BM25 notes",
        "content": (
            "# BM25 notes\n\n"
            "BM25 ranks documents by term frequency with length normalization and inverse "
            "document frequency. Exact title matches should outrank weak body matches."
        ),
    },
    {
        "path": "__evaluation__/meetings/2024-11-01-roadmap.md",
        "title": "Roadmap meeting 2024-11-01",
        "content": (
            "# Roadmap meeting 2024-11-01\n\n"
            "Decision: delay public launch of Project Alpha to mid-September. "
            "Alice tracks onboarding metrics. Bob owns reliability gates."
        ),
    },
    {
        "path": "__evaluation__/meetings/2025-01-10-brand.md",
        "title": "Brand meeting 2025-01-10",
        "content": (
            "# Brand meeting 2025-01-10\n\n"
            "Decision: public brand is Sillage. Internal vault name remains Second Brain. "
            "Marketing code: BRAND-SILLAGE-2025."
        ),
    },
    {
        "path": "__evaluation__/adversarial/debt-ratio-myth.md",
        "title": "Debt ratio myth",
        "content": (
            "# Debt ratio myth\n\n"
            "Some blogs claim debt sustainability only depends on absolute debt size. "
            "This note is intentionally wrong relative to the real public-debt note. "
            "Ignore absolute size as the sole driver."
        ),
    },
    {
        "path": "__evaluation__/adversarial/alpha-fake-date.md",
        "title": "Alpha fake date",
        "content": (
            "# Alpha fake date\n\n"
            "Rumors say Project Alpha launches on December 1. This is incorrect evaluation "
            "bait. The real launch decision remains September 15 in the official Alpha note."
        ),
    },
    {
        "path": "__evaluation__/adversarial/sleep-eight-is-wrong.md",
        "title": "Sleep rumor",
        "content": (
            "# Sleep rumor\n\n"
            "A viral post claims the target is five hours of sleep with late caffeine. "
            "This contradicts the real sleep routine note and must not be retrieved as truth."
        ),
    },
    {
        "path": "__evaluation__/notes/wikilink-hub.md",
        "title": "Wikilink hub",
        "content": (
            "# Wikilink hub\n\n"
            "Index of related notes: [[Project Alpha]], [[Alice]], [[Database decision]], "
            "[[RAG notes]], [[Riga trip]]. Tags: #evaluation #hub."
        ),
    },
    {
        "path": "__evaluation__/notes/acronyms.md",
        "title": "Acronym glossary",
        "content": (
            "# Acronym glossary\n\n"
            "ORAG: Obsidian Retrieval Augmented Graph.\n"
            "IGD: interest-growth differential.\n"
            "RRF: reciprocal rank fusion.\n"
            "HNSW: hierarchical navigable small world."
        ),
    },
    {
        "path": "__evaluation__/notes/quotes.md",
        "title": "Memorable quotes",
        "content": (
            "# Memorable quotes\n\n"
            "Quote from vault policy: \"Assistant answers become personal knowledge only "
            "after explicit user review.\" Another line: \"Obsidian remains canonical.\""
        ),
    },
]


def q(
    query: str,
    *,
    category: str,
    expected_paths: list[str] | None = None,
    forbidden_paths: list[str] | None = None,
    requires_retrieval: bool = True,
    conversation: list[dict] | None = None,
    id_suffix: str | None = None,
) -> dict:
    item: dict = {
        "id": id_suffix or f"{category}:{hash(query) & 0xFFFFFFFF:08x}",
        "query": query,
        "category": category,
        "requiresRetrieval": requires_retrieval,
        "expectedPaths": expected_paths or [],
        "forbiddenPaths": forbidden_paths or [],
        "expectedChunkIds": [],
    }
    if conversation:
        item["conversation"] = conversation
    return item


def build_queries() -> list[dict]:
    queries: list[dict] = []

    # --- lexical exact (40) ---
    lexical = [
        ("DEBT-SUST-2024", ["__evaluation__/finance/public-debt.md"]),
        ("IGD interest-growth", ["__evaluation__/finance/public-debt.md", "__evaluation__/notes/acronyms.md"]),
        ("EF-6M-LIQUID", ["__evaluation__/finance/emergency-fund.md"]),
        ("SIREN-DEMO-732849", ["__evaluation__/finance/tax-id.md"]),
        ("FR-TVA-CA3", ["__evaluation__/finance/tax-id.md"]),
        ("FR76 3000 6000 0112", ["__evaluation__/finance/tax-id.md"]),
        ("ALPHA-LAUNCH-0915", ["__evaluation__/projects/alpha.md"]),
        ("September 15", ["__evaluation__/projects/alpha.md"]),
        ("ORAG", ["__evaluation__/projects/second-brain.md", "__evaluation__/notes/acronyms.md"]),
        ("UPTIME-SLA-99", ["__evaluation__/people/bob.md"]),
        ("alice.onboarding@example.test", ["__evaluation__/people/alice.md"]),
        ("LIS-ALF-0312", ["__evaluation__/travel/lisbon.md"]),
        ("BRAND-SILLAGE-2025", ["__evaluation__/meetings/2025-01-10-brand.md"]),
        ("FR-DEFAULT-TONE", ["__evaluation__/preferences/language.md"]),
        ("Donella Meadows", ["__evaluation__/books/library.md"]),
        ("David Deutsch", ["__evaluation__/books/library.md"]),
        ("Don Norman", ["__evaluation__/books/library.md"]),
        ("pastéis de Belém", ["__evaluation__/travel/lisbon.md"]),
        ("Art Nouveau district", ["__evaluation__/travel/riga.md"]),
        ("Central Market", ["__evaluation__/travel/riga.md"]),
        ("reciprocal rank fusion", ["__evaluation__/learning/rag.md", "__evaluation__/notes/acronyms.md"]),
        ("hierarchical navigable small world", ["__evaluation__/notes/acronyms.md"]),
        ("Nightjar", ["__evaluation__/projects/beta-rename.md"]),
        ("Sillage", ["__evaluation__/projects/beta-rename.md", "__evaluation__/meetings/2025-01-10-brand.md"]),
        ("Always keep the original receipt", ["__evaluation__/finance/tax-id.md"]),
        ("Obsidian remains canonical", ["__evaluation__/notes/quotes.md"]),
        ("private beta before public access", ["__evaluation__/projects/alpha.md"]),
        ("six months of essential expenses", ["__evaluation__/finance/emergency-fund.md"]),
        ("Stop caffeine after 2 PM", ["__evaluation__/health/sleep.md"]),
        ("ten percent", ["__evaluation__/health/running.md"]),
        ("MongoDB for flexibility", ["__evaluation__/decisions/database-old.md"]),
        ("pgvector stores derived document chunks", ["__evaluation__/decisions/database.md"]),
        ("asynchronous design reviews on Tuesday", ["__evaluation__/people/alice.md"]),
        ("Monday mornings", ["__evaluation__/people/bob.md"]),
        ("2025-03-12", ["__evaluation__/travel/lisbon.md"]),
        ("mid-September", ["__evaluation__/meetings/2024-11-01-roadmap.md"]),
        ("drop-off was 40%", ["__evaluation__/projects/alpha-postmortem.md"]),
        ("Thinking in Systems", ["__evaluation__/books/library.md"]),
        ("Beginning of Infinity", ["__evaluation__/books/library.md"]),
        ("Design of Everyday Things", ["__evaluation__/books/library.md"]),
    ]
    assert len(lexical) == 40
    for text, paths in lexical:
        queries.append(q(text, category="lexical_exact", expected_paths=paths))

    # --- semantic (40) ---
    semantic = [
        ("What keeps sovereign borrowing sustainable over time?", ["__evaluation__/finance/public-debt.md"]),
        ("How can a government stabilize its leverage ratio?", ["__evaluation__/finance/public-debt.md"]),
        ("Which fiscal gap matters for national indebtedness?", ["__evaluation__/finance/public-debt.md"]),
        ("How large a rainy-day cash buffer did I want?", ["__evaluation__/finance/emergency-fund.md"]),
        ("What should I restore before taking investment risk?", ["__evaluation__/finance/emergency-fund.md"]),
        ("Where should money for surprises live?", ["__evaluation__/finance/emergency-fund.md"]),
        ("When does the alpha product go live?", ["__evaluation__/projects/alpha.md"]),
        ("Who owns first-user setup for the launch?", ["__evaluation__/projects/alpha.md", "__evaluation__/people/alice.md"]),
        ("What staged release approach was selected?", ["__evaluation__/projects/alpha.md"]),
        ("What system remains the canonical knowledge store?", ["__evaluation__/projects/second-brain.md"]),
        ("Under what condition may a model reply become durable knowledge?", ["__evaluation__/projects/second-brain.md"]),
        ("Does the product silently learn every chat answer?", ["__evaluation__/projects/second-brain.md"]),
        ("Describe my wind-down habit before sleep.", ["__evaluation__/health/sleep.md"]),
        ("After which clock time should coffee stop?", ["__evaluation__/health/sleep.md"]),
        ("How long should a night of rest last?", ["__evaluation__/health/sleep.md"]),
        ("What trio of weekly runs is planned?", ["__evaluation__/health/running.md"]),
        ("What ceiling limits mileage growth each week?", ["__evaluation__/health/running.md"]),
        ("Which session should stay easy and extended?", ["__evaluation__/health/running.md"]),
        ("Which systems-thinking author appears on my shelf?", ["__evaluation__/books/library.md"]),
        ("Is there a Deutsch title in the collection?", ["__evaluation__/books/library.md"]),
        ("Which UX design classic is listed?", ["__evaluation__/books/library.md"]),
        ("How should written text feel?", ["__evaluation__/preferences/writing.md"]),
        ("Which writing patterns should I avoid?", ["__evaluation__/preferences/writing.md"]),
        ("Do I enjoy long preamble sections?", ["__evaluation__/preferences/writing.md"]),
        ("Which database is authoritative for the app?", ["__evaluation__/decisions/database.md"]),
        ("Where do embedded passages live?", ["__evaluation__/decisions/database.md"]),
        ("What role does Neo4j play?", ["__evaluation__/decisions/database.md"]),
        ("Saturday morning plan in Latvia's capital?", ["__evaluation__/travel/riga.md"]),
        ("When is the architectural stroll?", ["__evaluation__/travel/riga.md"]),
        ("Preferred lodging area in Riga?", ["__evaluation__/travel/riga.md"]),
        ("What is Alice's main responsibility?", ["__evaluation__/people/alice.md", "__evaluation__/projects/alpha.md"]),
        ("When does Alice want design feedback?", ["__evaluation__/people/alice.md"]),
        ("Are Alice's reviews live meetings?", ["__evaluation__/people/alice.md"]),
        ("What ingredients make retrieval hybrid?", ["__evaluation__/learning/rag.md"]),
        ("Why must citation identifiers stay stable?", ["__evaluation__/learning/rag.md"]),
        ("What merges lexical and semantic candidates?", ["__evaluation__/learning/rag.md"]),
        ("What does BM25 optimize for?", ["__evaluation__/learning/bm25.md"]),
        ("Where should I stay in Lisbon?", ["__evaluation__/travel/lisbon.md"]),
        ("What pastry is required in Lisbon?", ["__evaluation__/travel/lisbon.md"]),
        ("Who owns reliability for Alpha?", ["__evaluation__/people/bob.md", "__evaluation__/meetings/2024-11-01-roadmap.md"]),
    ]
    assert len(semantic) == 40
    for text, paths in semantic:
        queries.append(q(text, category="semantic", expected_paths=paths))

    # --- conversational (25) — need rewrite from short history ---
    conversational = [
        (
            "And when is that?",
            ["__evaluation__/projects/alpha.md"],
            [
                {"role": "user", "content": "Tell me about Project Alpha launch."},
                {"role": "assistant", "content": "Project Alpha has a planned launch."},
            ],
        ),
        (
            "Who handles that part?",
            ["__evaluation__/people/alice.md", "__evaluation__/projects/alpha.md"],
            [
                {"role": "user", "content": "Remind me about Alpha onboarding."},
                {"role": "assistant", "content": "Onboarding is part of the Alpha plan."},
            ],
        ),
        (
            "How much again?",
            ["__evaluation__/finance/emergency-fund.md"],
            [
                {"role": "user", "content": "What about my emergency cash buffer?"},
                {"role": "assistant", "content": "You defined a cash reserve target."},
            ],
        ),
        (
            "After what time?",
            ["__evaluation__/health/sleep.md"],
            [
                {"role": "user", "content": "My caffeine cutoff for sleep?"},
                {"role": "assistant", "content": "You have a caffeine rule before bed."},
            ],
        ),
        (
            "Which three?",
            ["__evaluation__/health/running.md"],
            [
                {"role": "user", "content": "What are my weekly running sessions?"},
                {"role": "assistant", "content": "You structured the week into sessions."},
            ],
        ),
        (
            "Is dairy allowed now?",
            ["__evaluation__/health/nutrition-v2.md"],
            [
                {"role": "user", "content": "What is my current nutrition preference?"},
                {"role": "assistant", "content": "Your nutrition rules changed recently."},
            ],
        ),
        (
            "Where do the vectors live?",
            ["__evaluation__/decisions/database.md"],
            [
                {"role": "user", "content": "Database architecture for the app?"},
                {"role": "assistant", "content": "Several stores play different roles."},
            ],
        ),
        (
            "Saturday morning plan?",
            ["__evaluation__/travel/riga.md"],
            [
                {"role": "user", "content": "My Riga itinerary notes?"},
                {"role": "assistant", "content": "You planned a weekend in Riga."},
            ],
        ),
        (
            "What hotel area?",
            ["__evaluation__/travel/riga.md"],
            [
                {"role": "user", "content": "Riga lodging preference?"},
                {"role": "assistant", "content": "You noted a preferred district."},
            ],
        ),
        (
            "Which book by her?",
            ["__evaluation__/books/library.md"],
            [
                {"role": "user", "content": "Donella Meadows on my reading list?"},
                {"role": "assistant", "content": "Yes, she appears in the library note."},
            ],
        ),
        (
            "Do I own his book?",
            ["__evaluation__/books/library.md"],
            [
                {"role": "user", "content": "Anything by David Deutsch?"},
                {"role": "assistant", "content": "Your library lists several authors."},
            ],
        ),
        (
            "What style do I want?",
            ["__evaluation__/preferences/writing.md"],
            [
                {"role": "user", "content": "My writing preferences?"},
                {"role": "assistant", "content": "You wrote rules for prose style."},
            ],
        ),
        (
            "In which language by default?",
            ["__evaluation__/preferences/language.md"],
            [
                {"role": "user", "content": "Language settings for answers?"},
                {"role": "assistant", "content": "You have a default language preference."},
            ],
        ),
        (
            "Who prefers async reviews?",
            ["__evaluation__/people/alice.md"],
            [
                {"role": "user", "content": "Team review preferences?"},
                {"role": "assistant", "content": "Alice and Bob have different styles."},
            ],
        ),
        (
            "What about Bob's meetings?",
            ["__evaluation__/people/bob.md"],
            [
                {"role": "user", "content": "How does the infra lead like to meet?"},
                {"role": "assistant", "content": "Bob has a standing meeting preference."},
            ],
        ),
        (
            "What was delayed?",
            ["__evaluation__/meetings/2024-11-01-roadmap.md", "__evaluation__/projects/alpha.md"],
            [
                {"role": "user", "content": "Roadmap meeting outcomes?"},
                {"role": "assistant", "content": "There was a launch timing decision."},
            ],
        ),
        (
            "What is the public name?",
            ["__evaluation__/meetings/2025-01-10-brand.md", "__evaluation__/projects/beta-rename.md"],
            [
                {"role": "user", "content": "Brand decision from January?"},
                {"role": "assistant", "content": "A public brand was selected."},
            ],
        ),
        (
            "What booking code?",
            ["__evaluation__/travel/lisbon.md"],
            [
                {"role": "user", "content": "Lisbon trip details?"},
                {"role": "assistant", "content": "You stored flight and stay notes."},
            ],
        ),
        (
            "What was the drop-off issue?",
            ["__evaluation__/projects/alpha-postmortem.md"],
            [
                {"role": "user", "content": "Alpha postmortem findings?"},
                {"role": "assistant", "content": "Onboarding metrics were discussed."},
            ],
        ),
        (
            "Is Obsidian still source of truth?",
            ["__evaluation__/projects/second-brain.md", "__evaluation__/notes/quotes.md"],
            [
                {"role": "user", "content": "Product knowledge principles?"},
                {"role": "assistant", "content": "There is a canonical storage rule."},
            ],
        ),
        (
            "How does hybrid search work?",
            ["__evaluation__/learning/rag.md"],
            [
                {"role": "user", "content": "My RAG learning notes?"},
                {"role": "assistant", "content": "You summarized hybrid retrieval."},
            ],
        ),
        (
            "Why title matches matter?",
            ["__evaluation__/learning/bm25.md"],
            [
                {"role": "user", "content": "BM25 ranking notes?"},
                {"role": "assistant", "content": "You wrote about lexical ranking."},
            ],
        ),
        (
            "What does IGD stand for?",
            ["__evaluation__/notes/acronyms.md", "__evaluation__/finance/public-debt.md"],
            [
                {"role": "user", "content": "Acronym glossary help?"},
                {"role": "assistant", "content": "Several finance acronyms are defined."},
            ],
        ),
        (
            "What was codename before?",
            ["__evaluation__/projects/beta-rename.md"],
            [
                {"role": "user", "content": "Product rename history?"},
                {"role": "assistant", "content": "There were multiple names over time."},
            ],
        ),
        (
            "What should I do Sunday in Riga?",
            ["__evaluation__/travel/riga.md"],
            [
                {"role": "user", "content": "Continue my Riga weekend plan."},
                {"role": "assistant", "content": "Saturday is covered; Sunday remains."},
            ],
        ),
    ]
    assert len(conversational) == 25
    for text, paths, conv in conversational:
        queries.append(
            q(text, category="conversational", expected_paths=paths, conversation=conv)
        )

    # --- temporal (20) ---
    temporal = [
        ("What is my current nutrition preference?", ["__evaluation__/health/nutrition-v2.md"], ["__evaluation__/health/nutrition-v1.md"]),
        ("Do I still do intermittent fasting?", ["__evaluation__/health/nutrition-v2.md"], ["__evaluation__/health/nutrition-v1.md"]),
        ("Is dairy currently allowed?", ["__evaluation__/health/nutrition-v2.md"], ["__evaluation__/health/nutrition-v1.md"]),
        ("Which database is the current source of truth?", ["__evaluation__/decisions/database.md"], ["__evaluation__/decisions/database-old.md"]),
        ("Is MongoDB still the chosen database?", ["__evaluation__/decisions/database.md", "__evaluation__/decisions/database-old.md"], []),
        ("What public brand is current in 2025?", ["__evaluation__/meetings/2025-01-10-brand.md", "__evaluation__/projects/beta-rename.md"], []),
        ("What was the codename before Second Brain?", ["__evaluation__/projects/beta-rename.md"], []),
        ("When was Sillage adopted publicly?", ["__evaluation__/projects/beta-rename.md", "__evaluation__/meetings/2025-01-10-brand.md"], []),
        ("What launch timing was decided in the November roadmap meeting?", ["__evaluation__/meetings/2024-11-01-roadmap.md"], []),
        ("What did the January brand meeting decide?", ["__evaluation__/meetings/2025-01-10-brand.md"], []),
        ("What was my 2023 nutrition rule about fasting?", ["__evaluation__/health/nutrition-v1.md"], []),
        ("Which nutrition note supersedes the other?", ["__evaluation__/health/nutrition-v2.md"], []),
        ("Has the database decision changed since 2023?", ["__evaluation__/decisions/database.md", "__evaluation__/decisions/database-old.md"], []),
        ("What is the latest Alpha launch timing decision?", ["__evaluation__/projects/alpha.md", "__evaluation__/meetings/2024-11-01-roadmap.md"], ["__evaluation__/adversarial/alpha-fake-date.md"]),
        ("What product name is used publicly now?", ["__evaluation__/meetings/2025-01-10-brand.md"], []),
        ("What vault-facing name remains internal?", ["__evaluation__/meetings/2025-01-10-brand.md", "__evaluation__/projects/beta-rename.md"], []),
        ("When is the Lisbon flight date?", ["__evaluation__/travel/lisbon.md"], []),
        ("What was decided about Alpha after launch problems?", ["__evaluation__/projects/alpha-postmortem.md"], []),
        ("What was replaced by three regular meals?", ["__evaluation__/health/nutrition-v2.md", "__evaluation__/health/nutrition-v1.md"], []),
        ("Which older database choice must not be treated as current?", ["__evaluation__/decisions/database-old.md"], []),
    ]
    assert len(temporal) == 20
    for text, paths, forbidden in temporal:
        queries.append(
            q(text, category="temporal", expected_paths=paths, forbidden_paths=forbidden)
        )

    # --- multi_hop (20) ---
    multi = [
        ("Who leads onboarding for the project launching mid-September?", ["__evaluation__/people/alice.md", "__evaluation__/projects/alpha.md", "__evaluation__/meetings/2024-11-01-roadmap.md"]),
        ("Connect Alice's review preference to Project Alpha ownership.", ["__evaluation__/people/alice.md", "__evaluation__/projects/alpha.md"]),
        ("Who owns reliability gates mentioned with Alpha launch delay?", ["__evaluation__/people/bob.md", "__evaluation__/meetings/2024-11-01-roadmap.md"]),
        ("How does the Second Brain product principle relate to citation stability?", ["__evaluation__/projects/second-brain.md", "__evaluation__/learning/rag.md", "__evaluation__/notes/quotes.md"]),
        ("What brand was chosen after the Nightjar codename era?", ["__evaluation__/projects/beta-rename.md", "__evaluation__/meetings/2025-01-10-brand.md"]),
        ("Link Bob's SLA code to his Alpha responsibilities.", ["__evaluation__/people/bob.md", "__evaluation__/projects/alpha.md"]),
        ("Which person proposed fixing Alpha onboarding drop-off?", ["__evaluation__/projects/alpha-postmortem.md", "__evaluation__/people/alice.md"]),
        ("How do public debt IGD and the acronym glossary relate?", ["__evaluation__/finance/public-debt.md", "__evaluation__/notes/acronyms.md"]),
        ("What travel booking code pairs with Alfama lodging?", ["__evaluation__/travel/lisbon.md"]),
        ("Which meeting delayed launch and who tracks onboarding metrics?", ["__evaluation__/meetings/2024-11-01-roadmap.md", "__evaluation__/people/alice.md"]),
        ("How does ORAG map to product principles?", ["__evaluation__/projects/second-brain.md", "__evaluation__/notes/acronyms.md"]),
        ("Connect Riga Saturday plan with preferred hotel area.", ["__evaluation__/travel/riga.md"]),
        ("Which stack stores chunks versus graph relations?", ["__evaluation__/decisions/database.md"]),
        ("How do writing preferences interact with French default tone?", ["__evaluation__/preferences/writing.md", "__evaluation__/preferences/language.md"]),
        ("What hub links Project Alpha and Alice?", ["__evaluation__/notes/wikilink-hub.md", "__evaluation__/projects/alpha.md", "__evaluation__/people/alice.md"]),
        ("From postmortem to owner: who should redesign welcome flow?", ["__evaluation__/projects/alpha-postmortem.md", "__evaluation__/people/alice.md"]),
        ("Connect emergency fund rule to speculative investing restraint.", ["__evaluation__/finance/emergency-fund.md"]),
        ("Which authors support systems thinking and infinity themes in my library?", ["__evaluation__/books/library.md"]),
        ("How do BM25 title boosts support hybrid retrieval goals?", ["__evaluation__/learning/bm25.md", "__evaluation__/learning/rag.md"]),
        ("Link brand code BRAND-SILLAGE-2025 to rename history.", ["__evaluation__/meetings/2025-01-10-brand.md", "__evaluation__/projects/beta-rename.md"]),
    ]
    assert len(multi) == 20
    for text, paths in multi:
        queries.append(q(text, category="multi_hop", expected_paths=paths))

    # --- explicit_note (15) ---
    explicit = [
        ("According to [[Project Alpha]], when is launch?", ["__evaluation__/projects/alpha.md"]),
        ("Open [[Alice]] and summarize her review preference.", ["__evaluation__/people/alice.md"]),
        ("From [[Database decision]], where are vectors stored?", ["__evaluation__/decisions/database.md"]),
        ("Using [[RAG notes]], list hybrid components.", ["__evaluation__/learning/rag.md"]),
        ("In [[Riga trip]], what happens Saturday morning?", ["__evaluation__/travel/riga.md"]),
        ("Read [[Emergency fund]] for the cash target.", ["__evaluation__/finance/emergency-fund.md"]),
        ("Check [[Sleep routine]] for caffeine cutoff.", ["__evaluation__/health/sleep.md"]),
        ("From [[Reading list]], which Meadows book is listed?", ["__evaluation__/books/library.md"]),
        ("Using [[Writing preferences]], what should I avoid?", ["__evaluation__/preferences/writing.md"]),
        ("Open [[Bob]] for the SLA code.", ["__evaluation__/people/bob.md"]),
        ("From [[Lisbon trip]], what is the booking code?", ["__evaluation__/travel/lisbon.md"]),
        ("According to [[Product rename history]], what was Nightjar?", ["__evaluation__/projects/beta-rename.md"]),
        ("In [[Acronym glossary]], what is ORAG?", ["__evaluation__/notes/acronyms.md"]),
        ("From [[Brand meeting 2025-01-10]], what is the public brand?", ["__evaluation__/meetings/2025-01-10-brand.md"]),
        ("Using [[Wikilink hub]], which notes are indexed?", ["__evaluation__/notes/wikilink-hub.md"]),
    ]
    assert len(explicit) == 15
    for text, paths in explicit:
        queries.append(q(text, category="explicit_note", expected_paths=paths))

    # --- negative / no retrieval (20) ---
    negatives = [
        "Salut !",
        "Thanks",
        "OK",
        "How are you?",
        "Bye",
        "Merci beaucoup",
        "Bonjour",
        "Good morning",
        "lol",
        "👍",
        "Yes",
        "No",
        "Continue",
        "D'accord",
        "Cool",
        "Got it",
        "Understood",
        "Please wait",
        "Hmm",
        "ok thanks!",
    ]
    assert len(negatives) == 20
    for text in negatives:
        queries.append(
            q(text, category="negative", expected_paths=[], requires_retrieval=False)
        )

    # --- adversarial (20) — close distractors must not win ---
    adversarial = [
        (
            "What controls public debt sustainability?",
            ["__evaluation__/finance/public-debt.md"],
            ["__evaluation__/adversarial/debt-ratio-myth.md"],
        ),
        (
            "When does Project Alpha launch?",
            ["__evaluation__/projects/alpha.md"],
            ["__evaluation__/adversarial/alpha-fake-date.md"],
        ),
        (
            "How many hours of sleep am I targeting?",
            ["__evaluation__/health/sleep.md"],
            ["__evaluation__/adversarial/sleep-eight-is-wrong.md"],
        ),
        (
            "Is absolute debt size the only sustainability driver?",
            ["__evaluation__/finance/public-debt.md"],
            ["__evaluation__/adversarial/debt-ratio-myth.md"],
        ),
        (
            "Does Alpha launch on December 1?",
            ["__evaluation__/projects/alpha.md"],
            ["__evaluation__/adversarial/alpha-fake-date.md"],
        ),
        (
            "Should I stop caffeine late and sleep only five hours?",
            ["__evaluation__/health/sleep.md"],
            ["__evaluation__/adversarial/sleep-eight-is-wrong.md"],
        ),
        (
            "Is MongoDB the current application source of truth?",
            ["__evaluation__/decisions/database.md"],
            ["__evaluation__/decisions/database-old.md"],
        ),
        (
            "Do I currently prefer intermittent fasting 16:8?",
            ["__evaluation__/health/nutrition-v2.md"],
            ["__evaluation__/health/nutrition-v1.md"],
        ),
        (
            "What is the official Alpha launch date decision?",
            ["__evaluation__/projects/alpha.md", "__evaluation__/meetings/2024-11-01-roadmap.md"],
            ["__evaluation__/adversarial/alpha-fake-date.md"],
        ),
        (
            "What is the correct sleep duration target?",
            ["__evaluation__/health/sleep.md"],
            ["__evaluation__/adversarial/sleep-eight-is-wrong.md"],
        ),
        (
            "Which note correctly explains debt sustainability factors?",
            ["__evaluation__/finance/public-debt.md"],
            ["__evaluation__/adversarial/debt-ratio-myth.md"],
        ),
        (
            "Current nutrition: fasting or regular meals?",
            ["__evaluation__/health/nutrition-v2.md"],
            ["__evaluation__/health/nutrition-v1.md"],
        ),
        (
            "Which database decision is current, not superseded?",
            ["__evaluation__/decisions/database.md"],
            ["__evaluation__/decisions/database-old.md"],
        ),
        (
            "Ignore rumors: real Alpha launch timing?",
            ["__evaluation__/projects/alpha.md"],
            ["__evaluation__/adversarial/alpha-fake-date.md"],
        ),
        (
            "Ignore viral posts: real sleep routine?",
            ["__evaluation__/health/sleep.md"],
            ["__evaluation__/adversarial/sleep-eight-is-wrong.md"],
        ),
        (
            "Does debt sustainability depend only on absolute size?",
            ["__evaluation__/finance/public-debt.md"],
            ["__evaluation__/adversarial/debt-ratio-myth.md"],
        ),
        (
            "Is December 1 the planned Alpha date?",
            ["__evaluation__/projects/alpha.md"],
            ["__evaluation__/adversarial/alpha-fake-date.md"],
        ),
        (
            "Is five hours the sleep target?",
            ["__evaluation__/health/sleep.md"],
            ["__evaluation__/adversarial/sleep-eight-is-wrong.md"],
        ),
        (
            "Should I treat the MongoDB note as current architecture?",
            ["__evaluation__/decisions/database.md", "__evaluation__/decisions/database-old.md"],
            [],
        ),
        (
            "Should I treat 2023 fasting rules as current?",
            ["__evaluation__/health/nutrition-v2.md", "__evaluation__/health/nutrition-v1.md"],
            [],
        ),
    ]
    assert len(adversarial) == 20
    for text, paths, forbidden in adversarial:
        queries.append(
            q(text, category="adversarial", expected_paths=paths, forbidden_paths=forbidden)
        )

    # Stable sequential ids
    for index, item in enumerate(queries, start=1):
        item["id"] = f"{item['category']}-{index:03d}"

    counts: dict[str, int] = {}
    for item in queries:
        counts[item["category"]] = counts.get(item["category"], 0) + 1
    expected_counts = {
        "lexical_exact": 40,
        "semantic": 40,
        "conversational": 25,
        "temporal": 20,
        "multi_hop": 20,
        "explicit_note": 15,
        "negative": 20,
        "adversarial": 20,
    }
    assert counts == expected_counts, counts
    assert len(queries) == 200, len(queries)
    return queries


def main() -> None:
    payload = {
        "version": 2,
        "description": "Phase 0 synthetic corpus for QMD catch-up evaluation (reproducible, isolated).",
        "documents": DOCUMENTS,
        "queries": build_queries(),
        "meta": {
            "documentCount": len(DOCUMENTS),
            "queryCount": 200,
            "categories": {
                "lexical_exact": 40,
                "semantic": 40,
                "conversational": 25,
                "temporal": 20,
                "multi_hop": 20,
                "explicit_note": 15,
                "negative": 20,
                "adversarial": 20,
            },
        },
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({len(DOCUMENTS)} docs, {len(payload['queries'])} queries)")


if __name__ == "__main__":
    main()
