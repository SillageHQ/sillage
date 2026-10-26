"""Resurfacing — the push half of the second brain.

Spaced-repetition over the memory graph: surface the items most "due" for
review. Salience = connectivity (how central the memory is) x overdue (how long
since it was last surfaced). Old, rich, long-unseen memories float up first —
the inverse of a forgetting curve.

After each item you say whether you remembered it:
  - remembered -> interval grows (x2.5), next review pushed further out
  - forgot     -> interval resets to 1 day, comes back soon
This is the memory-reinforcement loop (SM-2-ish) on your own notes.

Usage:
  uv run python resurface.py        # review 3 due items (default)
  uv run python resurface.py 5      # review 5
"""
import asyncio
import math
import os
import sys
from datetime import datetime, timedelta, timezone

from openai import AsyncOpenAI

from graph import DEFAULT_LLM, OPENROUTER_BASE, OPENROUTER_HEADERS, build_graphiti
EASE = 2.5  # interval multiplier when a memory is recalled successfully

DUE_QUERY = """
MATCH (e:Episodic)
OPTIONAL MATCH (e)-[m:MENTIONS]->(:Entity)
WITH e, count(m) AS degree
WITH e, degree, coalesce(e.srs_due, e.valid_at) AS due
WHERE due <= datetime()
RETURN e.uuid AS uuid, e.name AS name, e.content AS content, e.source AS source,
       duration.inSeconds(due, datetime()).seconds AS overdue_seconds, degree
"""

UPDATE_QUERY = """
MATCH (e:Episodic {uuid: $uuid})
SET e.srs_interval = $interval, e.srs_due = datetime($due_iso)
"""

REMINDER_SYS = """Tu es la mémoire de l'utilisateur. On te donne le contenu d'une
note/conversation qu'il n'a pas revue depuis longtemps. Écris UN rappel court (2-3
phrases max), au ton d'un souvenir qui remonte : "Tu te souviens de… ?" puis
l'essentiel. Pas de blabla, va au cœur de l'idée. Réponds en français."""


def salience(overdue_seconds: int, degree: int) -> float:
    overdue_days = max(overdue_seconds / 86400, 0.1)
    return math.log1p(degree) * overdue_days  # central + long-overdue = top


async def main():
    if not os.getenv("OPENROUTER_API_KEY"):
        sys.exit("Set OPENROUTER_API_KEY first (see .env).")
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3

    graphiti = await build_graphiti()
    driver = graphiti.driver
    llm = AsyncOpenAI(
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=OPENROUTER_BASE,
        default_headers=OPENROUTER_HEADERS,
    )
    model = os.getenv("OPENROUTER_MODEL", DEFAULT_LLM)

    try:
        records, _, _ = await driver.execute_query(DUE_QUERY)
        if not records:
            print("Rien à revoir — tout est à jour.")
            return

        ranked = sorted(records, key=lambda r: salience(r["overdue_seconds"], r["degree"]), reverse=True)[:n]
        print(f"{len(ranked)} souvenir(s) à revoir (sur {len(records)} dûs).\n")

        for i, r in enumerate(ranked, 1):
            resp = await llm.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": REMINDER_SYS},
                    {"role": "user", "content": f"Note: {r['name']}\n\n{(r['content'] or '')[:1500]}"},
                ],
                temperature=0.4,
            )
            print(f"── {i}/{len(ranked)} ── ({r['degree']} liens)")
            print(resp.choices[0].message.content.strip())

            ans = input("\nTu t'en souvenais ? [o/n, entrée=skip] ").strip().lower()
            if ans == "o":
                interval = round(EASE ** i, 1)  # grows each successful review
                msg = f"revu — prochaine révision dans {interval} j"
            elif ans == "n":
                interval = 1.0
                msg = "oublié — revient demain"
            else:
                print()
                continue
            due_iso = (datetime.now(timezone.utc) + timedelta(days=interval)).isoformat()
            await driver.execute_query(UPDATE_QUERY, uuid=r["uuid"], interval=interval, due_iso=due_iso)
            print(f"  → {msg}\n")
    finally:
        await graphiti.close()


if __name__ == "__main__":
    asyncio.run(main())
