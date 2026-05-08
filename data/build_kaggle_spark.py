from __future__ import annotations
import argparse
import json
import os
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Any
import numpy as np
import pandas as pd
import kagglehub
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, to_timestamp, split, date_format, hour, dayofweek, lit, sum as _sum, countDistinct, min as _min, max as _max, count as _count

BASE_DIR = Path(__file__).resolve().parents[1]
ANALYTICS_DIR = BASE_DIR / "data" / "analytics"
DEFAULT_OUTPUT = ANALYTICS_DIR / "dashboard_data.json"

# Default staging directory used by Airflow tasks. Overridable via env-var so the
# pipeline works both locally และใน Airflow worker container.
DEFAULT_STAGING_DIR = Path(os.getenv("LAZADA_STAGING_DIR", str(BASE_DIR / "data" / "_staging")))

CHURN_GAP_DAYS = 21
RFM_HIGH_RECENCY_DAYS = 30

# ขนาด batch สำหรับการแปลง CSV → Parquet (ทีละ 500K rows ต่อไฟล์)
# ค่านี้ส่งให้ Spark ผ่าน option "maxRecordsPerFile" → output Parquet 1 ไฟล์ต่อ 500K rows
BATCH_SIZE = int(os.getenv("LAZADA_BATCH_SIZE", "500000"))


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def ensure_dirs() -> None:
    ANALYTICS_DIR.mkdir(parents=True, exist_ok=True)


def _json_default(obj: Any) -> Any:
    """JSON serializer สำหรับ object ที่ json.dumps ไม่รู้จัก เช่น Timestamp, numpy types."""
    if isinstance(obj, (pd.Timestamp, datetime)):
        return str(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    raise TypeError(f"Object of type {obj.__class__.__name__} is not JSON serializable")


def write_output(payload: dict[str, Any], output_path: Path) -> None:
    ensure_dirs()
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )


def rfm_bucket(series: pd.Series, ascending: bool) -> pd.Series:
    if series.empty:
        return pd.Series(dtype=int)
    rank = series.rank(method="first", ascending=ascending)
    bucket = pd.qcut(rank, q=min(5, len(series)), labels=False, duplicates="drop")
    return bucket.fillna(0).astype(int) + 1


# ---------------------------------------------------------------------------
# Step 1: Download
# ---------------------------------------------------------------------------

KAGGLE_DATASET = "mkechinov/ecommerce-behavior-data-from-multi-category-store"


def download_dataset() -> str:
    """Download Kaggle dataset และ return path ที่เก็บไฟล์ CSV."""
    print(f"[download] Pulling Kaggle dataset: {KAGGLE_DATASET}")
    dataset_path = kagglehub.dataset_download(KAGGLE_DATASET)
    print(f"[download] Dataset cached at: {dataset_path}")
    return str(dataset_path)


# ---------------------------------------------------------------------------
# Step 2: Spark extract & aggregate
# ---------------------------------------------------------------------------

def _build_spark_session() -> SparkSession:
    return (
        SparkSession.builder
        .appName("KaggleEcommerceDashboard")
        .config("spark.driver.memory", os.getenv("SPARK_DRIVER_MEMORY", "4g"))
        .config("spark.sql.execution.arrow.pyspark.enabled", "true")
        .getOrCreate()
    )


