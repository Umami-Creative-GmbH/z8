# hcloud storage-box

Storage Box management for Hetzner (network attached storage).

## List Storage Boxes

```bash
hcloud storage-box list
hcloud storage-box describe my-storage
```

## Note

Storage Boxes are managed via Hetzner Robot (not Cloud). The hcloud CLI has limited support.

For full management, use:
- Hetzner Robot web interface
- Hetzner Robot API

## Access Methods

| Method | Use Case |
|--------|----------|
| SFTP | File transfer |
| SCP | Secure copy |
| rsync | Backup sync |
| Samba/CIFS | Windows mount |
| WebDAV | Web access |

## Mount via SFTP

```bash
# Install sshfs
apt install sshfs

# Mount
sshfs <username>@<username>.your-storagebox.de:/ /mnt/storage

# Unmount
fusermount -u /mnt/storage
```

## Mount via Samba

```bash
# Install cifs-utils
apt install cifs-utils

# Create credentials file
cat > /root/.storage-credentials << 'CREDS'
username=<username>
password=your-password
CREDS
chmod 600 /root/.storage-credentials

# Mount
mount -t cifs //<username>.your-storagebox.de/backup /mnt/storage \
  -o credentials=/root/.storage-credentials

# Add to fstab
echo '//<username>.your-storagebox.de/backup /mnt/storage cifs credentials=/root/.storage-credentials,_netdev 0 0' >> /etc/fstab
```

## rsync Backup

```bash
# Backup to storage box
rsync -avz --progress \
  /data/ \
  <username>@<username>.your-storagebox.de:./backups/

# Restore from storage box
rsync -avz --progress \
  <username>@<username>.your-storagebox.de:./backups/ \
  /data/
```

## Pricing

| Size | Price/mo |
|------|----------|
| 1 TB | ~€4 |
| 5 TB | ~€12 |
| 10 TB | ~€20 |
| 20 TB | ~€35 |

## Best Practices

1. **Use for backups** - Not primary storage
2. **Enable snapshots** - Point-in-time recovery
3. **Use SSH keys** - Avoid password auth
4. **Encrypt sensitive data** - Before upload
