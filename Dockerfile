# syntax=docker/dockerfile:1.6
#
# Custom Airflow image with Java (สำหรับ PySpark) + project dependencies
#
ARG AIRFLOW_VERSION=2.10.3
ARG PYTHON_VERSION=3.11
FROM apache/airflow:${AIRFLOW_VERSION}-python${PYTHON_VERSION}

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

# ---- system deps (Java JRE for PySpark) -----------------------------------
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openjdk-17-jre-headless \
        procps \
        curl \
        ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ---- Python deps ----------------------------------------------------------
USER airflow
COPY --chown=airflow:root requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# Project ถูก mount เข้า /opt/airflow/project ผ่าน docker-compose volume
ENV LAZADA_PROJECT_DIR=/opt/airflow/project \
    LAZADA_STAGING_DIR=/opt/airflow/project/data/_staging \
    LAZADA_OUTPUT_PATH=/opt/airflow/project/data/analytics/dashboard_data.json \
    PYTHONPATH=/opt/airflow/project:${PYTHONPATH}
