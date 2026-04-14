import logging
from ipaddress import ip_address
from urllib.parse import urlparse, urlunparse
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
except Exception:  # pragma: no cover
    requests = None  # type: ignore

from . import config as app_config


log = logging.getLogger(__name__)

_DOC_TEMPLATE_METADATA = "{{doc.title}} {{doc.series}} {{doc.tags}} {{doc.authors}}"


def is_enabled() -> bool:
    """Return True if Meilisearch integration is enabled in Calibre-Web config."""
    return bool(getattr(app_config, 'config_meilisearch_enabled', False) and
                getattr(app_config, 'config_meilisearch_host', '')) and requests is not None


def _headers(api_key: Optional[str]) -> Dict[str, str]:
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['X-Meili-API-Key'] = api_key
        headers['Authorization'] = f"Bearer {api_key}"
    return headers


def search(query: str, offset: int, limit: int) -> Optional[Dict[str, Any]]:
    """Query Meilisearch and return raw JSON result based on Calibre-Web settings.

    Expects documents indexed with an `id` field equal to Calibre book id.
    Uses the following settings (in app DB):
      - config_meilisearch_enabled
      - config_meilisearch_host
      - config_meilisearch_api_key (optional)
      - config_meilisearch_index (default: books)
    """
    host = getattr(app_config, 'config_meilisearch_host', '')
    if not host or requests is None:
        return None

    api_key = getattr(app_config, 'config_meilisearch_api_key', '') or None
    index = getattr(app_config, 'config_meilisearch_index', 'books') or 'books'
    url = f"{host.rstrip('/')}/indexes/{index}/search"
    try:
        resp = requests.post(
            url,
            headers=_headers(api_key),
            json={
                'q': query,
                'offset': int(offset or 0),
                'limit': int(limit or 60),
                'attributesToRetrieve': ['id'],
                'showMatchesPosition': True,
            },
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as ex:  # pragma: no cover
        log.warning("Meilisearch query failed: %s", ex)
        return None


def extract_ids(search_response: Dict[str, Any]) -> List[int]:
    hits = search_response.get('hits', []) or []
    ids: List[int] = []
    for h in hits:
        try:
            ids.append(int(h.get('id')))
        except Exception:
            continue
    return ids


# ----------- AI / hybrid helpers -----------

def _normalize_ai_query(query: str) -> str:
    """Normalize AI query without affecting non-AI search behavior.

    This is intentionally minimal and currently only expands a small set of
    known-language synonyms for AI search relevance.
    """
    q = (query or "").strip()
    if not q:
        return q
    return q

def _normalize_meili_embedder_url(url: str) -> str:
    """Return a container-reachable embedder URL for Meili settings.

    Calibre-Web may run on the host, but Meilisearch runs in Docker. Host-local
    URLs such as localhost are often unreachable from the Meili container, so
    normalize loopback endpoints to host.docker.internal when appropriate.
    """
    if not url:
        return url
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        try:
            parsed_ip = ip_address(host)
            localish = parsed_ip.is_loopback
        except Exception:
            localish = host in {"localhost"}
        if localish:
            netloc = "host.docker.internal"
            if parsed.port:
                netloc = f"{netloc}:{parsed.port}"
            return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))
    except Exception:
        pass
    return url


def _embed(text: str) -> Optional[List[float]]:
    """Call local embeddings endpoint (Ollama/TEI) and return a vector.
    Uses app_config.ai_embeddings_url / ai_embeddings_model / ai_timeout_ms.
    Accepts common response shapes.
    """
    url = getattr(app_config, 'ai_embeddings_url', '') or getattr(app_config, 'config_ai_embeddings_url', '')
    model = getattr(app_config, 'ai_embeddings_model', '') or getattr(app_config, 'config_ai_embeddings_model', '')
    timeout_ms = getattr(app_config, 'ai_timeout_ms', None) or getattr(app_config, 'config_ai_timeout_ms', 700)
    if not url or not model or requests is None:
        return None
    payload: Dict[str, Any] = {}
    u = url.rstrip('/')
    # Ollama embeddings API shapes:
    # - /api/embed expects {"input": "..."}
    # - /api/embeddings expects {"prompt": "..."} (some versions return empty for "input")
    if u.endswith('/api/embed'):
        payload = {'model': model, 'input': text}
    elif u.endswith('/api/embeddings') or 'ollama' in u:
        payload = {'model': model, 'prompt': text}
    else:
        # TEI style
        payload = {'inputs': [text], 'model': model}
    try:
        resp = requests.post(url, json=payload, timeout=max(1, int(timeout_ms)/1000.0))
        resp.raise_for_status()
        data = resp.json()
        # Ollama: { "embedding": [...] }
        if isinstance(data, dict) and 'embedding' in data:
            return list(map(float, data['embedding']))
        # TEI: { "embeddings": [[...]] } or { "data": [{"embedding": [...]}] }
        if isinstance(data, dict) and 'embeddings' in data and data['embeddings']:
            return list(map(float, data['embeddings'][0]))
        if isinstance(data, dict) and 'data' in data and data['data']:
            return list(map(float, data['data'][0].get('embedding', [])))
    except Exception as ex:  # pragma: no cover
        log.warning('Embeddings call failed: %s', ex)
    return None


