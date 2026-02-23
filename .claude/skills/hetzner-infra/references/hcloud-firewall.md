# hcloud firewall

Firewall management for Hetzner Cloud. Stateful, applied at hypervisor level.

## List Firewalls

```bash
hcloud firewall list
hcloud firewall describe k8s-bastion
```

## Create Firewall

```bash
hcloud firewall create --name k8s-bastion
```

## Add Rules

```bash
# Allow SSH from anywhere
hcloud firewall add-rule k8s-bastion \
  --direction in --protocol tcp --port 22 \
  --source-ips 0.0.0.0/0 --source-ips ::/0

# Allow SSH from specific IP only
hcloud firewall add-rule k8s-bastion \
  --direction in --protocol tcp --port 22 \
  --source-ips 203.0.113.0/24

# Allow HTTPS
hcloud firewall add-rule k8s-lb \
  --direction in --protocol tcp --port 443 \
  --source-ips 0.0.0.0/0 --source-ips ::/0

# Allow port range
hcloud firewall add-rule k8s-workers \
  --direction in --protocol tcp --port 30000-32767 \
  --source-ips 10.0.0.0/16

# Allow ICMP
hcloud firewall add-rule k8s-bastion \
  --direction in --protocol icmp \
  --source-ips 0.0.0.0/0 --source-ips ::/0
```

## Apply Firewalls

```bash
# Apply to server
hcloud firewall apply-to-resource k8s-bastion \
  --type server --server k8s-bastion

# Apply to label selector
hcloud firewall apply-to-resource k8s-workers \
  --type label_selector --label-selector role=worker

# Remove from server
hcloud firewall remove-from-resource k8s-bastion \
  --type server --server k8s-bastion
```

## Standard Templates

### Bastion Firewall
```bash
hcloud firewall create --name k8s-bastion
hcloud firewall add-rule k8s-bastion --direction in --protocol tcp --port 22 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule k8s-bastion --direction in --protocol udp --port 41641 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule k8s-bastion --direction in --protocol icmp --source-ips 0.0.0.0/0 --source-ips ::/0
```

### Master Firewall
```bash
hcloud firewall create --name k8s-masters
hcloud firewall add-rule k8s-masters --direction in --protocol tcp --port 22 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule k8s-masters --direction in --protocol tcp --port 6443 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule k8s-masters --direction in --protocol tcp --port 2379-2380 --source-ips 10.0.0.0/16
hcloud firewall add-rule k8s-masters --direction in --protocol tcp --port 10250-10252 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule k8s-masters --direction in --protocol tcp --port 4240 --source-ips 10.0.0.0/16
hcloud firewall add-rule k8s-masters --direction in --protocol udp --port 8472 --source-ips 10.0.0.0/16
```

### Worker Firewall
```bash
hcloud firewall create --name k8s-workers
hcloud firewall add-rule k8s-workers --direction in --protocol tcp --port 22 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule k8s-workers --direction in --protocol tcp --port 10250 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule k8s-workers --direction in --protocol tcp --port 30000-32767 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule k8s-workers --direction in --protocol tcp --port 4240 --source-ips 10.0.0.0/16
hcloud firewall add-rule k8s-workers --direction in --protocol udp --port 8472 --source-ips 10.0.0.0/16
```

### Load Balancer Firewall
```bash
hcloud firewall create --name k8s-lb
hcloud firewall add-rule k8s-lb --direction in --protocol tcp --port 80 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule k8s-lb --direction in --protocol tcp --port 443 --source-ips 0.0.0.0/0 --source-ips ::/0
```

## Delete Firewall

```bash
hcloud firewall delete k8s-bastion
```

## Security Best Practices

1. **Default deny** - Only allow what's needed
2. **Use private networks** - Restrict internal traffic to 10.0.0.0/16 + VPN 100.64.0.0/10
3. **Limit SSH** - Only from bastion or specific IPs
4. **No public K8s API** - Access via VPN only
