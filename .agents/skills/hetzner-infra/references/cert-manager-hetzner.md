# cert-manager with Hetzner DNS

Using cert-manager with Hetzner DNS for Let's Encrypt certificates.

## Overview

cert-manager can use Hetzner DNS for DNS-01 challenges, allowing wildcard certificates.

## Prerequisites

1. cert-manager installed in cluster
2. Hetzner DNS API token
3. DNS zone managed in Hetzner

## Install cert-manager-webhook-hetzner

```bash
# Add Helm repo
helm repo add cert-manager-webhook-hetzner https://vadimkim.github.io/cert-manager-webhook-hetzner
helm repo update

# Install webhook
helm install cert-manager-webhook-hetzner cert-manager-webhook-hetzner/cert-manager-webhook-hetzner \
  --namespace cert-manager \
  --set groupName=acme.example.com
```

## Create Secret for API Token

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: hetzner-dns-token
  namespace: cert-manager
type: Opaque
stringData:
  api-key: "your-hetzner-dns-api-token"
```

```bash
kubectl apply -f hetzner-dns-secret.yaml
```

## Create ClusterIssuer

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    email: admin@example.com
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
    - dns01:
        webhook:
          groupName: acme.example.com
          solverName: hetzner
          config:
            secretName: hetzner-dns-token
            zoneName: example.com
            apiUrl: https://dns.hetzner.com/api/v1
```

```bash
kubectl apply -f cluster-issuer.yaml
```

## Create Wildcard Certificate

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: wildcard-example-com
  namespace: default
spec:
  secretName: wildcard-example-com-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
  - "example.com"
  - "*.example.com"
```

```bash
kubectl apply -f certificate.yaml
```

## Verify Certificate

```bash
# Check certificate status
kubectl describe certificate wildcard-example-com

# Check secret was created
kubectl get secret wildcard-example-com-tls

# View certificate details
kubectl get secret wildcard-example-com-tls -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -text -noout
```

## Use Certificate in Gateway

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: main-gateway
spec:
  gatewayClassName: cilium
  listeners:
  - name: https
    port: 443
    protocol: HTTPS
    hostname: "*.example.com"
    tls:
      mode: Terminate
      certificateRefs:
      - name: wildcard-example-com-tls
```

## Troubleshooting

```bash
# Check cert-manager logs
kubectl logs -n cert-manager deploy/cert-manager -f

# Check webhook logs
kubectl logs -n cert-manager deploy/cert-manager-webhook-hetzner -f

# Check challenge status
kubectl describe challenges

# Check certificate request
kubectl describe certificaterequests
```

## Renewal

Certificates are automatically renewed 30 days before expiry by cert-manager.

## Security Best Practices

1. **Use separate DNS API token** - Limited to DNS only
2. **Store token in secret** - Not in ClusterIssuer
3. **Use ClusterIssuer** - Share across namespaces
4. **Monitor expiry** - Alert on renewal failures
