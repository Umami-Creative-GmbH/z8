# hcloud volume

Block storage volume management for Hetzner Cloud.

## List Volumes

```bash
hcloud volume list
hcloud volume describe k8s-data
```

## Create Volume

```bash
# Create volume
hcloud volume create \
  --name k8s-data \
  --size 100 \
  --location fsn1

# With labels
hcloud volume create \
  --name k8s-postgres \
  --size 50 \
  --location fsn1 \
  --label app=postgresql

# Create and attach to server
hcloud volume create \
  --name k8s-data \
  --size 100 \
  --server k8s-worker-1 \
  --automount \
  --format ext4
```

## Pricing (January 2026)

| Size | Price/mo |
|------|----------|
| 10 GB | ~€0.50 |
| 50 GB | ~€2.50 |
| 100 GB | ~€5.00 |
| 500 GB | ~€25.00 |
| 1 TB | ~€50.00 |
| 10 TB | ~€500.00 |

## Attach/Detach

```bash
# Attach to server
hcloud volume attach k8s-data --server k8s-worker-1 --automount

# Detach from server
hcloud volume detach k8s-data
```

## Resize Volume

```bash
# Resize (can only increase)
hcloud volume resize k8s-data --size 200
```

## On Server: Mount Volume

```bash
# Find volume device
lsblk

# Format if new (CAREFUL - destroys data)
mkfs.ext4 /dev/sdb

# Create mount point
mkdir -p /mnt/data

# Mount
mount /dev/sdb /mnt/data

# Add to fstab for persistence
echo '/dev/disk/by-id/scsi-0HC_Volume_<volume-id> /mnt/data ext4 defaults 0 0' >> /etc/fstab
```

## Delete Volume

```bash
# Detach first if attached
hcloud volume detach k8s-data

# Delete
hcloud volume delete k8s-data
```

## Best Practices

1. **Use for persistent data** - databases, logs, etc.
2. **Back up regularly** - volumes can fail
3. **Use labels** - track purpose and ownership
4. **Plan capacity** - can only increase size
