# Lazada API Dashboard

E-commerce analytics dashboard that keeps the original dashboard purpose but replaces CSV batch ingestion with Lazada Open Platform API ingestion.

## Scope

- Reuses the existing FastAPI + dashboard contract
- Pulls seller order data from Lazada API
- Builds the same analytics JSON shape consumed by the dashboard
- Supports fallback sample mode when API credentials are not configured

## Important limitation

This source is seller/order data, not marketplace clickstream. Revenue, orders, products, categories, and customer analytics are real. Funnel metrics such as `view -> cart -> purchase` are not available from order data alone, so the dashboard marks them as unavailable instead of fabricating numbers.

## Environment

Copy `.env.example` values into your environment:

- `LAZADA_APP_KEY`
- `LAZADA_APP_SECRET`
- `LAZADA_ACCESS_TOKEN`
- `LAZADA_API_URL`
- `LAZADA_ORDERS_ENDPOINT`
- `LAZADA_ORDER_ITEMS_ENDPOINT`

Default base URL is Thailand:

- `https://api.lazada.co.th/rest`

Official docs:

- [Lazada Open Platform Getting Started](https://open.lazada.com/doc/doc.htm?docId=118729&nodeId=27493)
- [Lazada Open Platform API Reference](https://open.lazada.com/doc/api.htm)

## Install

```bash
pip install -r requirements.txt
```

## Build analytics from API

Pull the last 30 days and write `data/analytics/dashboard_data.json`:

```bash
python run_pipeline.py --days 30
```

Use a fixed window:

```bash
python run_pipeline.py --start-date 2026-04-01 --end-date 2026-04-30
```

## Sample mode

If credentials are not ready yet:

```bash
python run_pipeline.py --mode sample
```

## Run the API

```bash
uvicorn backend.app:app --reload --port 8000
```

Open:

- `http://127.0.0.1:8000`

---

## Run with Apache Airflow (Docker Desktop)

โปรเจกต์มี Airflow stack พร้อมใช้งานสำหรับรัน pipeline แบบ scheduled (default: ทุกวัน 02:00).

### โครงสร้างไฟล์ที่เกี่ยวข้อง

| File | หน้าที่ |
| --- | --- |
| `Dockerfile` | Custom Airflow image — Airflow 2.10 + Python 3.11 + Java 17 (PySpark) + project deps |
| `docker-compose.yaml` | Airflow stack (Postgres + scheduler + webserver, LocalExecutor) |
| `dags/lazada_dashboard_dag.py` | DAG `lazada_dashboard_pipeline` — multi-step pipeline |
| `.env.example` | Template สำหรับตัวแปร env (คัดลอกเป็น `.env`) |
| `data/build_kaggle_spark.py` | Pipeline functions ที่ DAG เรียกใช้ (refactor ให้แยกเป็น step) |

### Quickstart

1. ติดตั้ง [Docker Desktop](https://www.docker.com/products/docker-desktop/) แล้วเปิดให้รันอยู่
2. คัดลอก env template:

   - Linux / macOS / Git Bash:
     ```bash
     cp .env.example .env
     ```
   - Windows Command Prompt (cmd.exe):
     ```cmd
     copy .env.example .env
     ```
   - Windows PowerShell:
     ```powershell
     Copy-Item .env.example .env
     ```

   แก้ค่า `KAGGLE_USERNAME` / `KAGGLE_KEY` ถ้าจำเป็น (สำหรับ public dataset ตัวนี้ไม่ต้องก็ได้)

3. Build image (ใช้เวลานานครั้งแรกเพราะติดตั้ง Java + PySpark):

   ```bash
   docker compose build
   ```

4. Initialize metadata DB + admin user (รันครั้งเดียว):

   ```bash
   docker compose up airflow-init
   ```

5. Start scheduler + webserver:

   ```bash
   docker compose up -d
   ```

6. เปิด Airflow UI:

   - URL: `http://localhost:8080`
   - User / pass: `admin` / `admin` (ตาม `.env`)

7. ที่หน้า DAGs ให้กดเปิด toggle ของ `lazada_dashboard_pipeline` แล้วกด ▶ Trigger เพื่อรันทันที — หรือรอให้รันอัตโนมัติทุกวัน 02:00

### DAG flow

```
check_environment
    └── download_dataset
            └── run_spark_aggregations
                    └── build_payload
                            └── publish_dashboard_json
                                    └── verify_output
                                            └── cleanup_staging
```

ข้อมูล intermediate (parquet/json) ถูกเก็บที่ `data/_staging/<run_id>/` ระหว่าง run และโดน `cleanup_staging` ลบทิ้งเมื่อจบ. ผลลัพธ์ฉบับ publish คือ `data/analytics/dashboard_data.json` ซึ่ง FastAPI backend อ่านโดยตรง

### ปรับขนาด workload

ตัวแปร env ที่สำคัญ (กำหนดใน `.env`):

| Var | Default | คำอธิบาย |
| --- | --- | --- |
| `LAZADA_ROWS_PER_FILE` | `500000` | จำนวน rows ต่อไฟล์ Kaggle CSV — ลดเพื่อทดสอบเร็ว, เพิ่มสำหรับ full dataset |
| `AIRFLOW_UID` | `50000` | UID ของ user ใน Airflow container (Linux: `id -u`) |
| `_AIRFLOW_WWW_USER_USERNAME` | `admin` | username สำหรับ Airflow UI |
| `_AIRFLOW_WWW_USER_PASSWORD` | `admin` | password สำหรับ Airflow UI |

### หยุด / รีเซ็ต stack

```bash
docker compose down            # หยุด container (ข้อมูลใน Postgres ยังอยู่)
docker compose down -v         # หยุด + ลบ Postgres volume (รีเซ็ต metadata ทั้งหมด)
```

### Trigger DAG จาก CLI

```bash
docker compose exec airflow-scheduler airflow dags trigger lazada_dashboard_pipeline
docker compose exec airflow-scheduler airflow dags list-runs -d lazada_dashboard_pipeline
```

