# Infrastructure Scripts

Automated scripts for Hetzner infrastructure management. All scripts are **idempotent** - safe to run multiple times.

## Idempotency Patterns

All scripts use these patterns to ensure safe re-runs:

```bash
# Check if resource exists before creating
resource_exists() {
  local type="$1" name="$2"
  hcloud "$type" describe "$name" &>/dev/null
}

# Create only if not exists
create_if_not_exists() {
  local type="$1" name="$2"
  shift 2
  if resource_exists "$type" "$name"; then
    echo "  ✓ $type '$name' already exists"
  else
    echo "  → Creating $type '$name'..."
    hcloud "$type" create --name "$name" "$@"
  fi
}
```

## setup-infrastructure.sh

Complete infrastructure setup script. **Idempotent** - safe to run multiple times.

```bash
#!/bin/bash
set -euo pipefail

# Configuration
PROJECT="${1:-k8s}"
DOMAIN="${2:-example.com}"
TIER="${3:-small}"
LOCATION="${4:-fsn1}"

echo "Setting up infrastructure: project=$PROJECT domain=$DOMAIN tier=$TIER location=$LOCATION"

# ============================================
# IDEMPOTENCY HELPERS
# ============================================

resource_exists() {
  local type="$1" name="$2"
  hcloud "$type" describe "$name" &>/dev/null
}

create_if_not_exists() {
  local type="$1" name="$2"
  shift 2
  if resource_exists "$type" "$name"; then
    echo "  ✓ $type '$name' already exists"
    return 0
  fi
  echo "  → Creating $type '$name'..."
  hcloud "$type" create --name "$name" "$@"
}

# Tier configurations (cx23/cx33/cx43/cx53 series - January 2026 pricing)
case $TIER in
  minimal)
    MASTER_COUNT=1
    WORKER_COUNT=0
    MASTER_TYPE="cx23"    # 2 vCPU, 4GB RAM - €2.99/mo
    WORKER_TYPE="cx23"
    MASTER_SCHEDULABLE=true
    ;;
  small)
    MASTER_COUNT=1
    WORKER_COUNT=2
    MASTER_TYPE="cx23"    # 2 vCPU, 4GB RAM - €2.99/mo
    WORKER_TYPE="cx23"    # 2 vCPU, 4GB RAM - €2.99/mo
    MASTER_SCHEDULABLE=false
    ;;
  medium)
    MASTER_COUNT=3
    WORKER_COUNT=2
    MASTER_TYPE="cx23"    # 2 vCPU, 4GB RAM - €2.99/mo
    WORKER_TYPE="cx33"    # 4 vCPU, 8GB RAM - €4.99/mo
    MASTER_SCHEDULABLE=false
    ;;
  production)
    MASTER_COUNT=3
    WORKER_COUNT=3
    MASTER_TYPE="cx33"    # 4 vCPU, 8GB RAM - €4.99/mo
    WORKER_TYPE="cx33"    # 4 vCPU, 8GB RAM - €4.99/mo
    MASTER_SCHEDULABLE=false
    ;;
  *)
    echo "Unknown tier: $TIER"
    exit 1
    ;;
esac

# Create network (use /16 to match actual subnet)
echo "Creating network..."
if ! resource_exists network "${PROJECT}-network"; then
  hcloud network create --name ${PROJECT}-network --ip-range 10.0.0.0/16
  hcloud network add-subnet ${PROJECT}-network \
    --type cloud \
    --network-zone eu-central \
    --ip-range 10.0.0.0/16
else
  echo "  ✓ Network '${PROJECT}-network' already exists"
fi

# Create firewalls
echo "Creating firewalls..."
./scripts/create-firewalls.sh $PROJECT

# Create placement group for masters
if [ $MASTER_COUNT -gt 1 ]; then
  echo "Creating placement group..."
  create_if_not_exists placement-group "${PROJECT}-masters" --type spread
fi

# Create bastion (explicit IP for consistent addressing)
echo "Creating bastion..."
if ! resource_exists server "${PROJECT}-bastion"; then
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
else
  echo "  ✓ Server '${PROJECT}-bastion' already exists"
fi

# Create masters (parallel for speed, skip existing)
echo "Creating masters..."
PIDS=""
for i in $(seq 1 $MASTER_COUNT); do
  if resource_exists server "${PROJECT}-master-$i"; then
    echo "  ✓ Server '${PROJECT}-master-$i' already exists"
    continue
  fi

  PLACEMENT=""
  if [ $MASTER_COUNT -gt 1 ]; then
    PLACEMENT="--placement-group ${PROJECT}-masters"
  fi

  echo "  → Creating server '${PROJECT}-master-$i'..."
  hcloud server create \
    --name ${PROJECT}-master-$i \
    --type $MASTER_TYPE \
    --image ubuntu-24.04 \
    --location $LOCATION \
    --ssh-key admin-key \
    --network ${PROJECT}-network \
    --ip 10.0.1.$i \
    --firewall ${PROJECT}-masters \
    $PLACEMENT \
    --label env=production \
    --label role=master &
  PIDS="$PIDS $!"
done

# Create workers (parallel for speed, skip existing)
if [ $WORKER_COUNT -gt 0 ]; then
  echo "Creating workers..."
  for i in $(seq 1 $WORKER_COUNT); do
    if resource_exists server "${PROJECT}-worker-$i"; then
      echo "  ✓ Server '${PROJECT}-worker-$i' already exists"
      continue
    fi

    echo "  → Creating server '${PROJECT}-worker-$i'..."
    hcloud server create \
      --name ${PROJECT}-worker-$i \
      --type $WORKER_TYPE \
      --image ubuntu-24.04 \
      --location $LOCATION \
      --ssh-key admin-key \
      --network ${PROJECT}-network \
      --ip 10.0.2.$i \
      --firewall ${PROJECT}-workers \
      --label env=production \
      --label role=worker &
    PIDS="$PIDS $!"
  done
fi

# Wait for all new servers to be created
if [ -n "$PIDS" ]; then
  echo "Waiting for new servers to be ready..."
  for pid in $PIDS; do
    wait $pid || true
  done
fi
echo "All servers ready."

# Create load balancer
echo "Creating load balancer..."
if ! resource_exists load-balancer "${PROJECT}-lb"; then
  hcloud load-balancer create \
    --name ${PROJECT}-lb \
    --type lb11 \
    --location $LOCATION

  hcloud load-balancer attach-to-network ${PROJECT}-lb \
    --network ${PROJECT}-network \
    --ip 10.0.0.10

  # Add targets
  if [ $WORKER_COUNT -gt 0 ]; then
    hcloud load-balancer add-target ${PROJECT}-lb \
      --label-selector role=worker \
      --use-private-ip
  else
    hcloud load-balancer add-target ${PROJECT}-lb \
      --label-selector role=master \
      --use-private-ip
  fi

  # Add services with explicit health check configuration
  hcloud load-balancer add-service ${PROJECT}-lb \
    --protocol tcp --listen-port 443 --destination-port 30443 \
    --health-check-protocol tcp --health-check-port 30443 \
    --health-check-interval 5s --health-check-timeout 3s --health-check-retries 3

  hcloud load-balancer add-service ${PROJECT}-lb \
    --protocol tcp --listen-port 80 --destination-port 30080 \
    --health-check-protocol tcp --health-check-port 30080 \
    --health-check-interval 5s --health-check-timeout 3s --health-check-retries 3
else
  echo "  ✓ Load balancer '${PROJECT}-lb' already exists"
fi

# Setup DNS
echo "Setting up DNS..."
LB_IP=$(hcloud load-balancer describe ${PROJECT}-lb -o format='{{.PublicNet.IPv4.IP}}')
./scripts/setup-dns.sh $DOMAIN $LB_IP

echo "Infrastructure setup complete!"
echo "Bastion IP: $(hcloud server ip ${PROJECT}-bastion)"
echo "Load Balancer IP: $LB_IP"
```