def _benchmark_csv_vs_parquet(
    spark: SparkSession,
    csv_paths: list[str],
    parquet_dir: Path,
    rows_per_file: int,
    batch_size: int,
) -> tuple[Any, dict[str, Any]]:
    """อ่าน CSV ด้วย Spark + แปลงเป็น Parquet (batch ละ batch_size rows) +
    เปรียบเทียบเวลาในการอ่าน CSV vs Parquet.

    คืน (parquet_dataframe, benchmark_dict)
    """
    # ----- 1) CSV read benchmark -----
    print(f"[bench] [1/3] Reading CSV with Spark (csv_paths={csv_paths}) ...")
    t0 = time.perf_counter()
    df_csv = spark.read.csv(csv_paths, header=True, inferSchema=True)
    if rows_per_file > 0:
        # limit ต่อไฟล์ × จำนวนไฟล์
        df_csv = df_csv.limit(rows_per_file * len(csv_paths))
    csv_count = df_csv.count()  # force materialization
    csv_read_seconds = time.perf_counter() - t0
    print(f"[bench]      CSV read     → {csv_count:,} rows in {csv_read_seconds:.2f}s")

    # ----- 2) CSV → Parquet (batched 500K rows / file) -----
    if parquet_dir.exists():
        shutil.rmtree(parquet_dir, ignore_errors=True)
    parquet_dir.mkdir(parents=True, exist_ok=True)

    print(f"[bench] [2/3] Writing Parquet (batch size = {batch_size:,} rows / file) ...")
    t0 = time.perf_counter()
    (
        df_csv.write.mode("overwrite")
        .option("maxRecordsPerFile", str(batch_size))
        .parquet(str(parquet_dir))
    )
    parquet_write_seconds = time.perf_counter() - t0
    parquet_files = sorted(parquet_dir.glob("*.parquet"))
    print(
        f"[bench]      Parquet write → {len(parquet_files)} file(s), {parquet_write_seconds:.2f}s "
        f"(≈ {batch_size:,} rows / file)"
    )

    # ----- 3) Parquet read benchmark -----
    print(f"[bench] [3/3] Reading Parquet back ...")
    t0 = time.perf_counter()
    df_parquet = spark.read.parquet(str(parquet_dir))
    parquet_count = df_parquet.count()  # force materialization
    parquet_read_seconds = time.perf_counter() - t0
    print(f"[bench]      Parquet read → {parquet_count:,} rows in {parquet_read_seconds:.2f}s")

    speedup = round(csv_read_seconds / max(parquet_read_seconds, 0.001), 2)
    winner = "parquet" if parquet_read_seconds < csv_read_seconds else "csv"
    benchmark = {
        "csv_read_seconds": round(csv_read_seconds, 3),
        "parquet_write_seconds": round(parquet_write_seconds, 3),
        "parquet_read_seconds": round(parquet_read_seconds, 3),
        "csv_rows": int(csv_count),
        "parquet_rows": int(parquet_count),
        "batch_size": int(batch_size),
        "num_parquet_files": len(parquet_files),
        "num_batches": (int(parquet_count) + batch_size - 1) // batch_size if batch_size > 0 else 0,
        "speedup_csv_vs_parquet": speedup,
        "winner": winner,
        "csv_files": csv_paths,
        "rows_per_file_limit": int(rows_per_file),
        "measured_at": pd.Timestamp.utcnow().isoformat(),
    }
    print(
        f"[bench] DONE | CSV {csv_read_seconds:.2f}s vs Parquet {parquet_read_seconds:.2f}s "
        f"→ {winner.upper()} faster ×{speedup}"
    )
    return df_parquet, benchmark


