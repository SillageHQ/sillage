"""Test human-like recall against the ingested vault.

Usage: python recall.py "what did I note about interest rates?"
This is the 'remember()' call — instant retrieval over the prebuilt graph,
no reactive file crawl.
"""
import asyncio
import os
import sys

from graph import build_graphiti


async def main():
    if not os.getenv("OPENROUTER_API_KEY"):
        sys.exit("Set OPENROUTER_API_KEY first.")
    query = " ".join(sys.argv[1:]) or "qu'est-ce que j'ai noté sur les taux d'intérêt ?"

    graphiti = await build_graphiti()
    try:
        results = await graphiti.search(query, group_ids=[os.environ["SILLAGE_TENANT_ID"]])
        print(f"\nQuery: {query}\n{'='*60}")
        if not results:
            print("No facts recalled.")
        for r in results:
            when = getattr(r, "valid_at", None)
            print(f"\n• {r.fact}")
            if when:
                print(f"  (valid_at: {when})")
    finally:
        await graphiti.close()


if __name__ == "__main__":
    asyncio.run(main())
