# Validator Service Dockerfile
# Dedicated service for agent validation with security hardening

FROM python:3.12-slim

# Create non-root user for security
RUN useradd -m -u 1000 validator

# Install dependencies
WORKDIR /app

# Copy requirements (use same as executor)
COPY executor/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared code (board logic, samples)
COPY shared /app/shared

# Copy validator service
COPY validator/validator_service.py /app/validator_service.py

# Set permissions
RUN chown -R validator:validator /app

# Switch to non-root user
USER validator

# Set environment
ENV PYTHONUNBUFFERED=1

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import sys; sys.exit(0)"

# Run validator service
CMD ["python3", "-u", "/app/validator_service.py"]
