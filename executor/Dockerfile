FROM python:3.12-slim

WORKDIR /app

# Install Docker CLI (for spawning agent containers)
RUN apt-get update && \
    apt-get install -y docker.io && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY executor/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY executor/ .

# Copy shared files (extension and samples from root directory)
COPY shared/ ./shared/

# Default command (overridden by docker-compose)
CMD ["celery", "-A", "worker", "worker", "--loglevel=info"]
