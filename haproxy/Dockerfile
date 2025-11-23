FROM haproxy:3.1-alpine

# Copy configuration
COPY haproxy.cfg /usr/local/etc/haproxy/haproxy.cfg

# Expose port 3000
EXPOSE 3000

# Run as non-root user
USER haproxy

# Start HAProxy
CMD ["haproxy", "-f", "/usr/local/etc/haproxy/haproxy.cfg"]
