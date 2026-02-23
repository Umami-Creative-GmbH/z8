# Infrastructure Provisioning

Step-by-step infrastructure setup. Cloud-agnostic concepts, Hetzner implementation.

## Provisioning Phases

### Phase 1: Authentication

```bash
export HCLOUD_TOKEN="your-token"
hcloud context create production
hcloud server list  # Verify
```

### Phase 2: SSH Keys

```bash
# Generate key (Ed25519 recommended)
ssh-keygen -t ed25519 -C "admin@example.com" -f ~/.ssh/cloud_admin

# Upload
hcloud ssh-key create --name admin-key --public-key-from-file ~/.ssh/cloud_admin.pub
```

### Phase 3: Networking

Private network for cluster communication.

**Design**:
```
Network: 10.0.0.0/16 (65,536 addresses)
├── 10.0.0.0/24  - Infrastructure (bastion, LB)
├── 10.0.1.0/24  - Control plane
├── 10.0.2.0/24  - Workers
└── 10.0.10.0/24 - Service IPs (MetalLB)
```

```bash
PROJECT="k8s"

hcloud network create --name ${PROJECT}-network --ip-range 10.0.0.0/16
hcloud network add-subnet ${PROJECT}-network \
  --type cloud \
  --network-zone eu-central \
  --ip-range 10.0.0.0/16
```

### Phase 4: Firewall Rules

Defense in depth with least privilege.

**Required Ports**:

| Port | Protocol | Purpose | Source |
|------|----------|---------|--------|
| 22 | TCP | SSH | Bastion: public, Others: private |
| 6443 | TCP | K8s API | Private + VPN |
| 2379-2380 | TCP | etcd | Control plane only |
| 10250-10252 | TCP | Kubelet | Private + VPN |
| 4240 | TCP | Cilium health | Private |
| 8472 | UDP | Cilium VXLAN | Private |
| 30000-32767 | TCP | NodePorts | LB + VPN |
| 41641 | UDP | Tailscale/WireGuard | Public (bastion only) |

```bash
# Bastion (public SSH + VPN)
hcloud firewall create --name ${PROJECT}-bastion
hcloud firewall add-rule ${PROJECT}-bastion --direction in --protocol tcp --port 22 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule ${PROJECT}-bastion --direction in --protocol udp --port 41641 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule ${PROJECT}-bastion --direction in --protocol icmp --source-ips 0.0.0.0/0 --source-ips ::/0

# Masters (private + VPN)
hcloud firewall create --name ${PROJECT}-masters
hcloud firewall add-rule ${PROJECT}-masters --direction in --protocol tcp --port 22 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule ${PROJECT}-masters --direction in --protocol tcp --port 6443 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule ${PROJECT}-masters --direction in --protocol tcp --port 2379-2380 --source-ips 10.0.0.0/16
hcloud firewall add-rule ${PROJECT}-masters --direction in --protocol tcp --port 10250-10252 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule ${PROJECT}-masters --direction in --protocol tcp --port 4240 --source-ips 10.0.0.0/16
hcloud firewall add-rule ${PROJECT}-masters --direction in --protocol udp --port 8472 --source-ips 10.0.0.0/16

# Workers (private + VPN)
hcloud firewall create --name ${PROJECT}-workers
hcloud firewall add-rule ${PROJECT}-workers --direction in --protocol tcp --port 22 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule ${PROJECT}-workers --direction in --protocol tcp --port 10250 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule ${PROJECT}-workers --direction in --protocol tcp --port 30000-32767 --source-ips 10.0.0.0/16 --source-ips 100.64.0.0/10
hcloud firewall add-rule ${PROJECT}-workers --direction in --protocol tcp --port 4240 --source-ips 10.0.0.0/16
hcloud firewall add-rule ${PROJECT}-workers --direction in --protocol udp --port 8472 --source-ips 10.0.0.0/16

# Load Balancer (public HTTP/HTTPS)
hcloud firewall create --name ${PROJECT}-lb
hcloud firewall add-rule ${PROJECT}-lb --direction in --protocol tcp --port 80 --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall add-rule ${PROJECT}-lb --direction in --protocol tcp --port 443 --source-ips 0.0.0.0/0 --source-ips ::/0
```

