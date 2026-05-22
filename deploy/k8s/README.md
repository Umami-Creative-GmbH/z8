# Kubernetes

This directory will contain Kubernetes manifests and Helm charts for deploying Z8 to Kubernetes clusters.

## Planned Structure

```
k8s/
├── base/              # Base Kustomize manifests
│   ├── deployment.yaml
│   ├── service.yaml
│   └── kustomization.yaml
├── overlays/          # Environment-specific overlays
│   ├── dev/
│   ├── staging/
│   └── production/
└── helm/              # Helm chart (alternative to Kustomize)
    └── z8/
        ├── Chart.yaml
        ├── values.yaml
        └── templates/
```

## Services to Deploy

- **webapp** - Next.js application
- **postgres** - PostgreSQL (or use managed RDS/Cloud SQL). Managed providers that require TLS should use the individual `POSTGRES_*` variables with `POSTGRES_SSL_MODE=verify-full` and either `POSTGRES_SSL_ROOT_CERT_PATH=/path/to/provider-ca.pem` for a mounted CA file or `POSTGRES_SSL_CA_CERT` for inline PEM content.
- **valkey** - Redis-compatible cache
- **vault** - Secrets management (or use cloud-native secrets)
- **workers** - Background job processors
