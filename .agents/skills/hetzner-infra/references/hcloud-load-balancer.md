# hcloud load-balancer

Load balancer management for Hetzner Cloud.

## List Load Balancers

```bash
hcloud load-balancer list
hcloud load-balancer describe k8s-lb
```

## Create Load Balancer

```bash
# Basic creation
hcloud load-balancer create \
  --name k8s-lb \
  --type lb11 \
  --location fsn1

# With network
hcloud load-balancer create \
  --name k8s-lb \
  --type lb11 \
  --location fsn1 \
  --network-zone eu-central
```

## Load Balancer Types

| Type | Connections | Bandwidth | Price/mo |
|------|-------------|-----------|----------|
| lb11 | 10,000 | 25 Gbps | €5.99 |
| lb21 | 25,000 | 25 Gbps | €11.99 |
| lb31 | 50,000 | 25 Gbps | €23.99 |

## Attach to Network

```bash
hcloud load-balancer attach-to-network k8s-lb \
  --network k8s-network \
  --ip 10.0.0.10
```

## Add Targets

```bash
# Add server target
hcloud load-balancer add-target k8s-lb \
  --server k8s-worker-1 \
  --use-private-ip

# Add by label selector
hcloud load-balancer add-target k8s-lb \
  --label-selector role=worker \
  --use-private-ip

# Add IP target
hcloud load-balancer add-target k8s-lb \
  --ip 10.0.2.1
```

## Add Services

```bash
# HTTP service
hcloud load-balancer add-service k8s-lb \
  --protocol http \
  --listen-port 80 \
  --destination-port 30080

# HTTPS with TLS termination
hcloud load-balancer add-service k8s-lb \
  --protocol https \
  --listen-port 443 \
  --destination-port 30443 \
  --http-certificates mycert

# TCP passthrough (for TLS passthrough)
hcloud load-balancer add-service k8s-lb \
  --protocol tcp \
  --listen-port 443 \
  --destination-port 30443

# With health check
hcloud load-balancer add-service k8s-lb \
  --protocol tcp \
  --listen-port 6443 \
  --destination-port 6443 \
  --health-check-protocol tcp \
  --health-check-port 6443 \
  --health-check-interval 5s \
  --health-check-timeout 3s \
  --health-check-retries 3
```

## Update Service

```bash
hcloud load-balancer update-service k8s-lb \
  --listen-port 443 \
  --destination-port 30443
```

## Delete Service

```bash
hcloud load-balancer delete-service k8s-lb --listen-port 80
```

## Health Checks

```bash
# Check LB health
hcloud load-balancer describe k8s-lb

# View target health
hcloud load-balancer describe k8s-lb -o json | jq '.targets[].health_status'
```

## Algorithm

```bash
# Change algorithm
hcloud load-balancer change-algorithm k8s-lb --algorithm round_robin

# Options: round_robin, least_connections
```

## Production Setup

```bash
# Create LB
hcloud load-balancer create --name k8s-lb --type lb11 --location fsn1

# Attach to network
hcloud load-balancer attach-to-network k8s-lb --network k8s-network --ip 10.0.0.10

# Add targets (workers)
hcloud load-balancer add-target k8s-lb --label-selector role=worker --use-private-ip

# Add HTTPS service (TLS passthrough to ingress)
hcloud load-balancer add-service k8s-lb \
  --protocol tcp --listen-port 443 --destination-port 30443 \
  --health-check-protocol tcp --health-check-port 30443

# Add HTTP service (redirect to HTTPS)
hcloud load-balancer add-service k8s-lb \
  --protocol tcp --listen-port 80 --destination-port 30080
```

## Delete Load Balancer

```bash
hcloud load-balancer delete k8s-lb
```
