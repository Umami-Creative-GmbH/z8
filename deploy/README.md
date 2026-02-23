# Deployment

This directory contains deployment configurations for the Z8 platform.

## Directory Structure

```
deploy/
├── compose/                    # Development infrastructure
│   └── docker-compose.yml      # PostgreSQL, PgBouncer, Valkey, Vault, BullBoard
├── k8s/                        # Kubernetes manifests
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── webapp.yaml             # Next.js webapp deployment
│   ├── worker.yaml             # BullMQ worker deployment
│   ├── migration.yaml          # Database migration job
│   ├── db-seed.yaml            # Database seeding job
│   ├── ingress.yaml            # NGINX ingress
│   └── kustomization.yaml      # Kustomize configuration
├── .env.template               # Environment variables template
└── .vault-data/                # Vault persistent data (gitignored)
```

## Container Images

The root `Dockerfile` builds multiple optimized containers:

| Target | Image Name | Purpose | Size (est.) |
|--------|------------|---------|-------------|
| `webapp` | z8-webapp | Next.js production server | ~500MB |
| `worker` | z8-worker | BullMQ job processor + cron | ~400MB |
| `migration` | z8-migration | One-shot Drizzle migration | ~350MB |
| `db-seed` | z8-db-seed | One-shot database seeder | ~350MB |

> **Note:** Images are larger than standalone mode (~300MB) because Next.js 16's
> `cacheComponents` feature is not compatible with `output: "standalone"`.
> The standard build includes full node_modules but ensures full compatibility.

## GitHub Actions: GHCR Publishing

The workflow at `.github/workflows/publish-images.yml` builds and publishes the main production images to GHCR:

- `ghcr.io/umami-creative-gmbh/z8-webapp`
- `ghcr.io/umami-creative-gmbh/z8-worker`
- `ghcr.io/umami-creative-gmbh/z8-migration`

### Triggers

- Push to `main` (publishes rolling images)
- Push semver tag `v*.*.*` (publishes release images)
- Manual run via `workflow_dispatch`

### Published Tags

- On `main`: `latest`, `sha-<shortsha>`
- On `vX.Y.Z`: `vX.Y.Z`, `vX.Y`, `vX`, `sha-<shortsha>`

`latest` is only published from `main`.

### Example Release Tag

```bash
git tag v1.2.3
git push origin v1.2.3
```

## Quick Start

### Development (Local Infrastructure Only)

```bash
# From repository root
pnpm docker:up        # Start PostgreSQL, PgBouncer, Valkey, BullBoard
pnpm docker:down      # Stop all services
pnpm docker:logs      # View logs

# Run webapp locally
pnpm dev:webapp
```

### Production (Full Stack with Docker)

```bash
# 1. Create environment file
cp deploy/.env.template .env

# 2. Edit .env with your secrets
#    POSTGRES_PASSWORD, BETTER_AUTH_SECRET are required

# 3. Build all images
docker compose -f docker-compose.prod.yml build

# 4. Start infrastructure
docker compose -f docker-compose.prod.yml up -d db pgbouncer valkey

# 5. Run migrations
docker compose -f docker-compose.prod.yml up migration

# 6. Start webapp and worker
docker compose -f docker-compose.prod.yml up -d webapp worker

# 7. (Optional) Seed database
docker compose -f docker-compose.prod.yml --profile seed up db-seed
```

### Build Individual Images

```bash
# Build from repository root
docker build --target webapp -t z8-webapp:latest .
docker build --target worker -t z8-worker:latest .
docker build --target migration -t z8-migration:latest .
docker build --target db-seed -t z8-db-seed:latest .

# Or build all at once
pnpm docker:build:all
```

## Kubernetes Deployment

### Prerequisites

- Kubernetes cluster (1.24+)
- kubectl configured
- Container registry access
- PostgreSQL and Valkey services (can be deployed separately or use managed services)

### Deploy with Kustomize

```bash
# 1. Update image references in kustomization.yaml
cd deploy/k8s
vim kustomization.yaml  # Change your-registry.com to your actual registry

# 2. Update secrets (DO NOT commit real secrets!)
kubectl create secret generic z8-secrets \
  --namespace=z8 \
  --from-literal=postgres-user=z8 \
  --from-literal=postgres-password=<your-password> \
  --from-literal=auth-secret=$(openssl rand -base64 32)

# 3. Update configmap with your domain
vim configmap.yaml

# 4. Deploy
kubectl apply -k .

# 5. Check status
kubectl get pods -n z8
kubectl logs -n z8 -l app.kubernetes.io/component=webapp
```

### Manual Migration

