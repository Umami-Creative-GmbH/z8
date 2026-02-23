# hcloud ssh-key

SSH key management for Hetzner Cloud.

## List SSH Keys

```bash
hcloud ssh-key list
hcloud ssh-key describe my-key
```

## Create SSH Key

```bash
# From file
hcloud ssh-key create \
  --name my-key \
  --public-key-from-file ~/.ssh/id_ed25519.pub

# From string
hcloud ssh-key create \
  --name my-key \
  --public-key "ssh-ed25519 AAAA..."

# With labels
hcloud ssh-key create \
  --name admin-key \
  --public-key-from-file ~/.ssh/id_ed25519.pub \
  --label user=admin
```

## Generate SSH Key (Local)

```bash
# Generate Ed25519 key (recommended)
ssh-keygen -t ed25519 -C "admin@example.com" -f ~/.ssh/hetzner_ed25519

# Generate RSA key (legacy compatibility)
ssh-keygen -t rsa -b 4096 -C "admin@example.com" -f ~/.ssh/hetzner_rsa
```

## Update SSH Key

```bash
hcloud ssh-key update my-key --name new-name
```

## Delete SSH Key

```bash
hcloud ssh-key delete my-key
```

## Use with Server Creation

```bash
# Single key
hcloud server create \
  --name k8s-bastion \
  --type cx22 \
  --image ubuntu-24.04 \
  --ssh-key my-key

# Multiple keys
hcloud server create \
  --name k8s-bastion \
  --type cx22 \
  --image ubuntu-24.04 \
  --ssh-key admin-key \
  --ssh-key deploy-key
```

## Security Best Practices

1. **Use Ed25519** - Modern, secure, fast
2. **Use passphrases** - Protect private keys
3. **One key per user** - Track access
4. **Rotate regularly** - Replace old keys
5. **Remove unused keys** - Clean up access
