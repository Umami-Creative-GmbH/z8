# hcloud certificate

TLS certificate management for Hetzner Cloud Load Balancers.

## List Certificates

```bash
hcloud certificate list
hcloud certificate describe my-cert
```

## Create Certificate

### Upload Existing Certificate

```bash
hcloud certificate create \
  --name my-cert \
  --cert-file /path/to/cert.pem \
  --key-file /path/to/key.pem
```

### Managed Certificate (Let's Encrypt)

```bash
hcloud certificate create \
  --name my-cert \
  --type managed \
  --domain example.com \
  --domain "*.example.com"
```

## Update Certificate

```bash
# Update uploaded certificate
hcloud certificate update my-cert \
  --cert-file /path/to/new-cert.pem \
  --key-file /path/to/new-key.pem
```

## Delete Certificate

```bash
hcloud certificate delete my-cert
```

## Use with Load Balancer

```bash
# Add HTTPS service with certificate
hcloud load-balancer add-service k8s-lb \
  --protocol https \
  --listen-port 443 \
  --destination-port 30443 \
  --http-certificates my-cert
```

## Managed Certificate Requirements

1. **DNS must point to LB** - A/AAAA records for domains
2. **Port 80 open** - For HTTP-01 challenge
3. **Wait for issuance** - Check status with describe

```bash
# Check status
hcloud certificate describe my-cert
# Look for: Status: issued
```

## Best Practices

1. **Use managed certificates** - Auto-renewal
2. **Include wildcard** - *.example.com for flexibility
3. **Plan for renewal** - Uploaded certs need manual renewal
