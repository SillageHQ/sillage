"""Interactive second-brain REPL backed by the indexed Obsidian vault.

Conversations are not written to the knowledge graph. Validated personal
knowledge enters the graph only after it has been saved to Obsidian.

Usage:
  uv run python chat.py        # keys + config come from .env
Commands:
  /facts   toggle showing the raw recalled facts
  /quit    exit
"""
import asyncio
import os
import sys

from openai import AsyncOpenAI

from graph import DEFAULT_LLM, OPENROUTER_BASE, OPENROUTER_HEADERS, build_graphiti

SYSTEM = """Tu es la mémoire de l'utilisateur (son "second cerveau").
On te donne des faits récupérés de ses notes Obsidian, chacun daté. Réponds en
langage naturel, comme un souvenir reconstitué :
- synthétise, ne liste pas les faits bruts
- cite les dates quand c'est pertinent ("tu notais ça en 2023...")
- si les faits ne couvrent pas la question, dis-le franchement
- réponds dans la langue de la question, sois concis."""


async def main():
    if not os.getenv("OPENROUTER_API_KEY"):
        sys.exit("Set OPENROUTER_API_KEY first (see .env).")
    model = os.getenv("OPENROUTER_MODEL", DEFAULT_LLM)
    show_facts = False

    print("Connexion au graphe…")
    graphiti = await build_graphiti()
    llm = AsyncOpenAI(
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=OPENROUTER_BASE,
        default_headers=OPENROUTER_HEADERS,
    )
    print("Second cerveau prêt. Pose une question (/facts, /quit).\n")

    try:
        while True:
            try:
                question = input("🧠 > ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if not question:
                continue
            if question == "/quit":
                break
            if question == "/facts":
                show_facts = not show_facts
                print(f"[facts {'ON' if show_facts else 'OFF'}]\n")
                continue

            try:
                results = await graphiti.search(question, group_ids=[os.environ["SILLAGE_TENANT_ID"]])
                if not results:
                    print("…aucun souvenir là-dessus.\n")
                    continue

                facts = "\n".join(
                    f"- {r.fact}"
                    + (f" (noté: {r.valid_at})" if getattr(r, "valid_at", None) else "")
                    for r in results
                )
                if show_facts:
                    print(f"\n[{len(results)} faits]\n{facts}\n")

                resp = await llm.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": SYSTEM},
                        {"role": "user", "content": f"Question: {question}\n\nFaits récupérés:\n{facts}"},
                    ],
                    temperature=0.3,
                )
                answer = resp.choices[0].message.content
                print(f"\n{answer}\n")
            except Exception as e:
                print(f"\n[erreur: {e}]\n")
    finally:
        await graphiti.close()
        print("À bientôt.")


if __name__ == "__main__":
    asyncio.run(main())