## destroy-infrastructure.sh

```bash
#!/bin/bash
set -euo pipefail

PROJECT="${1:-k8s}"
DOMAIN="${2:-example.com}"

echo "Destroying infrastructure: project=$PROJECT"
read -p "Are you sure? (yes/no): " confirm
[ "$confirm" != "yes" ] && exit 1

# Delete servers
echo "Deleting servers..."
for server in $(hcloud server list --selector env=production -o noheader -o columns=name | grep "^${PROJECT}-"); do
  echo "Deleting server: $server"
  hcloud server delete "$server" || true
done

# Delete load balancer
echo "Deleting load balancer..."
hcloud load-balancer delete ${PROJECT}-lb || true

# Delete placement groups
echo "Deleting placement groups..."
hcloud placement-group delete ${PROJECT}-masters || true

# Delete firewalls
echo "Deleting firewalls..."
hcloud firewall delete ${PROJECT}-bastion || true
hcloud firewall delete ${PROJECT}-masters || true
hcloud firewall delete ${PROJECT}-workers || true
hcloud firewall delete ${PROJECT}-lb || true

# Delete network
echo "Deleting network..."
hcloud network delete ${PROJECT}-network || true

# Clean DNS (optional - preserves zone)
echo "Cleaning DNS records..."
./scripts/cleanup-dns.sh $DOMAIN || true

echo "Infrastructure destroyed!"
```

