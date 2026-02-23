# hcloud placement-group

Placement group management for spreading servers across physical hosts.

## List Placement Groups

```bash
hcloud placement-group list
hcloud placement-group describe k8s-masters
```

## Create Placement Group

```bash
# Create spread placement group
hcloud placement-group create \
  --name k8s-masters \
  --type spread

# With labels
hcloud placement-group create \
  --name k8s-masters \
  --type spread \
  --label env=production
```

## Types

| Type | Description |
|------|-------------|
| spread | VMs on different physical hosts |

## Use with Server

```bash
# Create server in placement group
hcloud server create \
  --name k8s-master-1 \
  --type cx32 \
  --image ubuntu-24.04 \
  --location fsn1 \
  --ssh-key my-key \
  --placement-group k8s-masters

# Add existing server to placement group (requires rebuild)
hcloud server rebuild k8s-master-1 \
  --image ubuntu-24.04 \
  --placement-group k8s-masters
```

## Delete Placement Group

```bash
# Must remove all servers first
hcloud placement-group delete k8s-masters
```

## Best Practices

1. **Use for critical servers** - Masters, databases
2. **Plan capacity** - Max 10 servers per spread group per location
3. **Same location required** - All servers must be in same datacenter

## Recommended Setup

```bash
# Masters placement group
hcloud placement-group create --name k8s-masters --type spread

# Create masters
for i in 1 2 3; do
  hcloud server create \
    --name k8s-master-$i \
    --type cx32 \
    --image ubuntu-24.04 \
    --location fsn1 \
    --ssh-key my-key \
    --placement-group k8s-masters \
    --network k8s-network
done
```