def vector_search(embedding: List[float], limit: int = 100) -> Optional[Dict[str, Any]]:
    host = getattr(app_config, 'config_meilisearch_host', '')
    if not host or requests is None:
        return None
    index = getattr(app_config, 'config_meilisearch_index', 'books') or 'books'
    url = f"{host.rstrip('/')}/indexes/{index}/search"
    try:
        resp = requests.post(url,
                             headers=_headers(getattr(app_config, 'config_meilisearch_api_key', '') or None),
                             json={
                                 'q': None,
                                 'limit': int(limit or 100),
                                 'attributesToRetrieve': ['id'],
                                 'vector': embedding,
                             }, timeout=5)
        resp.raise_for_status()
        return resp.json()
    except Exception as ex:  # pragma: no cover
        log.warning('Meilisearch vector search failed: %s', ex)
        return None


def ai_hybrid_search(query: str) -> Tuple[List[int], int]:
    """Return ordered ids and total.
    Prefer Meilisearch-native hybrid (embedder configured).
    Fallback to manual keyword+vector blend if hybrid is not available.
    """
    query = _normalize_ai_query(query)
    # Try Meilisearch-native hybrid first
    try:
        embedder = getattr(app_config, 'ai_embedder_name', None) or 'ollama'
        ratio_percent = getattr(app_config, 'ai_semantic_ratio', 50) or 50
        ratio = max(0.0, min(1.0, float(ratio_percent)/100.0))
        hs = hybrid_search(query, embedder_name=embedder, semantic_ratio=ratio, limit=100)
        if hs and hs.get('hits'):
            ids = extract_ids(hs)
            total = int(hs.get('estimatedTotalHits') or hs.get('nbHits') or len(ids))
            if ids:
                return ids, total
    except Exception as ex:  # pragma: no cover
        log.warning('Hybrid search failed, will fallback: %s', ex)

    # Fallback: manual keyword + vector blend
    kw = search(query, 0, 100) or {}
    kw_hits = kw.get('hits', []) or []
    kw_scores: Dict[int, float] = {}
    ids_kw: List[int] = []
    for h in kw_hits:
        try:
            i = int(h.get('id'))
        except Exception:
            continue
        ids_kw.append(i)
        # Meili doesn’t expose raw score; use position as proxy
        kw_scores[i] = 1.0 - (len(ids_kw)-1)/max(1.0, float(len(kw_hits)))

    vec_scores: Dict[int, float] = {}
    try:
        emb = _embed(query)
    except Exception:
        emb = None
    if emb:
        vs = vector_search(emb, limit=100) or {}
        vhits = vs.get('hits', []) or []
        ids_vec: List[int] = []
        for h in vhits:
            try:
                i = int(h.get('id'))
            except Exception:
                continue
            ids_vec.append(i)
            vec_scores[i] = 1.0 - (len(ids_vec)-1)/max(1.0, float(len(vhits)))

    # Merge and blend
    all_ids: List[int] = []
    seen = set()
    for i in ids_kw + list(vec_scores.keys()):
        if i not in seen:
            seen.add(i)
            all_ids.append(i)
    blended: List[Tuple[int, float]] = []
    for i in all_ids:
        s = 0.6 * kw_scores.get(i, 0.0) + 0.4 * vec_scores.get(i, 0.0)
        blended.append((i, s))
    blended.sort(key=lambda x: x[1], reverse=True)
    ordered_ids = [i for i, _ in blended]
    total = int(kw.get('estimatedTotalHits') or kw.get('nbHits') or len(ordered_ids))
    return ordered_ids, total


