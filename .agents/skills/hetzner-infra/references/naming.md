# Naming Convention

Consistent naming for all cloud resources.

## Pattern

```
{project}-{resource}[-{index}]
```

## Examples

| Resource | Pattern | Example |
|----------|---------|---------|
| Network | `{project}-network` | `k8s-network` |
| Bastion | `{project}-bastion` | `k8s-bastion` |
| Masters | `{project}-master-{n}` | `k8s-master-1` |
| Workers | `{project}-worker-{n}` | `k8s-worker-1` |
| Load Balancer | `{project}-lb` | `k8s-lb` |
| Firewalls | `{project}-{role}` | `k8s-bastion`, `k8s-masters` |
| Placement Groups | `{project}-{role}` | `k8s-masters` |
| Volumes | `{project}-{purpose}` | `k8s-postgres-data` |
| SSH Keys | `{user}-key` | `admin-key` |

## Labels

Standard labels for all resources:

| Label | Values | Purpose |
|-------|--------|---------|
| `env` | production, staging, dev | Environment |
| `role` | bastion, master, worker | Server role |
| `project` | k8s, myapp | Project name |
| `managed-by` | platform, terraform | Automation tracking |

## DNS Records

| Record | Pattern | Example |
|--------|---------|---------|
| Root | `@` | `example.com` |
| Wildcard | `*` | `*.example.com` |
| GitLab | `gitlab` | `gitlab.example.com` |
| ArgoCD | `argocd` | `argocd.example.com` |
| Grafana | `grafana` | `grafana.example.com` |
| Vault | `vault` | `vault.example.com` |
| API | `api` | `api.example.com` |
| App | `app` | `app.example.com` |
| S3 | `s3` | `s3.example.com` |
| Registry | `registry` | `registry.example.com` |
| VPN | `vpn` | `vpn.example.com` |

## IP Allocation

Network: `10.0.0.0/16`

| Range | Purpose |
|-------|---------|
| `10.0.0.0/24` | Infrastructure |
| `10.0.0.1` | Bastion |
| `10.0.0.10` | Load Balancer (internal) |
| `10.0.1.0/24` | Control Plane |
| `10.0.1.1-3` | master-1, master-2, master-3 |
| `10.0.2.0/24` | Workers |
| `10.0.2.1-10` | worker-1 through worker-10 |
| `10.0.10.0/24` | MetalLB Service Pool |

VPN Network: `100.64.0.0/10` (Tailscale/Headscale CGNAT range)

## Best Practices

1. **Be consistent** - Use same pattern everywhere
2. **Use lowercase** - Avoid case sensitivity issues
3. **Use hyphens** - Not underscores or spaces
4. **Include project** - Easy to identify resources
5. **Index from 1** - master-1, not master-0