### Phase 5: Placement Groups (HA)

Spread instances across physical hosts.

```bash
# For 3+ master clusters
hcloud placement-group create --name ${PROJECT}-masters --type spread
```

### Phase 6: Compute Instances

**Sizing**:

| Role | Minimum | Recommended |
|------|---------|-------------|
| Bastion | 2 vCPU, 4GB (cx23) | 2 vCPU, 4GB |
| Master | 2 vCPU, 4GB (cx23) | 4 vCPU, 8GB (cx33) |
| Worker | 2 vCPU, 4GB (cx23) | 4 vCPU, 8GB (cx33) |

```bash
LOCATION="fsn1"

# Bastion
hcloud server create \
  --name ${PROJECT}-bastion \
  --type cx23 \
  --image ubuntu-24.04 \
  --location $LOCATION \
  --ssh-key admin-key \
  --network ${PROJECT}-network \
  --ip 10.0.0.1 \
  --firewall ${PROJECT}-bastion \
  --label env=production \
  --label role=bastion

# Masters
for i in 1 2 3; do
  hcloud server create \
    --name ${PROJECT}-master-$i \
    --type cx33 \
    --image ubuntu-24.04 \
    --location $LOCATION \
    --ssh-key admin-key \
    --network ${PROJECT}-network \
    --ip 10.0.1.$i \
    --firewall ${PROJECT}-masters \
    --placement-group ${PROJECT}-masters \
    --label env=production \
    --label role=master
done

# Workers
for i in 1 2; do
  hcloud server create \
    --name ${PROJECT}-worker-$i \
    --type cx33 \
    --image ubuntu-24.04 \
    --location $LOCATION \
    --ssh-key admin-key \
    --network ${PROJECT}-network \
    --ip 10.0.2.$i \
    --firewall ${PROJECT}-workers \
    --label env=production \
    --label role=worker
done
```

### Phase 7: Load Balancer

Layer 4 (TCP) load balancing for ingress.

```bash
# Create
hcloud load-balancer create --name ${PROJECT}-lb --type lb11 --location $LOCATION

# Attach to network
hcloud load-balancer attach-to-network ${PROJECT}-lb \
  --network ${PROJECT}-network \
  --ip 10.0.0.10

# Add worker targets
hcloud load-balancer add-target ${PROJECT}-lb \
  --label-selector role=worker \
  --use-private-ip

# HTTPS service (443 -> 30443)
hcloud load-balancer add-service ${PROJECT}-lb \
  --protocol tcp \
  --listen-port 443 \
  --destination-port 30443 \
  --health-check-protocol tcp \
  --health-check-port 30443

# HTTP service (80 -> 30080)
hcloud load-balancer add-service ${PROJECT}-lb \
  --protocol tcp \
  --listen-port 80 \
  --destination-port 30080
```

### Phase 8: DNS Configuration

Wildcard DNS for dynamic ingress routing.

```bash
DOMAIN="example.com"
LB_IP=$(hcloud load-balancer describe ${PROJECT}-lb -o format='{{.PublicNet.IPv4.IP}}')

# Create zone
hcloud zone create --name $DOMAIN

# Root and wildcard
hcloud zone add-records $DOMAIN --type A --name @ --value $LB_IP
hcloud zone add-records $DOMAIN --type A --name "*" --value $LB_IP
```

## Tier Configurations

### Minimal (~€12/mo)
- 1 bastion (cx23): €3
- 1 master (cx23, schedulable): €3
- 1 lb11: €6

### Small (~€21/mo)
- 1 bastion (cx23): €3
- 1 master (cx23): €3
- 2 workers (cx23): €6
- 1 lb11: €6
- Volume 50GB: €2.50

### Medium (~€34/mo)
- 1 bastion (cx23): €3
- 3 masters (cx23): €9
- 2 workers (cx33): €10
- 1 lb11: €6
- Volume 100GB: €5

### Production (~€48/mo)
- 1 bastion (cx23): €3
- 3 masters (cx33): €15
- 3 workers (cx33): €15
- 1 lb11: €6
- Volume 200GB: €10
