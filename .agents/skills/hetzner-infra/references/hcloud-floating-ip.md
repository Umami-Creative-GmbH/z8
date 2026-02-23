# hcloud floating-ip

Floating IP management for Hetzner Cloud. Floating IPs can be reassigned between servers.

## List Floating IPs

```bash
hcloud floating-ip list
hcloud floating-ip describe k8s-api
```

## Create Floating IP

```bash
# IPv4
hcloud floating-ip create \
  --name k8s-api \
  --type ipv4 \
  --home-location fsn1

# IPv6
hcloud floating-ip create \
  --name k8s-api-v6 \
  --type ipv6 \
  --home-location fsn1

# With labels
hcloud floating-ip create \
  --name k8s-api \
  --type ipv4 \
  --home-location fsn1 \
  --label env=production
```

## Pricing

| Type | Price/mo |
|------|----------|
| IPv4 | ~€4 |
| IPv6 | Free |

## Assign/Unassign

```bash
# Assign to server
hcloud floating-ip assign k8s-api k8s-master-1

# Unassign
hcloud floating-ip unassign k8s-api
```

## Configure on Server

After assigning, configure the server to use the floating IP:

```bash
# Ubuntu/Debian - add to netplan
cat > /etc/netplan/60-floating-ip.yaml << 'NETPLAN'
network:
  version: 2
  ethernets:
    eth0:
      addresses:
        - 1.2.3.4/32  # Replace with your floating IP
NETPLAN

netplan apply
```

## Delete Floating IP

```bash
hcloud floating-ip delete k8s-api
```

## Use Cases

1. **High availability** - Failover between servers
2. **Static external IP** - Consistent IP for DNS
3. **Load balancer backup** - Manual failover

## Note

For most use cases, prefer Load Balancers over Floating IPs for better availability.
