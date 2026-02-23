# hcloud zone

DNS zone management for Hetzner Cloud.

## List Zones

```bash
hcloud zone list
hcloud zone describe example.com
```

## Create Zone

```bash
# Create zone
hcloud zone create --name example.com

# With TTL
hcloud zone create --name example.com --ttl 3600
```

## List Records

```bash
# List all records
hcloud zone rrset list example.com

# Filter by type
hcloud zone rrset list example.com --type A
```

## Add Records

```bash
# A record
hcloud zone add-records example.com \
  --type A \
  --name @ \
  --value 1.2.3.4

# A record for subdomain
hcloud zone add-records example.com \
  --type A \
  --name gitlab \
  --value 1.2.3.4

# Wildcard A record
hcloud zone add-records example.com \
  --type A \
  --name "*" \
  --value 1.2.3.4

# AAAA record (IPv6)
hcloud zone add-records example.com \
  --type AAAA \
  --name @ \
  --value 2001:db8::1

# CNAME record
hcloud zone add-records example.com \
  --type CNAME \
  --name www \
  --value example.com.

# MX record
hcloud zone add-records example.com \
  --type MX \
  --name @ \
  --value "10 mail.example.com."

# TXT record
hcloud zone add-records example.com \
  --type TXT \
  --name @ \
  --value "v=spf1 include:_spf.google.com ~all"

# CAA record
hcloud zone add-records example.com \
  --type CAA \
  --name @ \
  --value '0 issue "letsencrypt.org"'
```

## Remove Records

```bash
hcloud zone remove-records example.com \
  --type A \
  --name gitlab
```

## Update TTL

```bash
hcloud zone update example.com --ttl 300
```

## Delete Zone

```bash
hcloud zone delete example.com
```

## Platform DNS Setup

```bash
DOMAIN="example.com"
LB_IP="1.2.3.4"

# Root domain
hcloud zone add-records $DOMAIN --type A --name @ --value $LB_IP

# Wildcard
hcloud zone add-records $DOMAIN --type A --name "*" --value $LB_IP

# Specific services (optional, wildcard covers these)
hcloud zone add-records $DOMAIN --type A --name gitlab --value $LB_IP
hcloud zone add-records $DOMAIN --type A --name argocd --value $LB_IP
hcloud zone add-records $DOMAIN --type A --name grafana --value $LB_IP
hcloud zone add-records $DOMAIN --type A --name vault --value $LB_IP

# API and App
hcloud zone add-records $DOMAIN --type A --name api --value $LB_IP
hcloud zone add-records $DOMAIN --type A --name app --value $LB_IP

# S3/Registry
hcloud zone add-records $DOMAIN --type A --name s3 --value $LB_IP
hcloud zone add-records $DOMAIN --type A --name registry --value $LB_IP
```

## Best Practices

1. **Use low TTL initially** - 300s during setup
2. **Increase TTL for production** - 3600s or higher
3. **Add CAA records** - Restrict certificate issuance
4. **Document all records** - Track purpose
