"""Small localhost bridge for a packaged SearXNG + CloakBrowser runtime.

The desktop starts this process bound to loopback.  SearXNG itself is expected
to be available at ``SILLAGE_SEARXNG_URL``; no cloud request is made here.
"""
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from local_web import FETCH_LIMIT, SEARCH_LIMIT, search_web, web_fetch

app = FastAPI(docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://tauri.localhost", "tauri://localhost", "https://tauri.localhost"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
SEARXNG_URL = os.getenv("SILLAGE_SEARXNG_URL", "http://127.0.0.1:8080")


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=5, ge=1, le=SEARCH_LIMIT)
    domains: list[str] = Field(default_factory=list, max_length=10)


class FetchRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=FETCH_LIMIT)


@app.get("/health")
async def health():
    return {"ok": True, "searxng": SEARXNG_URL}


@app.post("/search")
async def search(req: SearchRequest):
    try:
        return await search_web(SEARXNG_URL, req.query, req.limit, req.domains)
    except Exception as exc:
        raise HTTPException(502, "local search unavailable") from exc


@app.post("/fetch")
async def fetch(req: FetchRequest):
    try:
        pages = [await web_fetch(url) for url in req.urls]
        return {"pages": pages}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, "local page fetch unavailable") from exc