```bash
# Run migration job manually
kubectl apply -f migration.yaml
kubectl wait --for=condition=complete job/z8-migration -n z8 --timeout=300s
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| webapp | 3000 | Next.js production server |
| PostgreSQL | 5433 | Primary database (direct access) |
| PgBouncer | 5432 | Connection pooler (app connects here) |
| Valkey | 6379 | Redis-compatible cache/sessions |
| Bull Board | 3100 | Job queue dashboard |
| Vault | 8200 | Secrets management (optional) |

## Worker and Cron Jobs

The worker container handles both one-off jobs and scheduled cron tasks using BullMQ repeatable jobs:

| Cron Job | Schedule | Description |
|----------|----------|-------------|
| `cron:vacation` | Daily midnight | Vacation automation (carryover, expiry, accrual) |
| `cron:export` | Every 5 minutes | Process pending data exports |
| `cron:organization-cleanup` | Daily 1 AM | Delete soft-deleted organizations |
| `cron:break-enforcement` | Every minute | Check break compliance |
| `cron:project-deadlines` | Hourly | Project deadline notifications |
| `cron:telemetry` | Every 15 minutes | Telemetry collection |

Monitor jobs via Bull Board at http://localhost:3100 (admin/admin by default).

To disable cron jobs on a worker instance:
```bash
ENABLE_CRON_JOBS=false
```

## Health Checks

### Webapp

- **Endpoint**: `GET /api/health`
- **200**: All services healthy
- **503**: Database unavailable

```bash
curl http://localhost:3000/api/health
```

### Worker

- **Method**: Valkey ping test
- **Checks**: Can connect to job queue backend

## Environment Variables

See `deploy/.env.template` for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | Yes | Database password |
| `BETTER_AUTH_SECRET` | Yes | Session encryption key |
| `NEXT_PUBLIC_APP_URL` | Yes | Public URL of the application |
| `VALKEY_HOST` | No | Cache host (default: localhost) |
| `WORKER_CONCURRENCY` | No | Worker parallel jobs (default: 5) |
| `ENABLE_CRON_JOBS` | No | Enable repeatable cron (default: true) |

## Vault Setup (Optional)

For per-organization email configuration:

```bash
# 1. Start Vault
docker compose -f docker-compose.prod.yml --profile vault up -d vault

# 2. Initialize
docker compose exec vault vault operator init -key-shares=1 -key-threshold=1

# 3. Save Unseal Key and Root Token securely

# 4. Unseal
docker compose exec vault vault operator unseal <UNSEAL_KEY>

# 5. Add token to environment
echo "VAULT_TOKEN=<root_token>" >> .env
```

## Scaling

### Docker Compose

```bash
# Scale webapp to 3 replicas
docker compose -f docker-compose.prod.yml up -d --scale webapp=3
```

### Kubernetes

The HPA (Horizontal Pod Autoscaler) is configured for both webapp and worker:

- **Webapp**: 3-10 replicas, scales on CPU (70%) and memory (80%)
- **Worker**: 2-10 replicas, scales on CPU (75%)

Manual scaling:
```bash
kubectl scale deployment z8-webapp -n z8 --replicas=5
```

## Monitoring

Recommended observability stack:

1. **Metrics**: Prometheus + Grafana
2. **Logging**: Loki or Elasticsearch
3. **Tracing**: OpenTelemetry collector (set `OTEL_EXPORTER_OTLP_ENDPOINT`)

## Security

- All containers run as non-root user (UID 1001)
- Distroless variants available for minimum attack surface
- Network policies recommended in production
- Use Kubernetes Secrets or external secret management
- Never commit real secrets to version control

## Troubleshooting

### Migration fails

```bash
# Check migration logs
docker compose -f docker-compose.prod.yml logs migration

# Run migration manually with verbose output
docker compose -f docker-compose.prod.yml run --rm migration pnpm exec drizzle-kit push --verbose
```

### Webapp won't start

```bash
# Check health endpoint
curl -v http://localhost:3000/api/health

# Check database connectivity
docker compose -f docker-compose.prod.yml exec webapp node -e "
  const { Client } = require('pg');
  const c = new Client({host: 'pgbouncer', database: 'z8', user: 'z8', password: process.env.POSTGRES_PASSWORD});
  c.connect().then(() => console.log('Connected')).catch(e => console.error(e));
"
```

### Worker not processing jobs

```bash
# Check worker logs
docker compose -f docker-compose.prod.yml logs -f worker

# Check Bull Board for job status
open http://localhost:3100

# Verify Valkey connection
docker compose -f docker-compose.prod.yml exec worker node -e "
  const Redis = require('ioredis');
  const r = new Redis({host: 'valkey'});
  r.ping().then(console.log);
"
```
