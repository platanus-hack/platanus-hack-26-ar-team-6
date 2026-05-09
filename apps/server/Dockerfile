FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY apps/server/pyproject.toml ./
COPY apps/server/src ./src
COPY migrations ./migrations
COPY seeds ./seeds

RUN uv pip install --system .

CMD ["python", "-m", "relevo"]
