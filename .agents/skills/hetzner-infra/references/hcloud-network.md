# hcloud network

Private network management for Hetzner Cloud.

## List Networks

```bash
# List all networks
hcloud network list

# Detailed view
hcloud network describe k8s-network
```

## Create Network

```bash
# Create network with IP range
hcloud network create \
  --name k8s-network \
  --ip-range 10.0.0.0/16

# With labels
hcloud network create \
  --name k8s-network \
  --ip-range 10.0.0.0/16 \
  --label env=production
```

## Subnets

```bash
# Add subnet
hcloud network add-subnet k8s-network \
  --type cloud \
  --network-zone eu-central \
  --ip-range 10.0.0.0/24

# Remove subnet
hcloud network remove-subnet k8s-network \
  --ip-range 10.0.1.0/24
```

## Routes

```bash
# Add route (for VPN gateway)
hcloud network add-route k8s-network \
  --destination 192.168.0.0/16 \
  --gateway 10.0.0.1

# Remove route
hcloud network remove-route k8s-network \
  --destination 192.168.0.0/16 \
  --gateway 10.0.0.1
```

## Network Zones

| Zone | Locations |
|------|-----------|
| eu-central | fsn1, nbg1, hel1 |
| us-east | ash |
| us-west | hil |
| ap-southeast | sin |

## Recommended Architecture

```
10.0.0.0/16 - Main network
├── 10.0.0.0/24 - Infrastructure (bastion, LB)
├── 10.0.1.0/24 - Control plane
├── 10.0.2.0/24 - Workers
└── 10.0.10.0/24 - Service IPs (MetalLB)
```

## Delete Network

```bash
hcloud network delete k8s-network
```

## Security Best Practices

1. **Use private networks** for all inter-server communication
2. **Plan IP ranges** - avoid conflicts with K8s pod/service CIDRs
3. **Document IP assignments** in naming conventions
