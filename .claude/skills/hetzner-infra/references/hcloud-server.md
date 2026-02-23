# hcloud server

Server management commands for Hetzner Cloud.

## List Servers

```bash
# List all servers
hcloud server list

# List with output format
hcloud server list -o columns=id,name,status,ipv4,datacenter

# Filter by label
hcloud server list --selector env=production
```

## Create Server

```bash
# Basic server creation
hcloud server create \
  --name k8s-master-1 \
  --type cx23 \
  --image ubuntu-24.04 \
  --location fsn1 \
  --ssh-key my-key

# With private network
hcloud server create \
  --name k8s-worker-1 \
  --type cx33 \
  --image ubuntu-24.04 \
  --location fsn1 \
  --ssh-key my-key \
  --network k8s-network

# With cloud-init
hcloud server create \
  --name k8s-bastion \
  --type cx23 \
  --image ubuntu-24.04 \
  --location fsn1 \
  --ssh-key my-key \
  --user-data-from-file cloud-init.yaml

# With placement group (spread VMs across hosts)
hcloud server create \
  --name k8s-master-1 \
  --type cx33 \
  --image ubuntu-24.04 \
  --location fsn1 \
  --ssh-key my-key \
  --placement-group k8s-masters

# With firewall
hcloud server create \
  --name k8s-worker-1 \
  --type cx33 \
  --image ubuntu-24.04 \
  --location fsn1 \
  --ssh-key my-key \
  --firewall k8s-workers

# With labels
hcloud server create \
  --name k8s-master-1 \
  --type cx33 \
  --image ubuntu-24.04 \
  --location fsn1 \
  --ssh-key my-key \
  --label env=production \
  --label role=master
```

## Server Types (January 2026 Pricing)

| Type | vCPU | RAM | Disk | Price/mo |
|------|------|-----|------|----------|
| cx23 | 2 | 4GB | 40GB | €2.99 |
| cx33 | 4 | 8GB | 80GB | €4.99 |
| cx43 | 8 | 16GB | 160GB | €8.99 |
| cx53 | 16 | 32GB | 320GB | €16.99 |
| cax11 | 2 | 4GB | 40GB | €3.29 (ARM) |
| cax21 | 4 | 8GB | 80GB | €5.49 (ARM) |
| cax31 | 8 | 16GB | 160GB | €9.49 (ARM) |
| cax41 | 16 | 32GB | 320GB | €17.49 (ARM) |

```bash
# List available server types
hcloud server-type list
```

## Manage Servers

```bash
# SSH into server
hcloud server ssh k8s-master-1

# Get server details
hcloud server describe k8s-master-1

# Get server IP
hcloud server ip k8s-master-1

# Power operations
hcloud server poweroff k8s-master-1
hcloud server poweron k8s-master-1
hcloud server reboot k8s-master-1
hcloud server reset k8s-master-1  # Hard reset

# Rebuild server (reinstall OS)
hcloud server rebuild k8s-master-1 --image ubuntu-24.04

# Change server type (resize)
hcloud server change-type k8s-master-1 --server-type cx33

# Enable rescue mode
hcloud server enable-rescue k8s-master-1 --ssh-key my-key
```

## Attach to Network

```bash
# Attach server to private network
hcloud server attach-to-network k8s-worker-1 \
  --network k8s-network \
  --ip 10.0.1.10

# Detach from network
hcloud server detach-from-network k8s-worker-1 \
  --network k8s-network
```

## Labels

```bash
# Add label
hcloud server add-label k8s-master-1 env=production

# Remove label
hcloud server remove-label k8s-master-1 env
```

## Delete Server

```bash
# Delete server
hcloud server delete k8s-worker-1

# Delete multiple servers by label
for server in $(hcloud server list --selector env=test -o noheader -o columns=name); do
  hcloud server delete "$server"
done
```

## Security Best Practices

1. **Always use SSH keys** - Never create servers with password authentication
2. **Use private networks** - Keep inter-server communication off public internet
3. **Apply firewalls** - Restrict access to necessary ports only
4. **Use placement groups** - Spread critical servers across physical hosts
5. **Label everything** - Use consistent labels for automation and billing
