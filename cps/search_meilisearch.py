import logging
from typing import Any, Dict, List, Optional

try:
    import requests
except Exception:  # pragma: no cover
    requests = None  # type: ignore

from . import config as app_config


log = logging.getLogger(__name__)


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
