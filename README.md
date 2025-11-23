<div align="center">
  <img src="web/public/readme-banner.svg" alt="Fragment Arena Banner" width="100%">

  <h3>Chess Fragments AI Competition Platform</h3>

  <p>
    A competitive platform for Chess Fragments AI agents with automated matchmaking, ELO rankings, and live match streaming.
  </p>

  [![Docker](https://img.shields.io/badge/Docker-Ready-blue?logo=docker)](https://www.docker.com/)
  [![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
  [![Python 3.12](https://img.shields.io/badge/Python-3.12-blue?logo=python)](https://www.python.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
</div>

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Development](#development)
- [Deployment](#deployment)
- [Security](#security)
- [Agent Format](#agent-format)

---

## Features

- **AI Agent Competition**: Upload Python chess agents and compete against others
- **Automated Matchmaking**: Scheduled matches with ELO-based rankings
- **Live Match Streaming**: Real-time WebSocket streaming of ongoing matches
- **Leaderboard System**: Track agent performance with ELO ratings
- **Local Agent Support**: Connect external agents via WebSocket or TCP
- **Sandboxed Execution**: Secure, isolated agent execution with resource limits
- **Code Validation**: Automatic security scanning and validation
- **Match History**: Complete game logs with move-by-move analysis
- **Exhibition Matches**: Test agents against specific opponents
- **Code-Based Authentication**: Secure 256-bit access codes, no email/password required
- **Agent Versioning**: Automatic version management for agent updates
- **Performance Analytics**: Timing statistics, win rates, and benchmarks

---

## Tech Stack

### Frontend
- **Next.js 15** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type-safe development
- **Tailwind CSS 4** - Utility-first styling
- **Radix UI** - Accessible component primitives
- **Prisma** - Database ORM

### Backend
- **Next.js API Routes** - RESTful API endpoints
- **PostgreSQL 16** - Primary database
- **Redis 7** - Caching and task queue
- **Python 3.12** - Agent execution and validation
- **Celery** - Distributed task processing
- **HAProxy** - Load balancing and reverse proxy

### Chess Engine
- **chessmaker** - Custom Chess Fragments implementation

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         HAProxy                             │
│                    (Port 3892)                              │
└───────────────┬─────────────────────┬───────────────────────┘
                │                     │
        ┌───────▼────────┐    ┌───────▼───────────┐
        │   Next.js Web  │    │  Local Agent      │
        │   (Port 3000)  │    │  WebSocket Server │
        └───────┬────────┘    └───────────────────┘
                │
        ┌───────▼────────────────────────────────────┐
        │          Internal Network                  │
        ├──────────────┬──────────────┬──────────────┤
        │  PostgreSQL  │    Redis     │   Celery     │
        │  (Port 5432) │  (Port 6379) │   Workers    │
        └──────────────┴──────────────┴──────────────┘
                                      │
                          ┌───────────▼──────────┐
                          │  Validator Service   │
                          │  (Sandboxed)         │
                          └──────────────────────┘
```

### Services

| Service | Description | Network Access |
|---------|-------------|----------------|
| **web** | Next.js application, API routes | Internal + External |
| **postgres** | PostgreSQL database | Internal only |
| **redis** | Cache and task queue | Internal only |
| **haproxy** | Reverse proxy / load balancer | Internal + External |
| **executor** | Celery workers (4 replicas) | Internal only |
| **celery-beat** | Scheduled task runner | Internal only |
| **validator** | Code validation service | Internal only (sandboxed) |
| **local-agent-server** | WebSocket server for external agents | Internal + External |

---

## Prerequisites

- **Docker** (v20.10+) and **Docker Compose** (v2.0+)
- **Git**
- **8GB+ RAM** (recommended for multiple executor workers)
- **Linux/macOS** (Windows requires WSL2)

---

## Quick Start

### 1. Clone the Repository

### 2. Set Up Environment Variables

Create a `.env` file in the project root:

```bash
# Database
POSTGRES_PASSWORD=your_secure_password_here

# Authentication
NEXTAUTH_SECRET=your_nextauth_secret_here
JWT_SECRET=your_jwt_secret_here
SIGNUP_CODE=your_signup_code_here
BETA_CODE=your_beta_code_here

# Public URL (for production)
NEXTAUTH_URL=https://yourdomain.com
CORS_PRODUCTION_DOMAIN=https://yourdomain.com

# Optional: Override defaults
AGENT_TIMEOUT_SECONDS=14
AGENT_MEMORY_LIMIT_MB=512
MAX_AGENTS_PER_USER=10
```

### 3. Build and Start Services

```bash
docker compose up -d
```

This will:
- Pull and build all Docker images
- Initialize the PostgreSQL database
- Start all services
- Run database migrations

### 4. Access the Platform

- **Web Interface**: http://localhost:3892
- **Database**: localhost:5295
- **Redis**: localhost:6379 (internal only)

### 5. Verify Services are Running

```bash
docker compose ps
```

All services should show as "Up" or "healthy".

---

## Configuration

### Environment Variables

#### Database Configuration
```bash
POSTGRES_PASSWORD=postgres_dev_password  # Change in production!
DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/fragmentarena
```

#### Authentication
```bash
NEXTAUTH_SECRET=dev_secret_change_in_production  # Required for JWT
JWT_SECRET=${NEXTAUTH_SECRET}                   # Defaults to NEXTAUTH_SECRET
SIGNUP_CODE=                                     # Optional signup restriction
BETA_CODE=                                       # Optional beta access code
```

#### Agent Execution Limits
```bash
AGENT_TIMEOUT_SECONDS=14          # Max execution time per move
AGENT_MEMORY_LIMIT_MB=512         # Memory limit per agent
MAX_AGENT_SIZE_BYTES=1073741824   # 1GB max upload size
MAX_AGENTS_PER_USER=10            # Agents per user limit
```

#### Rate Limiting
```bash
# Upload limits
UPLOAD_RATE_LIMIT_REQUESTS=1      # Uploads per time window
UPLOAD_RATE_LIMIT_HOURS=1         # Time window in hours

# API rate limits
IP_RATE_LIMIT_PER_MINUTE=100
IP_RATE_LIMIT_PER_HOUR=3000
IP_RATE_LIMIT_PER_DAY=50000

USER_RATE_LIMIT_PER_MINUTE=200
USER_RATE_LIMIT_PER_HOUR=5000
USER_RATE_LIMIT_PER_DAY=100000
```

#### Security
```bash
AUTO_BLOCK_ENABLED=true           # Enable automatic IP blocking
AUTO_BLOCK_THRESHOLD=10           # Violations before block
AUTO_BLOCK_DURATION=3600000       # Block duration (ms)
IP_BLOCKLIST=                     # Comma-separated IPs to block
IP_ALLOWLIST=                     # Comma-separated IPs to allow
```

#### Logging
```bash
LOG_REQUESTS=false                # Log all HTTP requests
LOG_RATE_LIMITS=true              # Log rate limit violations
LOG_AUTH_ATTEMPTS=true            # Log authentication attempts
```

#### CORS
```bash
CORS_PRODUCTION_DOMAIN=https://yourdomain.com
```

---

## Development

### Local Development Setup

```bash
# Install dependencies for the web app
cd web
npm install

# Run Prisma migrations
npx prisma migrate dev

# Start development server (with hot reload)
npm run dev
```

The development server runs on http://localhost:3000.

### Executor Service Development

```bash
cd executor
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
celery -A worker worker --loglevel=info
```

### Database Management

```bash
# Access Prisma Studio (database GUI)
cd web
npx prisma studio

# Create a new migration
npx prisma migrate dev --name your_migration_name

# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

### Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f web
docker compose logs -f executor
docker compose logs -f validator

# Last 100 lines
docker compose logs --tail=100 web
```

### Rebuilding Services

```bash
# Rebuild all services
docker compose build

# Rebuild specific service
docker compose build web

# Rebuild and restart
docker compose up -d --build
```

### Running Tests

```bash
# Python tests (agent validator)
docker compose exec executor pytest executor/tests/

# Web security tests
cd web
node scripts/test-security.ts
```

---

## Deployment

### Production Deployment Checklist

- [ ] Set strong `POSTGRES_PASSWORD`
- [ ] Set random `NEXTAUTH_SECRET` and `JWT_SECRET`
- [ ] Configure `NEXTAUTH_URL` to your domain
- [ ] Set up `SIGNUP_CODE` and `BETA_CODE` if needed
- [ ] Configure `CORS_PRODUCTION_DOMAIN`
- [ ] Adjust rate limits for your scale
- [ ] Set `NODE_ENV=production`
- [ ] Configure SSL/TLS certificates
- [ ] Set up backup strategy for PostgreSQL
- [ ] Configure monitoring and alerts
- [ ] Review and adjust resource limits

### Docker Compose Production

```bash
# Set production environment
export NODE_ENV=production

# Build and start with production config
docker compose -f docker-compose.yml up -d --build

# Scale executor workers
docker compose up -d --scale executor=8
```

### Health Checks

All services include health checks:

```bash
# Check service health
docker compose ps

# Check specific service logs for health
docker inspect fragmentarena-db | grep Health
```

### Backups

#### PostgreSQL Backup

```bash
# Backup database
docker compose exec postgres pg_dump -U postgres fragmentarena > backup.sql

# Restore database
docker compose exec -T postgres psql -U postgres fragmentarena < backup.sql
```

#### Redis Persistence

Redis is configured with AOF (Append-Only File) persistence by default.

---

## Security

### Sandboxed Execution

The **validator** service runs with maximum security:

- **tmpfs** non-persistent filesystem
- **No internet access** (internal network only)
- **Resource limits**: 512MB RAM, 1 CPU core
- **Capabilities dropped**: Runs with minimal privileges
- **Read-only root filesystem** (except /tmp)

### Agent Execution Security

- **Docker isolation**: Each agent runs in a separate container
- **Resource limits**: CPU and memory restrictions
- **Timeout enforcement**: 14 second max execution time
- **Code validation**: AST-based security scanning
- **No network access**: Agents cannot make external requests

### API Security

- **Rate limiting**: Per-IP and per-user limits
- **JWT authentication**: Secure session management
- **Auto-blocking**: Automatic IP bans for abuse
- **Input validation**: All inputs sanitized
- **CORS protection**: Domain whitelisting
- **Security headers**: HAProxy security configurations

### Best Practices

1. **Never commit** `.env` files
2. **Rotate secrets** regularly in production
3. **Monitor logs** for suspicious activity
4. **Keep dependencies** updated
5. **Use strong passwords** for all services
6. **Enable auto-blocking** in production
7. **Review rate limits** based on traffic

---

## Agent Format

Agents must be Python files with the following signature:

```python
def agent(board, player, var):
    """
    Args:
        board: chessmaker Board object (5x5 Chess Fragments board)
        player: current Player object
        var: additional game metadata (currently ['ply', 14])

    Returns:
        (piece, move): tuple of Piece and Move objects
    """
    # Your agent logic here
    # Example: Get all legal moves
    from extension.board_utils import list_legal_moves_for

    legal_moves = list_legal_moves_for(board, player)
    if legal_moves:
        piece, move = legal_moves[0]
        return piece, move

    return None, None
```

### Allowed Imports

**Allowed:**
- `chessmaker.*` - Chess engine library
- `extension.*` - Custom Chess Fragments pieces and utilities
- Python stdlib: `random`, `itertools`, `collections`, `math`, etc.

**Forbidden:**
- `os`, `subprocess`, `socket`, `urllib`, `requests`
- Any network or filesystem access modules
- Any modules that could break the sandbox

### Validation

All agents are automatically validated before acceptance:

- **Syntax checking**: Must be valid Python
- **Import restrictions**: Only allowed imports
- **Size limits**: Max 1GB per agent
- **Duplicate detection**: SHA-256 hashing prevents resubmission
- **Security scanning**: AST analysis for dangerous patterns

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## Acknowledgments

- Built for the University of Southampton COMP2321 coursework
- Built with [chessmaker](https://github.com/LelsersLasers/chessmaker) chess engine
- UI components from [Radix UI](https://www.radix-ui.com/)
- Inspired by competitive programming platforms
