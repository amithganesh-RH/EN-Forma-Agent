# EN Reports — Agent Service
# Dokploy: set Build Path to repo root, this Dockerfile runs the FastAPI agent.
# For the Next.js web app, point a second Dokploy app to the web/ subdirectory.

FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    wget curl gnupg ca-certificates \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0 \
    fonts-liberation libappindicator3-1 libxss1 lsb-release \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium --with-deps

COPY agent/ .

RUN mkdir -p /app/employee_navigator_reports

ENV PYTHONUNBUFFERED=1
ENV DOWNLOAD_DIR=/app/employee_navigator_reports
ENV GOOGLE_TOKEN_DIR=/tmp/en_report
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
