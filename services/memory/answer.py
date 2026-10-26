"""Second-brain recall WITH synthesis.

question -> graph recall (facts + relations + dates) -> LLM synthesises a
natural, cited answer. This is the OpenCode-like UX: you ask, your brain
answers — not a list of raw triples.

Usage: python answer.py "ce qu'on disait sur les taux d'intérêt ?"
"""
import asyncio
import os
import sys

from openai import AsyncOpenAI

from graph import DEFAULT_LLM, OPENROUTER_BASE, OPENROUTER_HEADERS, build_graphiti

SYSTEM = """Tu es la mémoire de l'utilisateur (son "second cerveau").
On te donne des faits récupérés de ses notes, chacun daté (valid_at).
Réponds à sa question en langage naturel, comme un souvenir reconstitué :
- synthétise, ne liste pas les faits bruts
- cite les dates quand c'est pertinent ("tu notais ça en 2023...")
- si les faits ne couvrent pas la question, dis-le franchement
- réponds dans la langue de la question."""


async def main():
    if not os.getenv("OPENROUTER_API_KEY"):
        sys.exit("Set OPENROUTER_API_KEY first.")
    question = " ".join(sys.argv[1:]) or "qu'est-ce que j'ai noté sur les taux d'intérêt ?"

    graphiti = await build_graphiti()
    try:
        results = await graphiti.search(question, group_ids=[os.environ["SILLAGE_TENANT_ID"]])
    finally:
        await graphiti.close()

    if not results:
        print("Aucun souvenir trouvé.")
        return

    facts = "\n".join(
        f"- {r.fact}" + (f" (noté: {r.valid_at})" if getattr(r, "valid_at", None) else "")
        for r in results
    )

    client = AsyncOpenAI(
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=OPENROUTER_BASE,
        default_headers=OPENROUTER_HEADERS,
    )
    resp = await client.chat.completions.create(
        model=os.getenv("OPENROUTER_MODEL", DEFAULT_LLM),
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Question: {question}\n\nFaits récupérés:\n{facts}"},
        ],
        temperature=0.3,
    )

    print(f"\n# {question}\n")
    print(resp.choices[0].message.content)
    print(f"\n---\n({len(results)} faits récupérés du graphe)")


if __name__ == "__main__":
    asyncio.run(main())
