# Cost Optimization

Strategies for minimizing cloud costs while maintaining performance.

## Hetzner Pricing (January 2026)

### Shared vCPU x86 (CX Series)

| Type | vCPU | RAM | Disk | €/mo |
|------|------|-----|------|------|
| cx23 | 2 | 4GB | 40GB | €2.99 |
| cx33 | 4 | 8GB | 80GB | €4.99 |
| cx43 | 8 | 16GB | 160GB | €8.99 |
| cx53 | 16 | 32GB | 320GB | €16.99 |

### ARM (CAX Series)

| Type | vCPU | RAM | Disk | €/mo |
|------|------|-----|------|------|
| cax11 | 2 | 4GB | 40GB | €3.29 |
| cax21 | 4 | 8GB | 80GB | €5.49 |
| cax31 | 8 | 16GB | 160GB | €9.49 |
| cax41 | 16 | 32GB | 320GB | €17.49 |

### Dedicated vCPU (CCX Series)

| Type | vCPU | RAM | Disk | €/mo |
|------|------|-----|------|------|
| ccx13 | 2 | 8GB | 80GB | €12.49 |
| ccx23 | 4 | 16GB | 160GB | €24.49 |
| ccx33 | 8 | 32GB | 240GB | €48.49 |
| ccx43 | 16 | 64GB | 360GB | €96.49 |

### Other Resources

| Resource | Price |
|----------|-------|
| Load Balancer lb11 | €5.99/mo |
| Load Balancer lb21 | €11.99/mo |
| Load Balancer lb31 | €23.99/mo |
| Volume Storage | €0.05/GB/mo |
| Snapshot Storage | €0.012/GB/mo |
| IPv4 Address | €4.00/mo |
| IPv6 Address | Free |
| Bandwidth | 20TB included |

## Tier Cost Estimates

### Minimal (~€12/mo)
- 1x cx23 (bastion): €3
- 1x cx23 (schedulable master): €3
- 1x lb11: €6

### Small (~€21/mo)
- 1x cx23 (bastion): €3
- 1x cx23 (master): €3
- 2x cx23 (workers): €6
- 1x lb11: €6
- Volume 50GB: €2.50

### Medium (~€34/mo)
- 1x cx23 (bastion): €3
- 3x cx23 (masters): €9
- 2x cx33 (workers): €10
- 1x lb11: €6
- Volume 100GB: €5

### Production (~€48/mo)
- 1x cx23 (bastion): €3
- 3x cx33 (masters): €15
- 3x cx33 (workers): €15
- 1x lb11: €6
- Volume 200GB: €10

## Cost Saving Strategies

### 1. Right-Size Servers

Monitor usage and downsize if underutilized:

```bash
ssh k8s-worker-1 "top -bn1 | head -10"
```

### 2. Use Private Networking

- Free traffic between servers in same location
- Avoid public bandwidth charges

### 3. Delete Unused Resources

```bash
# Find unattached volumes
hcloud volume list -o columns=name,server

# Find unused floating IPs
hcloud floating-ip list -o columns=name,server

# Delete old snapshots
hcloud image list --type snapshot
```

### 4. Use Labels for Billing

```bash
hcloud server add-label k8s-master-1 cost-center=platform
```

### 5. Schedule Non-Production

```bash
# Power off dev servers at night
hcloud server poweroff k8s-dev-worker-1

# Power on in morning
hcloud server poweron k8s-dev-worker-1
```

## Best Practices

1. **Start small** - Scale up as needed
2. **Use labels** - Track costs by project/environment
3. **Monitor usage** - Right-size based on actual needs
4. **Clean up** - Delete unused resources promptly
5. **Consider ARM** - CAX servers for compatible workloads