def hybrid_search(query: str, embedder_name: str = 'ollama', semantic_ratio: float = 0.5, limit: int = 100) -> Optional[Dict[str, Any]]:
    """Call Meilisearch /search with hybrid parameters using configured embedder.
    Requires the index to have an embedder configured under the same name.
    """
    host = getattr(app_config, 'config_meilisearch_host', '')
    if not host or requests is None:
        return None
    index = getattr(app_config, 'config_meilisearch_index', 'books') or 'books'
    url = f"{host.rstrip('/')}/indexes/{index}/search"
    try:
        # Hybrid search may block on the embedder call; give it extra headroom.
        timeout_ms = getattr(app_config, 'ai_timeout_ms', None) or getattr(app_config, 'config_ai_timeout_ms', 700)
        timeout_s = max(10.0, float(timeout_ms) / 1000.0 + 5.0)
        payload = {
            'q': query or '',
            'limit': int(limit or 100),
            'attributesToRetrieve': ['id'],
            'hybrid': {
                'semanticRatio': float(semantic_ratio),
                'embedder': embedder_name or 'ollama',
            },
            'showMatchesPosition': True,
        }
        log.info("[AI-HYBRID] host=%s index=%s embedder=%s ratio=%.2f", host, index, embedder_name, float(semantic_ratio))
        resp = requests.post(url, headers=_headers(getattr(app_config, 'config_meilisearch_api_key', '') or None), json=payload, timeout=timeout_s)
        resp.raise_for_status()
        return resp.json()
    except Exception as ex:  # pragma: no cover
        try:
            log.warning('Meilisearch hybrid search failed: %s', ex)
        except Exception:
            pass
        return None


def ensure_index_with_vectors(vector_dim: int) -> bool:
    """Ensure the configured Meilisearch index exists and has a vector store of given size.
    Returns True on success or if already configured, False on failure.
    """
    host = getattr(app_config, 'config_meilisearch_host', '')
    index = getattr(app_config, 'config_meilisearch_index', 'books') or 'books'
    if not host or requests is None or not index:
        return False
    headers = _headers(getattr(app_config, 'config_meilisearch_api_key', '') or None)
    try:
        # Create index if missing
        r = requests.get(f"{host.rstrip('/')}/indexes/{index}", headers=headers, timeout=5)
        if r.status_code == 404:
            requests.post(f"{host.rstrip('/')}/indexes", headers=headers, json={"uid": index}, timeout=5)
        # If embedders are configured, skip vector store patch (native hybrid manages it)
        try:
            e = requests.get(f"{host.rstrip('/')}/indexes/{index}/settings/embedders", headers=headers, timeout=5)
            if e.status_code == 200 and e.json():
                return True
        except Exception:
            pass
        # Patch vector store size
        s = requests.patch(
            f"{host.rstrip('/')}/indexes/{index}/settings",
            headers=headers,
            json={"vectorStore": {"size": int(vector_dim)}},
            timeout=5,
        )
        s.raise_for_status()
        return True
    except Exception as ex:  # pragma: no cover
        log.warning("Failed to ensure vector store on index '%s': %s", index, ex)
        return False


def ensure_embedder_on_index(embedder_name: str, url: str, model: str) -> bool:
    """Ensure the configured Meilisearch index has an embedder entry.
    If an embedder already exists but differs from the requested config, update it.
    Returns True on success.
    """
    host = getattr(app_config, 'config_meilisearch_host', '')
    index = getattr(app_config, 'config_meilisearch_index', 'books') or 'books'
    if not host or requests is None or not embedder_name or not url or not model:
        return False
    headers = _headers(getattr(app_config, 'config_meilisearch_api_key', '') or None)
    try:
        # Choose provider source heuristically (default to ollama)
        source = 'ollama'
        try:
            lu = (url or '').lower()
            if 'text-embeddings-inference' in lu:
                source = 'text-embeddings-inference'
            elif lu.endswith('/embeddings') and 'ollama' not in lu and '11434' not in lu:
                # generic /embeddings endpoint
                source = 'text-embeddings-inference'
        except Exception:
            source = 'ollama'

        desired = {
            "source": source,
            "url": _normalize_meili_embedder_url(url),
            "model": model,
            "documentTemplate": _DOC_TEMPLATE_METADATA,
        }

        # If settings already contain this embedder with the desired config, skip
        e = requests.get(f"{host.rstrip('/')}/indexes/{index}/settings/embedders", headers=headers, timeout=5)
        if e.status_code == 200:
            try:
                cur = e.json() or {}
            except Exception:
                cur = {}
            existing = cur.get(embedder_name) if isinstance(cur, dict) else None
            if isinstance(existing, dict):
                same = True
                for k, v in desired.items():
                    if (existing.get(k) or "") != (v or ""):
                        same = False
                        break
                if same:
                    return True

        # Patch embedders with provided configuration
        payload = {
            "embedders": {
                embedder_name: desired
            }
        }
        s = requests.patch(f"{host.rstrip('/')}/indexes/{index}/settings", headers=headers, json=payload, timeout=5)
        s.raise_for_status()
        return True
    except Exception as ex:  # pragma: no cover
        log.warning("Failed to ensure embedder on index '%s': %s", index, ex)
        return False