def run_spark_aggregations(
    dataset_path: str,
    rows_per_file: int,
    staging_dir: Path | str | None = None,
    batch_size: int = BATCH_SIZE,
) -> str:
    """รัน Spark aggregations แล้วเก็บผลลัพธ์เป็น parquet/json ที่ staging_dir.

    เพิ่ม:
      - แปลง CSV → Parquet แบบ batch (batch ละ ``batch_size`` rows)
      - Benchmark เปรียบเทียบเวลาอ่าน CSV vs Parquet ด้วย PySpark
      - daily breakdown สำหรับ heatmap และ categories (ใช้ filter ที่ frontend ได้)
      - monthly summary สำหรับคำนวณ % vs เดือนก่อน

    คืน path ของ staging_dir เพื่อให้ task ถัดไปอ่านต่อได้ผ่าน XCom.
    """
    staging = Path(staging_dir) if staging_dir else DEFAULT_STAGING_DIR
    staging.mkdir(parents=True, exist_ok=True)

    spark = _build_spark_session()
    # คุม Parquet output ให้ไฟล์ละ ~batch_size rows (= "Batching 500K rows")
    spark.conf.set("spark.sql.files.maxRecordsPerFile", str(batch_size))

    try:
        csv_paths = [
            f"{dataset_path}/2019-Oct.csv",
            f"{dataset_path}/2019-Nov.csv",
        ]
        parquet_dir = staging / "raw_parquet"

        # === Step A: CSV → Parquet (batched) + benchmark ===
        df, benchmark = _benchmark_csv_vs_parquet(
            spark=spark,
            csv_paths=csv_paths,
            parquet_dir=parquet_dir,
            rows_per_file=rows_per_file,
            batch_size=batch_size,
        )

        # === Step B: Cleaning + feature engineering ===
        print("[spark] Cleaning + feature engineering...")
        df = df.withColumn("event_time", to_timestamp(col("event_time")))
        df = df.dropna(subset=["event_time", "user_id"])
        df = df.fillna({
            "category_code": "unknown.general",
            "brand": "unknown",
            "price": 0.0,
            "user_session": "unknown_session",
        })

        df = df.withColumn("category", split(col("category_code"), "\\.")[0])
        df = df.withColumn("quantity", lit(1))
        df = df.withColumn("revenue", col("price"))
        df = df.withColumn("order_id", col("user_session"))
        df = df.withColumn("event_date", date_format(col("event_time"), "yyyy-MM-dd"))
        df = df.withColumn("month", date_format(col("event_time"), "yyyy-MM"))
        df = df.withColumn("hour", hour(col("event_time")))
        df = df.withColumn("weekday", dayofweek(col("event_time")))
        # Cache เพื่อ reuse ระหว่าง aggregations หลายชุด (ลดเวลารวม)
        df.cache()

        # === Step C: Funnel events ===
        print("[spark] Funnel events...")
        events_count_df = df.groupBy("event_type").count().toPandas()
        events_count = events_count_df.set_index("event_type")["count"].to_dict()
        views = int(events_count.get("view", 0))
        carts = int(events_count.get("cart", 0))
        purchases_count = int(events_count.get("purchase", 0))

        funnel = {
            "available": True,
            "message": "Funnel generated from Kaggle data using PySpark.",
            "view": views,
            "cart": carts,
            "purchase": purchases_count,
            "view_to_cart_pct": round((carts / views * 100), 2) if views > 0 else 0.0,
            "cart_to_purchase_pct": round((purchases_count / carts * 100), 2) if carts > 0 else 0.0,
            "drop_off_view_to_cart_pct": round((1 - carts / views) * 100, 2) if views > 0 else 0.0,
            "drop_off_cart_to_purchase_pct": round((1 - purchases_count / carts) * 100, 2) if carts > 0 else 0.0,
        }

        # === Step D: Aggregations on purchases ===
        print("[spark] Filtering purchases & running financial aggs...")
        purchases = df.filter(col("event_type") == "purchase")
        purchases.cache()

        kpi_df = purchases.agg(
            _sum("revenue").alias("total_revenue"),
            countDistinct("order_id").alias("total_orders"),
        ).collect()[0]
        total_revenue = round(float(kpi_df["total_revenue"] or 0), 2)
        total_orders = int(kpi_df["total_orders"] or 0)
        avg_order_value = round(total_revenue / total_orders, 2) if total_orders else 0.0

        daily_agg_df = (
            purchases.groupBy("event_date")
            .agg(
                _sum("revenue").alias("revenue"),
                countDistinct("order_id").alias("orders"),
                countDistinct("user_id").alias("buyers"),
            )
            .orderBy("event_date")
            .toPandas()
        )

        # === NEW: monthly summary (สำหรับ KPI vs prev-month) ===
        monthly_agg_df = (
            purchases.groupBy("month")
            .agg(
                _sum("revenue").alias("revenue"),
                countDistinct("order_id").alias("orders"),
                countDistinct("user_id").alias("buyers"),
            )
            .orderBy("month")
            .toPandas()
        )

        user_agg_df = (
            purchases.groupBy("user_id")
            .agg(
                _sum("revenue").alias("customer_revenue"),
                countDistinct("order_id").alias("purchase_count"),
                _min("event_time").alias("first_seen_at"),
                _max("event_time").alias("last_seen_at"),
            )
            .toPandas()
        )

        category_agg_df = (
            purchases.groupBy("category")
            .agg(
                _sum("revenue").alias("revenue"),
                countDistinct("order_id").alias("orders"),
                countDistinct("user_id").alias("buyers"),
            )
            .orderBy(col("revenue").desc())
            .toPandas()
        )

        # === NEW: categories per day (สำหรับ filter date range ที่ frontend) ===
        category_daily_df = (
            purchases.groupBy("event_date", "category")
            .agg(
                _sum("revenue").alias("revenue"),
                countDistinct("order_id").alias("orders"),
            )
            .toPandas()
        )

        heatmap_df = (
            purchases.groupBy("weekday", "hour")
            .agg(
                _sum("revenue").alias("revenue"),
                countDistinct("order_id").alias("orders"),
            )
            .toPandas()
        )

        # === NEW: heatmap per day (สำหรับ filter date range ที่ frontend) ===
        heatmap_daily_df = (
            purchases.groupBy("event_date", "weekday", "hour")
            .agg(
                _sum("revenue").alias("revenue"),
                countDistinct("order_id").alias("orders"),
            )
            .toPandas()
        )

        # ---- Persist to staging ------------------------------------------------
        print(f"[spark] Persisting intermediates to {staging}")
        daily_agg_df.to_parquet(staging / "daily_agg.parquet", index=False)
        monthly_agg_df.to_parquet(staging / "monthly_agg.parquet", index=False)
        user_agg_df.to_parquet(staging / "user_agg.parquet", index=False)
        category_agg_df.to_parquet(staging / "category_agg.parquet", index=False)
        category_daily_df.to_parquet(staging / "category_daily.parquet", index=False)
        heatmap_df.to_parquet(staging / "heatmap.parquet", index=False)
        heatmap_daily_df.to_parquet(staging / "heatmap_daily.parquet", index=False)

        meta = {
            "totals": {
                "total_revenue": total_revenue,
                "total_orders": total_orders,
                "avg_order_value": avg_order_value,
                "views": views,
                "carts": carts,
                "purchases": purchases_count,
            },
            "funnel": funnel,
            "rows_per_file": rows_per_file,
            "generated_at": pd.Timestamp.utcnow().isoformat(),
            "benchmark": benchmark,
        }
        (staging / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2, default=_json_default),
            encoding="utf-8",
        )
        # save benchmark separately to make it easy to inspect ใน Airflow log/UI
        (staging / "benchmark.json").write_text(
            json.dumps(benchmark, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print("[spark] Done.")
    finally:
        spark.stop()

    return str(staging)


# ---------------------------------------------------------------------------
# Step 3: Pandas formatting / payload build
# ---------------------------------------------------------------------------

def _safe_read_parquet(path: Path) -> pd.DataFrame:
    """อ่าน parquet ถ้าไฟล์มีอยู่ ไม่งั้นคืน DataFrame ว่าง — กัน pipeline เก่ายังใช้ได้."""
    return pd.read_parquet(path) if path.exists() else pd.DataFrame()


def _build_monthly_summary(monthly_agg_df: pd.DataFrame) -> list[dict[str, Any]]:
    """สร้าง list ของ monthly KPI พร้อม % เทียบเดือนก่อน (โดยอัตโนมัติ)."""
    if monthly_agg_df.empty:
        return []
    m = monthly_agg_df.sort_values("month").reset_index(drop=True)
    rows: list[dict[str, Any]] = []
    for i in range(len(m)):
        row = {
            "month": str(m.iloc[i]["month"]),
            "revenue": float(m.iloc[i]["revenue"] or 0),
            "orders": int(m.iloc[i]["orders"] or 0),
            "buyers": int(m.iloc[i]["buyers"] or 0),
            "avg_order_value": round(
                float(m.iloc[i]["revenue"] or 0) / int(m.iloc[i]["orders"] or 1)
                if int(m.iloc[i]["orders"] or 0) else 0.0,
                2,
            ),
        }
        if i > 0:
            prev_rev = float(m.iloc[i - 1]["revenue"] or 0)
            prev_ord = int(m.iloc[i - 1]["orders"] or 0)
            prev_buy = int(m.iloc[i - 1]["buyers"] or 0)
            row["revenue_pct_vs_prev"] = (
                round(((row["revenue"] - prev_rev) / prev_rev) * 100, 2) if prev_rev else None
            )
            row["orders_pct_vs_prev"] = (
                round(((row["orders"] - prev_ord) / prev_ord) * 100, 2) if prev_ord else None
            )
            row["buyers_pct_vs_prev"] = (
                round(((row["buyers"] - prev_buy) / prev_buy) * 100, 2) if prev_buy else None
            )
        else:
            # เดือนแรกของชุดข้อมูล → ไม่มีเดือนก่อนให้เทียบ
            row["revenue_pct_vs_prev"] = None
            row["orders_pct_vs_prev"] = None
            row["buyers_pct_vs_prev"] = None
        rows.append(row)
    return rows


def build_payload(staging_dir: Path | str | None = None) -> dict[str, Any]:
    """อ่าน parquet/meta จาก staging แล้ว build dashboard payload."""
    staging = Path(staging_dir) if staging_dir else DEFAULT_STAGING_DIR
    print(f"[pandas] Loading staged data from {staging}")

    daily_agg_df = pd.read_parquet(staging / "daily_agg.parquet")
    monthly_agg_df = _safe_read_parquet(staging / "monthly_agg.parquet")
    user_agg_df = pd.read_parquet(staging / "user_agg.parquet")
    category_agg_df = pd.read_parquet(staging / "category_agg.parquet")
    category_daily_df = _safe_read_parquet(staging / "category_daily.parquet")
    heatmap_df = pd.read_parquet(staging / "heatmap.parquet")
    heatmap_daily_df = _safe_read_parquet(staging / "heatmap_daily.parquet")
    meta = json.loads((staging / "meta.json").read_text(encoding="utf-8"))

    totals = meta["totals"]
    funnel = meta["funnel"]
    benchmark = meta.get("benchmark", {})
    total_revenue = totals["total_revenue"]
    total_orders = totals["total_orders"]
    avg_order_value = totals["avg_order_value"]
    views = totals["views"]
    carts = totals["carts"]
    purchases_count = totals["purchases"]

    print("[pandas] Building dashboard payload...")
    revenue_daily = daily_agg_df.copy()
    revenue_daily["rolling_7d"] = revenue_daily["revenue"].rolling(7, min_periods=1).mean().round(2)
    revenue_daily["prev_revenue"] = revenue_daily["revenue"].shift()
    growth_candidates = revenue_daily[revenue_daily["prev_revenue"] > 0]
    growth_pct = (
        ((((growth_candidates["revenue"] - growth_candidates["prev_revenue"]) / growth_candidates["prev_revenue"]) * 100)
         .tail(7).mean())
        if not growth_candidates.empty else 0.0
    )

    # === Monthly summary (with % vs prev-month) ===
    monthly_summary = _build_monthly_summary(monthly_agg_df)

    user_agg_df["lifetime_days"] = (
        (user_agg_df["last_seen_at"].dt.normalize() - user_agg_df["first_seen_at"].dt.normalize()).dt.days.clip(lower=0) + 1
    )
    user_agg_df["clv_estimate"] = (
        user_agg_df["customer_revenue"] / user_agg_df["purchase_count"].replace(0, np.nan)
    ).fillna(0.0)

    snapshot = user_agg_df["last_seen_at"].max().normalize()
    rfm = user_agg_df.copy()
    rfm.rename(columns={"purchase_count": "frequency", "customer_revenue": "monetary", "last_seen_at": "last_purchase"}, inplace=True)
    rfm["recency"] = (snapshot - rfm["last_purchase"].dt.normalize()).dt.days

    if not rfm.empty:
        rfm["r_score"] = rfm_bucket(rfm["recency"], ascending=False)
        rfm["f_score"] = rfm_bucket(rfm["frequency"], ascending=True)
        rfm["m_score"] = rfm_bucket(rfm["monetary"], ascending=True)
        rfm["rfm_score"] = rfm["r_score"] + rfm["f_score"] + rfm["m_score"]
        rfm["segment"] = np.select(
            [rfm["rfm_score"] >= 8, rfm["rfm_score"].between(6, 7), rfm["recency"] >= RFM_HIGH_RECENCY_DAYS],
            ["VIP", "Loyal", "At Risk"],
            default="Growth Opportunity",
        )

    segment_summary = (
        rfm.groupby("segment", as_index=False)
        .agg(customers=("user_id", "count"), revenue=("monetary", "sum"), avg_recency=("recency", "mean"))
        .sort_values("revenue", ascending=False)
    )
    churn_risk = rfm[rfm["recency"] >= CHURN_GAP_DAYS].sort_values(["recency", "monetary"], ascending=[False, False]).head(25)

    day_map = {1: "Sun", 2: "Mon", 3: "Tue", 4: "Wed", 5: "Thu", 6: "Fri", 7: "Sat"}
    heatmap_df["day_name"] = heatmap_df["weekday"].map(day_map)
    peak_window = heatmap_df.sort_values(["orders", "revenue"], ascending=False).head(1).to_dict(orient="records")

    # daily-level breakdowns: round + serialize
    heatmap_daily_records = (
        heatmap_daily_df.round(2).to_dict(orient="records") if not heatmap_daily_df.empty else []
    )
    category_daily_records = (
        category_daily_df.round(2).to_dict(orient="records") if not category_daily_df.empty else []
    )

    payload = {
        "meta": {
            "engine": "pyspark-kaggle",
            "sources": [KAGGLE_DATASET],
            "generated_at": pd.Timestamp.utcnow().isoformat(),
            "total_events": views + carts + purchases_count,
            "capabilities": {"funnel_available": True, "traffic_events_available": True, "orders_available": True},
            "benchmark": benchmark,
        },
        "filters": {
            "date_range": {"start": str(revenue_daily["event_date"].min()), "end": str(revenue_daily["event_date"].max())},
            "categories": category_agg_df["category"].tolist()[:50],
        },
        "dashboard": {
            "kpis": {
                "total_revenue": total_revenue,
                "revenue_growth_pct": round(float(growth_pct or 0), 2),
                "average_order_value": avg_order_value,
                "total_orders": total_orders,
                "conversion_rate_pct": funnel["cart_to_purchase_pct"],
                "daily_active_users_avg": round(float(revenue_daily["buyers"].mean()), 2),
                "estimated_clv": round(float(user_agg_df["clv_estimate"].mean()), 2),
            }
        },
        "revenue": {
            "daily": revenue_daily.rename(columns={"buyers": "dau"}).round(2).to_dict(orient="records"),
            # ใช้คำนวณ "▲ x% vs เดือนก่อน" ที่ frontend
            "monthly": monthly_summary,
            "seasonality": [],
        },
        "funnel": funnel,
        "categories": {
            "categories": category_agg_df.round(2).to_dict(orient="records"),
            # ใช้สำหรับการ filter date range ที่ frontend (donut chart)
            "categories_daily": category_daily_records,
        },
        "time_behavior": {
            "heatmap": heatmap_df.round(2).to_dict(orient="records"),
            # ใช้สำหรับการ filter date range ที่ frontend (heatmap)
            "heatmap_daily": heatmap_daily_records,
            "peak_window": peak_window[0] if peak_window else {},
        },
        "customers": {
            "daily_active_users": revenue_daily[["event_date", "buyers"]].rename(columns={"buyers": "dau"}).round(2).to_dict(orient="records"),
            "top_customers": user_agg_df.sort_values("customer_revenue", ascending=False).head(50).assign(
                first_seen_at=lambda x: x["first_seen_at"].astype(str),
                last_seen_at=lambda x: x["last_seen_at"].astype(str),
            ).select_dtypes(exclude=["datetime64[ns, UTC]", "datetime64[ns]"]).round(2).to_dict(orient="records"),
        },
        "segments": {
            "segments": rfm.assign(
                last_purchase=lambda x: x["last_purchase"].astype(str),
                first_seen_at=lambda x: x["first_seen_at"].astype(str) if "first_seen_at" in x.columns else "",
                last_seen_at=lambda x: x["last_seen_at"].astype(str) if "last_seen_at" in x.columns else "",
            ).select_dtypes(exclude=["datetime64[ns, UTC]", "datetime64[ns]"]).round(2).to_dict(orient="records")[:100],
            "segment_summary": segment_summary.round(2).to_dict(orient="records"),
            "churn_risk": churn_risk.assign(
                last_purchase=lambda x: x["last_purchase"].astype(str),
                first_seen_at=lambda x: x["first_seen_at"].astype(str) if "first_seen_at" in x.columns else "",
                last_seen_at=lambda x: x["last_seen_at"].astype(str) if "last_seen_at" in x.columns else "",
            ).select_dtypes(exclude=["datetime64[ns, UTC]", "datetime64[ns]"]).round(2).to_dict(orient="records"),
        },
        "insights": [],
    }
    return payload


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def process_spark_data(rows_per_file: int) -> dict[str, Any]:
    """End-to-end pipeline (download -> spark -> payload). Used by FastAPI /refresh."""
    dataset_path = download_dataset()
    staging = run_spark_aggregations(dataset_path, rows_per_file)
    return build_payload(staging)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build dashboard analytics using PySpark and Kaggle API.")
    parser.add_argument("--rows", type=int, default=25_000_000, help="Number of rows to load per file")
    parser.add_argument("--output", type=str, default=str(DEFAULT_OUTPUT), help="Output JSON path")
    args = parser.parse_args()

    payload = process_spark_data(rows_per_file=args.rows)
    write_output(payload, Path(args.output))
    print(f"Analytics dataset successfully written to {args.output}")


if __name__ == "__main__":
    main()