## create-firewalls.sh

**Idempotent** - creates firewalls only if they don't exist.

```bash
#!/bin/bash
set -euo pipefail

PROJECT="${1:-k8s}"

# Network ranges
PRIVATE_NET="10.0.0.0/16"    # Hetzner private network
VPN_NET="100.64.0.0/10"       # Tailscale/Headscale VPN range

# Idempotency helper
firewall_exists() {
  hcloud firewall describe "$1" &>/dev/null
}

create_firewall_if_not_exists() {
  local name="$1"
  shift
  if firewall_exists "$name"; then
    echo "  ✓ Firewall '$name' already exists"
    return 0
  fi
  echo "  → Creating firewall '$name'..."
  hcloud firewall create --name "$name"
  # Add all rules passed as arguments
  for rule in "$@"; do
    eval "hcloud firewall add-rule $name $rule"
  done
}

# Bastion (public SSH + VPN port)
create_firewall_if_not_exists "${PROJECT}-bastion" \
  "--direction in --protocol tcp --port 22 --source-ips 0.0.0.0/0 --source-ips ::/0" \
  "--direction in --protocol udp --port 41641 --source-ips 0.0.0.0/0 --source-ips ::/0" \
  "--direction in --protocol icmp --source-ips 0.0.0.0/0 --source-ips ::/0"

# Masters (private network + VPN access for kubectl)
create_firewall_if_not_exists "${PROJECT}-masters" \
  "--direction in --protocol tcp --port 22 --source-ips $PRIVATE_NET --source-ips $VPN_NET" \
  "--direction in --protocol tcp --port 6443 --source-ips $PRIVATE_NET --source-ips $VPN_NET" \
  "--direction in --protocol tcp --port 2379-2380 --source-ips $PRIVATE_NET" \
  "--direction in --protocol tcp --port 10250-10252 --source-ips $PRIVATE_NET --source-ips $VPN_NET" \
  "--direction in --protocol tcp --port 4240 --source-ips $PRIVATE_NET" \
  "--direction in --protocol udp --port 8472 --source-ips $PRIVATE_NET"

# Workers (private network + VPN access for services)
create_firewall_if_not_exists "${PROJECT}-workers" \
  "--direction in --protocol tcp --port 22 --source-ips $PRIVATE_NET --source-ips $VPN_NET" \
  "--direction in --protocol tcp --port 10250 --source-ips $PRIVATE_NET --source-ips $VPN_NET" \
  "--direction in --protocol tcp --port 30000-32767 --source-ips $PRIVATE_NET --source-ips $VPN_NET" \
  "--direction in --protocol tcp --port 4240 --source-ips $PRIVATE_NET" \
  "--direction in --protocol udp --port 8472 --source-ips $PRIVATE_NET"

# Load Balancer (public HTTP/HTTPS)
create_firewall_if_not_exists "${PROJECT}-lb" \
  "--direction in --protocol tcp --port 80 --source-ips 0.0.0.0/0 --source-ips ::/0" \
  "--direction in --protocol tcp --port 443 --source-ips 0.0.0.0/0 --source-ips ::/0"

echo "Firewalls ready!"
```

## setup-dns.sh

**Idempotent** - creates or updates DNS records without duplicates.

```bash
#!/bin/bash
set -euo pipefail

DOMAIN="${1}"
LB_IP="${2}"

# Idempotency helpers
zone_exists() {
  hcloud zone describe "$1" &>/dev/null
}

record_exists() {
  local domain="$1" type="$2" name="$3"
  hcloud zone rrset list "$domain" -o json 2>/dev/null | \
    jq -e ".[] | select(.type == \"$type\" and .name == \"$name\")" &>/dev/null
}

set_record() {
  local domain="$1" type="$2" name="$3" value="$4"
  if record_exists "$domain" "$type" "$name"; then
    # Update existing record
    echo "  ↻ Updating $type record '$name' -> $value"
    hcloud zone update-record "$domain" --type "$type" --name "$name" --value "$value"
  else
    # Create new record
    echo "  → Creating $type record '$name' -> $value"
    hcloud zone add-records "$domain" --type "$type" --name "$name" --value "$value"
  fi
}

# Create zone if not exists
if ! zone_exists "$DOMAIN"; then
  echo "  → Creating zone '$DOMAIN'..."
  hcloud zone create --name "$DOMAIN"
else
  echo "  ✓ Zone '$DOMAIN' already exists"
fi

# Set records (idempotent - creates or updates)
set_record "$DOMAIN" A "@" "$LB_IP"
set_record "$DOMAIN" A "*" "$LB_IP"

echo "DNS setup complete for $DOMAIN -> $LB_IP"
```
