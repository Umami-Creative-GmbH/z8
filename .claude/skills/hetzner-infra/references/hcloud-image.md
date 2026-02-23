# hcloud image

Image management for Hetzner Cloud.

## List Images

```bash
# List all images
hcloud image list

# List only public images
hcloud image list --type system

# List snapshots
hcloud image list --type snapshot

# List backups
hcloud image list --type backup
```

## Available System Images

| Image | Architecture |
|-------|-------------|
| ubuntu-24.04 | x86, ARM |
| ubuntu-22.04 | x86, ARM |
| debian-12 | x86, ARM |
| debian-11 | x86 |
| fedora-41 | x86 |
| rocky-9 | x86 |
| alma-9 | x86 |

```bash
# List with architecture
hcloud image list --type system -o columns=name,architecture
```

## Create Snapshot

```bash
# Create from server
hcloud server create-image k8s-bastion \
  --type snapshot \
  --description "Bastion base image"

# With labels
hcloud server create-image k8s-bastion \
  --type snapshot \
  --description "Bastion v1.0" \
  --label version=1.0
```

## Delete Image

```bash
hcloud image delete my-snapshot
```

## Use Image

```bash
# Use system image
hcloud server create \
  --name k8s-worker \
  --image ubuntu-24.04

# Use snapshot
hcloud server create \
  --name k8s-worker \
  --image 12345678  # snapshot ID

# Use snapshot by name (if unique)
hcloud server create \
  --name k8s-worker \
  --image bastion-snapshot
```

## Image Pricing

| Type | Price |
|------|-------|
| System images | Free |
| Snapshots | ~€0.012/GB/mo |
| Backups | ~€0.012/GB/mo (20% of server) |

## Best Practices

1. **Create golden images** - Pre-configured base images
2. **Version snapshots** - Use labels for versioning
3. **Clean up old snapshots** - Avoid storage costs
4. **Document images** - Use descriptions
