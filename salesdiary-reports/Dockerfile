# Java for PySpark comes from the official Eclipse Temurin JRE image (no apt needed, Spark 4 supports Java 17/21).
FROM eclipse-temurin:17-jre-jammy AS jre

FROM python:3.12-slim-bookworm
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PYSPARK_PYTHON=python3 PYSPARK_DRIVER_PYTHON=python3 \
    DATA_DIR=/data

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

RUN useradd -m -u 1000 appuser && mkdir -p /data && chown -R appuser /data /app
USER appuser
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/healthz')" || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
