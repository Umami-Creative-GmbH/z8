# hcloud primary-ip

Primary IP management for Hetzner Cloud. Primary IPs are assigned to servers.

## List Primary IPs

```bash
hcloud primary-ip list
hcloud primary-ip describe k8s-bastion-ip
```

## Create Primary IP

```bash
# IPv4
hcloud primary-ip create \
  --name k8s-bastion-ip \
  --type ipv4 \
  --datacenter fsn1-dc14

# IPv6
hcloud primary-ip create \
  --name k8s-bastion-ip6 \
  --type ipv6 \
  --datacenter fsn1-dc14

# Assign to server on creation
hcloud primary-ip create \
  --name k8s-bastion-ip \
  --type ipv4 \
  --datacenter fsn1-dc14 \
  --assignee-id 12345 \
  --assignee-type server
```

## Assign/Unassign

```bash
# Assign to server
hcloud primary-ip assign k8s-bastion-ip --server k8s-bastion

# Unassign
hcloud primary-ip unassign k8s-bastion-ip
```

## Enable/Disable Auto-Delete

```bash
# Disable auto-delete (keep IP when server deleted)
hcloud primary-ip update k8s-bastion-ip --auto-delete=false

# Enable auto-delete
hcloud primary-ip update k8s-bastion-ip --auto-delete=true
```

## Delete Primary IP

```bash
hcloud primary-ip delete k8s-bastion-ip
```

## Pricing

| Type | Price/mo |
|------|----------|
| IPv4 | ~€4 (when unassigned) |
| IPv6 | Free |

## Primary IP vs Floating IP

| Feature | Primary IP | Floating IP |
|---------|-----------|-------------|
| Assigned to | Single server | Any server |
| Auto-assigned | Yes (on creation) | No |
| Failover | No | Yes |
| Use case | Static server IP | HA failover |
