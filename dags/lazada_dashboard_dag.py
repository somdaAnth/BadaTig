"""
Lazada / Kaggle e-commerce dashboard pipeline — Airflow DAG.

ลำดับ task:
    check_environment
        └── download_dataset
                └── run_spark_aggregations
                        └── build_payload
                                └── publish_dashboard_json
                                        └── verify_output

ทุก task ส่งผ่าน path ผ่าน XCom (small string) เท่านั้น —
ข้อมูลจริง (parquet/json) เก็บไว้ที่ staging dir ภายใน worker.

ตั้งเวลา: รายวัน 02:00 (ตาม timezone ของ Airflow scheduler)
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

from airflow import DAG
from airflow.operators.python import PythonOperator

# ---------------------------------------------------------------------------
# ทำให้ import "data.build_kaggle_spark" ได้ทั้งใน Airflow container
# (ที่ mount โปรเจกต์ไว้ที่ /opt/airflow/project) และตอนรัน local
# ---------------------------------------------------------------------------
PROJECT_DIR = Path(os.getenv("LAZADA_PROJECT_DIR", "/opt/airflow/project")).resolve()
if not PROJECT_DIR.exists():
    # fallback: dags อยู่ที่ <project>/dags ดังนั้น parent คือโปรเจกต์
    PROJECT_DIR = Path(__file__).resolve().parents[1]

if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

DEFAULT_STAGING_DIR = Path(os.getenv("LAZADA_STAGING_DIR", str(PROJECT_DIR / "data" / "_staging")))
DEFAULT_OUTPUT_PATH = Path(os.getenv("LAZADA_OUTPUT_PATH", str(PROJECT_DIR / "data" / "analytics" / "dashboard_data.json")))
ROWS_PER_FILE = int(os.getenv("LAZADA_ROWS_PER_FILE", "500000"))


# ---------------------------------------------------------------------------
# Task callables
# ---------------------------------------------------------------------------

def _check_environment(**_) -> str:
    """ตรวจสอบว่า project paths และ deps พร้อม."""
    project = PROJECT_DIR
    print(f"[check] PROJECT_DIR = {project}")
    print(f"[check] STAGING_DIR = {DEFAULT_STAGING_DIR}")
    print(f"[check] OUTPUT_PATH = {DEFAULT_OUTPUT_PATH}")
    print(f"[check] ROWS_PER_FILE = {ROWS_PER_FILE:,}")

    required = [
        project / "data" / "build_kaggle_spark.py",
        project / "backend" / "analytics_service.py",
    ]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        raise FileNotFoundError(f"Missing required project files: {missing}")

    # import ทดสอบ
    from data.build_kaggle_spark import download_dataset  # noqa: F401
    import pyspark  # noqa: F401
    import kagglehub  # noqa: F401

    DEFAULT_STAGING_DIR.mkdir(parents=True, exist_ok=True)
    DEFAULT_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    print("[check] Environment OK")
    return str(project)


def _download_dataset(**_) -> str:
    """Download Kaggle dataset; return cached path ผ่าน XCom."""
    from data.build_kaggle_spark import download_dataset
    dataset_path = download_dataset()
    print(f"[download] Cached at: {dataset_path}")
    return dataset_path


def _run_spark_aggregations(**context) -> str:
    """รัน Spark aggregations แล้วเก็บ parquet/meta ไว้ที่ staging dir."""
    ti = context["ti"]
    dataset_path = ti.xcom_pull(task_ids="download_dataset")
    if not dataset_path:
        raise RuntimeError("download_dataset ไม่คืนค่า dataset_path")

    from data.build_kaggle_spark import run_spark_aggregations

    # ใช้ run_id-scoped staging เพื่อกัน race ระหว่าง dag runs
    run_staging = DEFAULT_STAGING_DIR / context["run_id"].replace(":", "_")
    run_staging.mkdir(parents=True, exist_ok=True)

    staging = run_spark_aggregations(
        dataset_path=dataset_path,
        rows_per_file=ROWS_PER_FILE,
        staging_dir=run_staging,
    )
    print(f"[spark] Staging written to: {staging}")
    return staging


def _build_payload(**context) -> str:
    """Build payload dict + เซฟเป็น staging/payload.json; return path."""
    ti = context["ti"]
    staging = ti.xcom_pull(task_ids="run_spark_aggregations")
    if not staging:
        raise RuntimeError("run_spark_aggregations ไม่คืนค่า staging path")

    from data.build_kaggle_spark import build_payload, _json_default

    payload = build_payload(staging)
    payload_path = Path(staging) / "payload.json"
    payload_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )
    print(f"[payload] Written staging payload -> {payload_path}")
    return str(payload_path)


def _publish_dashboard_json(**context) -> str:
    """Atomically publish staging/payload.json -> data/analytics/dashboard_data.json."""
    ti = context["ti"]
    payload_path = ti.xcom_pull(task_ids="build_payload")
    if not payload_path:
        raise RuntimeError("build_payload ไม่คืนค่า payload_path")

    target = DEFAULT_OUTPUT_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    shutil.copyfile(payload_path, tmp)
    os.replace(tmp, target)
    print(f"[publish] Promoted -> {target}")
    return str(target)


def _verify_output(**context) -> dict:
    """อ่าน JSON ที่เพิ่ง publish แล้วตรวจ key สำคัญ."""
    ti = context["ti"]
    target = Path(ti.xcom_pull(task_ids="publish_dashboard_json") or DEFAULT_OUTPUT_PATH)
    if not target.exists():
        raise FileNotFoundError(f"dashboard_data.json not found at {target}")

    payload = json.loads(target.read_text(encoding="utf-8"))
    required_keys = ["meta", "filters", "dashboard", "funnel", "categories", "revenue", "customers", "segments", "time_behavior"]
    missing = [k for k in required_keys if k not in payload]
    if missing:
        raise ValueError(f"Output JSON missing required keys: {missing}")

    summary = {
        "engine": payload["meta"].get("engine"),
        "generated_at": payload["meta"].get("generated_at"),
        "total_events": payload["meta"].get("total_events"),
        "total_revenue": payload["dashboard"]["kpis"].get("total_revenue"),
        "total_orders": payload["dashboard"]["kpis"].get("total_orders"),
        "date_range": payload.get("filters", {}).get("date_range", {}),
    }
    print(f"[verify] OK -> {summary}")
    return summary


def _cleanup_staging(**context) -> None:
    """ลบ run-scoped staging dir เพื่อประหยัดเนื้อที่ (รันแม้ upstream fail)."""
    run_staging = DEFAULT_STAGING_DIR / context["run_id"].replace(":", "_")
    if run_staging.exists():
        shutil.rmtree(run_staging, ignore_errors=True)
        print(f"[cleanup] Removed {run_staging}")


# ---------------------------------------------------------------------------
# DAG definition
# ---------------------------------------------------------------------------

default_args = {
    "owner": "lazada-dashboard",
    "depends_on_past": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
}

with DAG(
    dag_id="lazada_dashboard_pipeline",
    description="Build Lazada / Kaggle e-commerce analytics JSON for the dashboard",
    default_args=default_args,
    start_date=datetime(2026, 5, 1),
    schedule="0 2 * * *",   # daily at 02:00
    catchup=False,
    max_active_runs=1,
    tags=["lazada", "ecommerce", "pyspark", "dashboard"],
    doc_md=__doc__,
) as dag:

    check_environment = PythonOperator(
        task_id="check_environment",
        python_callable=_check_environment,
    )

    download_dataset = PythonOperator(
        task_id="download_dataset",
        python_callable=_download_dataset,
    )

    run_spark_aggregations = PythonOperator(
        task_id="run_spark_aggregations",
        python_callable=_run_spark_aggregations,
        execution_timeout=timedelta(hours=2),
    )

    build_payload = PythonOperator(
        task_id="build_payload",
        python_callable=_build_payload,
    )

    publish_dashboard_json = PythonOperator(
        task_id="publish_dashboard_json",
        python_callable=_publish_dashboard_json,
    )

    verify_output = PythonOperator(
        task_id="verify_output",
        python_callable=_verify_output,
    )

    cleanup_staging = PythonOperator(
        task_id="cleanup_staging",
        python_callable=_cleanup_staging,
        trigger_rule="all_done",  # รันเสมอแม้ upstream จะ fail
    )

    (
        check_environment
        >> download_dataset
        >> run_spark_aggregations
        >> build_payload
        >> publish_dashboard_json
        >> verify_output
        >> cleanup_staging
    )
