"""Ingest a sample of the Obsidian vault into Graphiti as episodes.

Each note becomes a text episode, timestamped with its file mtime so the
temporal knowledge graph can reason about "when did I write/learn this".
"""
import asyncio
import hashlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import frontmatter
from graphiti_core.nodes import EpisodeType
from graph import build_graphiti

vault_path = os.getenv("SILLAGE_VAULT_PATH")
if not vault_path:
    sys.exit("Set SILLAGE_VAULT_PATH to the Obsidian vault to ingest.")
VAULT = Path(vault_path).expanduser().resolve()
if not VAULT.is_dir():
    sys.exit("SILLAGE_VAULT_PATH must point to an existing directory.")

# Keep the first run small + cheap. Override with: python ingest.py 50
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 25


def load_notes(limit: int):
    notes = []
    for path in sorted(VAULT.rglob("*.md")):
        if "/.obsidian/" in str(path):
            continue
        raw = path.read_text(errors="ignore")
        try:
            post = frontmatter.load(path)
            body = post.content.strip()
            # Obsidian "database" entries keep their data in frontmatter
            # properties with an empty body — fold those properties into the
            # text so they get indexed instead of skipped as empty.
            props = "\n".join(
                f"{k}: {v}" for k, v in post.metadata.items() if v not in (None, "", [], {})
            )
            if props:
                body = f"{props}\n\n{body}".strip()
        except Exception:
            body = raw.strip()
        if not body:
            continue
        notes.append(
            {
                "title": path.stem,
                "folder": str(path.parent.relative_to(VAULT)),
                "path": str(path.relative_to(VAULT)),
                "body": body,
                # Hash the RAW file text (what the live watcher sends) so a note
                # ingested in bulk and later edited isn't re-extracted needlessly.
                "content_hash": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
                "mtime": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc),
            }
        )
        if len(notes) >= limit:
            break
    return notes


async def main():
    if not os.getenv("OPENROUTER_API_KEY"):
        sys.exit("Set OPENROUTER_API_KEY first.")

    notes = load_notes(LIMIT)
    print(f"Loaded {len(notes)} notes from vault.")

    graphiti = await build_graphiti()
    driver = graphiti.driver
    # Bounded parallelism: run several add_episode concurrently. Each episode
    # still fans out its own LLM calls, so keep this modest to avoid OpenRouter
    # rate limits and entity-dedup races. Override with: CONCURRENCY=4
    concurrency = int(os.getenv("CONCURRENCY", "6"))
    sem = asyncio.Semaphore(concurrency)
    done = 0

    async def ingest_one(i: int, note: dict):
        nonlocal done
        async with sem:
            try:
                res = await graphiti.add_episode(
                    name=note["title"],
                    episode_body=note["body"],
                    source=EpisodeType.text,
                    group_id=os.environ["SILLAGE_TENANT_ID"],
                    source_description=f"Obsidian note in '{note['folder']}'",
                    reference_time=note["mtime"],
                )
                # Stamp content-hash identity so the live watcher dedups and
                # detects moves against bulk-ingested notes too.
                uuid = getattr(getattr(res, "episode", None), "uuid", None)
                if uuid:
                    await driver.execute_query(
                        "MATCH (e:Episodic {uuid: $uuid}) "
                        "SET e.content_hash = $hash, e.path = $path",
                        uuid=uuid, hash=note["content_hash"], path=note["path"],
                    )
            except Exception as e:
                print(f"[{i}] FAIL {note['title']}: {e}")
            else:
                done += 1
                print(f"[{done}/{len(notes)}] {note['title']}")

    try:
        await graphiti.build_indices_and_constraints()
        await asyncio.gather(*(ingest_one(i, n) for i, n in enumerate(notes, 1)))
        print(f"Done. {done}/{len(notes)} ingested in FalkorDB.")
    finally:
        await driver.close()
        await graphiti.close()


if __name__ == "__main__":
    asyncio.run(main())
