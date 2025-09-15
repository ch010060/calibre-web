# -*- coding: utf-8 -*-

from typing import List, Dict, Any

from cps import logger, db, config
from cps.services.worker import CalibreTask
from cps.search_meilisearch import is_enabled as meili_enabled

try:
    import requests
except Exception:  # pragma: no cover
    requests = None  # type: ignore


class TaskReindexMeilisearch(CalibreTask):
    def __init__(self):
        super(TaskReindexMeilisearch, self).__init__('Reindex Meilisearch')
        self.log = logger.create()

    @property
    def name(self):
        return 'Reindex Meilisearch'

    @property
    def is_cancellable(self):
        return False

    def run(self, worker_thread):
        if not meili_enabled() or requests is None:
            self._handleSuccess()
            return

        host = (config.config_meilisearch_host or '').rstrip('/')
        index = config.config_meilisearch_index or 'books'
        api_key = config.config_meilisearch_api_key or None

        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['X-Meili-API-Key'] = api_key
            headers['Authorization'] = f"Bearer {api_key}"

        # Ensure index exists with proper primary key
        try:
            r = requests.get(f"{host}/indexes/{index}", headers=headers, timeout=5)
            if r.status_code == 404:
                c = requests.post(f"{host}/indexes", headers=headers,
                                  json={"uid": index, "primaryKey": "id"}, timeout=10)
                c.raise_for_status()
        except Exception as ex:
            self._handleError(f"Failed to ensure Meilisearch index '{index}': {ex}")
            return

        # Build a dedicated CalibreDB session in this worker thread
        local_db = db.CalibreDB(expire_on_commit=False, init=True)
        
        # Fetch all books (no user-specific filters in background tasks)
        try:
            q = local_db.session.query(db.Books).all()
        except Exception as ex:
            self._handleError(f"Failed to read books for indexing: {ex}")
            return

        total = len(q)
        if total == 0:
            self._handleSuccess()
            return

        # Build documents
        def to_doc(b) -> Dict[str, Any]:
            return {
                'id': int(b.id),
                'title': b.title,
                'authors': [a.name for a in b.authors],
                'series': [s.name for s in b.series],
                'tags': [t.name for t in b.tags],
                'publisher': [p.name for p in b.publishers],
                'comments': ' '.join([c.text or '' for c in b.comments]) if hasattr(b, 'comments') else ''
            }

        docs = [to_doc(b) for b in q]

        # Upsert in chunks
        url = f"{host}/indexes/{index}/documents?primaryKey=id"
        chunk = 500
        for i in range(0, total, chunk):
            part = docs[i:i+chunk]
            try:
                resp = requests.post(url, headers=headers, json=part, timeout=30)
                resp.raise_for_status()
            except Exception as ex:
                self._handleError(f"Failed uploading documents to Meilisearch: {ex}")
                return
            self.progress = min(1.0, float(i + len(part)) / float(total))

        self._handleSuccess()
