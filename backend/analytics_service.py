from __future__ import annotations

import json
from pathlib import Path
from typing import Any


PROJECT_DIR = Path(__file__).resolve().parents[1]
DATA_PATH = PROJECT_DIR / "data" / "analytics" / "dashboard_data.json"
EXAMPLE_DATA_PATH = PROJECT_DIR / "data" / "analytics" / "dashboard_data.example.json"


class AnalyticsRepository:
    def __init__(self, data_path: Path = DATA_PATH) -> None:
        self.data_path = data_path
        self._cache: dict[str, Any] | None = None
        self._mtime_ns: int | None = None

    def load(self) -> dict[str, Any]:
        target_path = self.data_path if self.data_path.exists() else EXAMPLE_DATA_PATH
        if not target_path.exists():
            raise FileNotFoundError(
                f"Analytics file was not found at {self.data_path}. Run `python run_pipeline.py --mode sample` or configure Lazada API credentials and run `python run_pipeline.py`."
            )
        stat = target_path.stat()
        if self._cache is None or self._mtime_ns != stat.st_mtime_ns:
            self._cache = json.loads(target_path.read_text(encoding="utf-8"))
            self._mtime_ns = stat.st_mtime_ns
        return self._cache

    def apply_filters(
        self,
        rows: list[dict[str, Any]],
        start_date: str | None = None,
        end_date: str | None = None,
        category: str | None = None,
        product_id: int | None = None,
        date_key: str = "date",
    ) -> list[dict[str, Any]]:
        filtered = rows
        if start_date:
            filtered = [row for row in filtered if row.get(date_key, "") >= start_date]
        if end_date:
            filtered = [row for row in filtered if row.get(date_key, "") <= end_date]
        if category:
            filtered = [row for row in filtered if row.get("category") == category]
        if product_id is not None:
            filtered = [row for row in filtered if int(row.get("product_id", -1)) == product_id]
        return filtered


repository = AnalyticsRepository()
