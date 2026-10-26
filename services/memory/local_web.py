"""Safe, local-only web tools used by the desktop sidecar.

The cloud API must never call these functions.  The desktop may use the same
validation and normalization code when it hosts SearXNG/CloakBrowser.
"""
from __future__ import annotations

import ipaddress
import socket
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from readability import Document

SEARCH_LIMIT = 10
FETCH_LIMIT = 5
MAX_HTML_BYTES = 5_000_000
MAX_TEXT_CHARS = 18_000
PRIVATE_HOSTS = {"localhost", "localhost.localdomain"}


def _blocked_host(host: str) -> bool:
    host = host.rstrip(".").lower()
    if host in PRIVATE_HOSTS or host.endswith(".localhost"):
        return True
    try:
        addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return True
    for item in addresses:
        address = ipaddress.ip_address(item[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast:
            return True
    return False


def validate_public_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("only credential-free HTTP(S) URLs are allowed")
    if _blocked_host(parsed.hostname):
        raise ValueError("private, loopback, or reserved addresses are blocked")
    return value.strip()


def normalize_search_results(payload: object, limit: int = 5, domains: list[str] | None = None) -> list[dict]:
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        return []
    allowed = {d.lower().lstrip(".") for d in (domains or []) if isinstance(d, str) and d.strip()}
    seen: set[str] = set()
    output: list[dict] = []
    for rank, item in enumerate(payload["results"], 1):
        if not isinstance(item, dict) or not isinstance(item.get("url"), str):
            continue
        try:
            url = validate_public_url(item["url"])
        except ValueError:
            continue
        host = (urlparse(url).hostname or "").lower()
        if allowed and not any(host == domain or host.endswith("." + domain) for domain in allowed):
            continue
        key = url.split("#", 1)[0].rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        output.append({
            "title": str(item.get("title") or "")[:500],
            "url": url,
            "excerpt": str(item.get("content") or item.get("snippet") or "")[:1200],
            "engine": str(item.get("engine") or "")[:100],
            "rank": rank,
        })
        if len(output) >= max(1, min(limit, SEARCH_LIMIT)):
            break
    return output


async def search_web(base_url: str, query: str, limit: int = 5, domains: list[str] | None = None) -> dict:
    if not query.strip() or len(query) > 500:
        raise ValueError("query must contain 1-500 characters")
    async with httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=15, follow_redirects=False) as client:
        response = await client.get("/search", params={"q": query, "format": "json", "categories": "general"})
        response.raise_for_status()
        return {"results": normalize_search_results(response.json(), limit, domains), "query": query}


async def web_fetch(url: str, timeout: float = 20) -> dict:
    url = validate_public_url(url)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, headers={"User-Agent": "SillageDesktop/1.0"}) as client:
        response = await client.get(url)
        if response.is_redirect or response.status_code in {301, 308}:
            target = str(response.headers.get("location", ""))
            target = str(response.url.join(target))
            validate_public_url(target)
            response = await client.get(target)
        response.raise_for_status()
        raw = response.content[:MAX_HTML_BYTES]
    html = raw.decode(response.encoding or "utf-8", errors="replace")
    try:
        title = Document(html).short_title()
        body = Document(html).summary()
    except Exception:
        title = ""
        body = html
    text = BeautifulSoup(body, "html.parser").get_text("\n", strip=True)
    return {
        "title": title[:500],
        "url": str(response.url),
        "content": text[:MAX_TEXT_CHARS],
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
    }
