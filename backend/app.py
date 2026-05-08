from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.analytics_service import repository
from data.build_kaggle_spark import DEFAULT_OUTPUT, write_output, process_spark_data

PROJECT_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = PROJECT_DIR / "frontend"

app = FastAPI(title="E-Commerce Analytics API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR)), name="assets")


def get_payload() -> dict:
    try:
        return repository.load()
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="ยังไม่มีไฟล์ข้อมูล กรุณารันก่อน: python run_pipeline.py",
        ) from exc


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
def health() -> dict:
    payload = get_payload()
    return {
        "status": "ok",
        "engine": payload["meta"].get("engine", "pyspark-kaggle"),
        "generated_at": payload["meta"]["generated_at"],
        "total_events": payload["meta"]["total_events"],
    }


@app.post("/refresh")
def refresh(
    rows: int = Query(
        default=500_000,
        ge=10_000,
        le=25_000_000,
        description="จำนวน rows ต่อไฟล์ที่จะโหลดจาก Kaggle Dataset",
    ),
) -> dict:
    """Re-run the Kaggle PySpark pipeline และ reload ข้อมูลใหม่."""
    try:
        payload = process_spark_data(rows_per_file=rows)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Pipeline ล้มเหลว: {exc}") from exc

    write_output(payload, Path(DEFAULT_OUTPUT))
    repository._cache = None
    repository._mtime_ns = None
    return {
        "status": "ok",
        "engine": payload["meta"].get("engine"),
        "generated_at": payload["meta"]["generated_at"],
        "source": payload["meta"]["sources"][0] if payload["meta"].get("sources") else "kaggle",
        "total_events": payload["meta"]["total_events"],
        "date_range": payload.get("filters", {}).get("date_range", {}),
    }


@app.get("/dashboard")
def dashboard() -> dict:
    payload = get_payload()
    return {
        "meta": payload["meta"],
        "filters": payload["filters"],
        "dashboard": payload["dashboard"],
        "funnel": payload.get("funnel", {}),
        "products": payload.get("products", {
            "top_by_revenue": [], "top_by_quantity": [],
            "pareto": {"top_products_for_80pct": 0, "product_count": 0,
                       "top_20pct_product_count": 0, "products": []},
        }),
        "categories": payload.get("categories", {}),
        "revenue": payload.get("revenue", {}),
        "customers": payload.get("customers", {
            "daily_active_users": [], "new_vs_returning": [], "top_customers": []
        }),
        "segments": payload.get("segments", {
            "segments": [], "segment_summary": [], "churn_risk": []
        }),
        "time_behavior": payload.get("time_behavior", {}),
        "insights": payload.get("insights", []),
    }


@app.get("/revenue")
def revenue(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
) -> dict:
    payload = get_payload()
    daily = repository.apply_filters(
        payload["revenue"]["daily"], start_date=start_date, end_date=end_date,
    )
    return {"daily": daily, "seasonality": payload["revenue"].get("seasonality", [])}


@app.get("/funnel")
def funnel() -> dict:
    return get_payload().get("funnel", {})


@app.get("/products")
def products(
    category: str | None = Query(default=None),
    product_id: int | None = Query(default=None),
) -> dict:
    payload = get_payload()
    p = payload.get("products", {})
    return {
        "top_by_revenue": repository.apply_filters(
            p.get("top_by_revenue", []), category=category, product_id=product_id),
        "top_by_quantity": repository.apply_filters(
            p.get("top_by_quantity", []), category=category, product_id=product_id),
        "pareto": {
            **p.get("pareto", {}),
            "products": repository.apply_filters(
                p.get("pareto", {}).get("products", []),
                category=category, product_id=product_id,
            ),
        },
    }


@app.get("/customers")
def customers(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
) -> dict:
    payload = get_payload()
    c = payload.get("customers", {})
    return {
        "daily_active_users": repository.apply_filters(
            c.get("daily_active_users", []),
            start_date=start_date, end_date=end_date, date_key="event_date",
        ),
        "new_vs_returning": repository.apply_filters(
            c.get("new_vs_returning", []),
            start_date=start_date, end_date=end_date, date_key="event_date",
        ),
        "top_customers": c.get("top_customers", []),
    }


@app.get("/segments")
def segments() -> dict:
    return get_payload().get("segments", {
        "segments": [], "segment_summary": [], "churn_risk": []
    })


@app.get("/categories")
def categories() -> dict:
    return get_payload().get("categories", {})


@app.get("/time-behavior")
def time_behavior() -> dict:
    return get_payload().get("time_behavior", {})