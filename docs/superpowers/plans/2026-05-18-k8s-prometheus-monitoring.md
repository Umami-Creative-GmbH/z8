# Kubernetes Prometheus Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Helm-managed `kube-prometheus-stack` monitoring setup for the Hetzner Kubernetes cluster with Grafana exposed at `dash.z8-time.app` and protected by a Phase-sourced Traefik IP allowlist.

**Architecture:** Keep monitoring separate from the app Kustomize tree under `infra/hetzner-k8s/monitoring`. Use Helm values for kube-prometheus-stack, a small PhaseSecret manifest for monitoring secrets, and a deploy script that renders a Traefik allowlist middleware from `ALLOWED_GRAFANA_IPS` before running `helm upgrade --install`.

**Tech Stack:** Kubernetes, Helm, prometheus-community/kube-prometheus-stack, Traefik CRDs, cert-manager, Phase Operator, Bash.

---

## File Structure

- Create: `infra/hetzner-k8s/monitoring/phase-secret.yaml`
  - Defines a `PhaseSecret` in namespace `monitoring` that syncs the existing Phase app/env into Kubernetes secret `grafana-admin`.
- Create: `infra/hetzner-k8s/monitoring/values.yaml`
  - Configures kube-prometheus-stack, Grafana ingress, Grafana persistence, Prometheus retention/storage, and internal-only Prometheus/Alertmanager access.
- Create: `infra/hetzner-k8s/monitoring/grafana-allowlist-middleware.yaml.tpl`
  - Template for the Traefik `Middleware` with a placeholder for rendered `/32` source ranges.
- Create: `infra/hetzner-k8s/monitoring/deploy-monitoring.sh`
  - Validates `ALLOWED_GRAFANA_IPS`, renders middleware to a temp file, applies the namespace and PhaseSecret, performs Helm dry-run/install/upgrade, applies the middleware, and prints verification commands.
- Modify: `docs/superpowers/specs/2026-05-18-k8s-prometheus-monitoring-design.md`
  - No implementation change expected. Only update if implementation discovers a required deviation from the approved design.

## Required Secret Setup

Before live deployment, Phase must be configured for app `z8`, environment `Production`, to sync these values into Kubernetes:

- Secret: `grafana-admin` in namespace `monitoring`.
- Key: `admin-user`, value: Grafana admin username, for example `admin`.
- Key: `admin-password`, value: a strong Grafana admin password.
- Environment variable available to the deploy script: `ALLOWED_GRAFANA_IPS`, value: comma-separated IPv4 addresses, for example `203.0.113.10,198.51.100.24`.

Do not commit these values.

### Task 1: Add Monitoring PhaseSecret

**Files:**
- Create: `infra/hetzner-k8s/monitoring/phase-secret.yaml`

- [ ] **Step 1: Create the monitoring directory**

Run:

```bash
mkdir -p infra/hetzner-k8s/monitoring
```

Expected: command exits with status `0`.

- [ ] **Step 2: Create the PhaseSecret manifest**

Create `infra/hetzner-k8s/monitoring/phase-secret.yaml` with exactly:

```yaml
apiVersion: secrets.phase.dev/v1alpha1
kind: PhaseSecret
metadata:
  name: monitoring-secrets
  namespace: monitoring
spec:
  phaseApp: z8
  phaseAppEnv: Production
  phaseHost: https://phase.umami-creative.app
  authentication:
    serviceToken:
      serviceTokenSecretReference:
        secretName: phase-service-token
        secretNamespace: app-prod
  managedSecretReferences:
    - secretName: grafana-admin
      secretNamespace: monitoring
```

- [ ] **Step 3: Validate the manifest shape locally**

Run:

```bash
kubectl apply --dry-run=client -f infra/hetzner-k8s/monitoring/phase-secret.yaml
```

Expected: `phasesecret.secrets.phase.dev/monitoring-secrets created (dry run)`.

If the local kubectl client does not know the PhaseSecret CRD and fails validation, run:

```bash
kubectl apply --dry-run=client --validate=false -f infra/hetzner-k8s/monitoring/phase-secret.yaml
```

Expected: `phasesecret.secrets.phase.dev/monitoring-secrets created (dry run)`.

- [ ] **Step 4: Commit the PhaseSecret manifest**

Run:

```bash
git add infra/hetzner-k8s/monitoring/phase-secret.yaml
git commit -m "feat: add monitoring phase secret"
```

Expected: commit succeeds and includes only `phase-secret.yaml`.

### Task 2: Add kube-prometheus-stack Helm Values

**Files:**
- Create: `infra/hetzner-k8s/monitoring/values.yaml`

- [ ] **Step 1: Create the Helm values file**

Create `infra/hetzner-k8s/monitoring/values.yaml` with exactly:

```yaml
fullnameOverride: z8-monitoring

commonLabels:
  app.kubernetes.io/part-of: z8-monitoring

grafana:
  enabled: true
  admin:
    existingSecret: grafana-admin
    userKey: admin-user
    passwordKey: admin-password
  persistence:
    enabled: true
    size: 10Gi
  ingress:
    enabled: true
    ingressClassName: traefik
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
      traefik.ingress.kubernetes.io/router.middlewares: monitoring-grafana-allowlist@kubernetescrd
    hosts:
      - dash.z8-time.app
    path: /
    pathType: Prefix
    tls:
      - secretName: grafana-dash-tls
        hosts:
          - dash.z8-time.app

prometheus:
  enabled: true
  ingress:
    enabled: false
  prometheusSpec:
    retention: 15d
    storageSpec:
      volumeClaimTemplate:
        spec:
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: 30Gi
    resources:
      requests:
        cpu: 200m
        memory: 1Gi
      limits:
        cpu: "1"
        memory: 3Gi

alertmanager:
  enabled: true
  ingress:
    enabled: false
  alertmanagerSpec:
    storage:
      volumeClaimTemplate:
        spec:
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: 5Gi

kubeStateMetrics:
  enabled: true

nodeExporter:
  enabled: true

prometheus-node-exporter:
  hostRootFsMount:
    enabled: false

kubeEtcd:
  enabled: false

kubeControllerManager:
  enabled: false

kubeScheduler:
  enabled: false
```

- [ ] **Step 2: Validate YAML parses**

Run:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update prometheus-community
helm template z8-monitoring prometheus-community/kube-prometheus-stack --namespace monitoring --values infra/hetzner-k8s/monitoring/values.yaml >/tmp/z8-monitoring-values-check.yaml
```

Expected: command exits with status `0` and writes rendered YAML to `/tmp/z8-monitoring-values-check.yaml`.

- [ ] **Step 3: Run Helm template validation**

Run:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update prometheus-community
helm template z8-monitoring prometheus-community/kube-prometheus-stack --namespace monitoring --values infra/hetzner-k8s/monitoring/values.yaml >/tmp/z8-monitoring-rendered.yaml
```

Expected: command exits with status `0` and writes rendered YAML to `/tmp/z8-monitoring-rendered.yaml`.

- [ ] **Step 4: Confirm Grafana ingress renders with host and middleware**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
text = Path('/tmp/z8-monitoring-rendered.yaml').read_text()
assert 'dash.z8-time.app' in text
assert 'monitoring-grafana-allowlist@kubernetescrd' in text
assert 'grafana-admin' in text
print('rendered grafana config ok')
PY
```

Expected: `rendered grafana config ok`.

- [ ] **Step 5: Commit Helm values**

Run:

```bash
git add infra/hetzner-k8s/monitoring/values.yaml
git commit -m "feat: configure monitoring helm values"
```

Expected: commit succeeds and includes only `values.yaml`.

### Task 3: Add Grafana Allowlist Middleware Template

**Files:**
- Create: `infra/hetzner-k8s/monitoring/grafana-allowlist-middleware.yaml.tpl`

- [ ] **Step 1: Create the middleware template**

Create `infra/hetzner-k8s/monitoring/grafana-allowlist-middleware.yaml.tpl` with exactly:

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: grafana-allowlist
  namespace: monitoring
spec:
  ipAllowList:
    sourceRange:
__SOURCE_RANGES__
```

- [ ] **Step 2: Verify the template contains no concrete IPs**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import re
text = Path('infra/hetzner-k8s/monitoring/grafana-allowlist-middleware.yaml.tpl').read_text()
assert '__SOURCE_RANGES__' in text
assert not re.search(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', text)
print('template has placeholder and no IPv4 addresses')
PY
```

Expected: `template has placeholder and no IPv4 addresses`.

- [ ] **Step 3: Commit the template**

Run:

```bash
git add infra/hetzner-k8s/monitoring/grafana-allowlist-middleware.yaml.tpl
git commit -m "feat: add grafana allowlist template"
```

Expected: commit succeeds and includes only the template.

### Task 4: Add Monitoring Deploy Script

**Files:**
- Create: `infra/hetzner-k8s/monitoring/deploy-monitoring.sh`

- [ ] **Step 1: Create the deploy script**

Create `infra/hetzner-k8s/monitoring/deploy-monitoring.sh` with exactly:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_NAME="${RELEASE_NAME:-z8-monitoring}"
NAMESPACE="${NAMESPACE:-monitoring}"
CHART="${CHART:-prometheus-community/kube-prometheus-stack}"
VALUES_FILE="${VALUES_FILE:-$SCRIPT_DIR/values.yaml}"
PHASE_SECRET_FILE="${PHASE_SECRET_FILE:-$SCRIPT_DIR/phase-secret.yaml}"
ALLOWLIST_TEMPLATE="${ALLOWLIST_TEMPLATE:-$SCRIPT_DIR/grafana-allowlist-middleware.yaml.tpl}"
RENDERED_ALLOWLIST="$(mktemp)"

cleanup() {
  rm -f "$RENDERED_ALLOWLIST"
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

render_allowlist() {
  if [ -z "${ALLOWED_GRAFANA_IPS:-}" ]; then
    printf 'ALLOWED_GRAFANA_IPS is required and must be a comma-separated IPv4 list.\n' >&2
    exit 1
  fi

  local rendered_ranges=""
  local ip trimmed
  IFS=',' read -ra ips <<<"$ALLOWED_GRAFANA_IPS"

  if [ "${#ips[@]}" -eq 0 ]; then
    printf 'ALLOWED_GRAFANA_IPS did not contain any IP addresses.\n' >&2
    exit 1
  fi

  for ip in "${ips[@]}"; do
    trimmed="$(printf '%s' "$ip" | xargs)"
    if [[ ! "$trimmed" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
      printf 'Invalid IPv4 address in ALLOWED_GRAFANA_IPS: %s\n' "$trimmed" >&2
      exit 1
    fi

    IFS='.' read -r o1 o2 o3 o4 <<<"$trimmed"
    for octet in "$o1" "$o2" "$o3" "$o4"; do
      if [ "$octet" -gt 255 ]; then
        printf 'Invalid IPv4 address in ALLOWED_GRAFANA_IPS: %s\n' "$trimmed" >&2
        exit 1
      fi
    done

    rendered_ranges+="      - ${trimmed}/32"$'\n'
  done

  python3 - "$ALLOWLIST_TEMPLATE" "$RENDERED_ALLOWLIST" "$rendered_ranges" <<'PY'
from pathlib import Path
import sys

template = Path(sys.argv[1]).read_text()
rendered_ranges = sys.argv[3].rstrip('\n')
if '__SOURCE_RANGES__' not in template:
    raise SystemExit('template is missing __SOURCE_RANGES__ placeholder')
Path(sys.argv[2]).write_text(template.replace('__SOURCE_RANGES__', rendered_ranges) + '\n')
PY
}

require_command kubectl
require_command helm
require_command python3
require_command xargs

render_allowlist

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update prometheus-community

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$PHASE_SECRET_FILE"
kubectl apply -f "$RENDERED_ALLOWLIST"

printf 'Waiting for Phase to sync %s/grafana-admin...\n' "$NAMESPACE"
kubectl -n "$NAMESPACE" wait --for=create secret/grafana-admin --timeout=180s

helm upgrade --install "$RELEASE_NAME" "$CHART" \
  --namespace "$NAMESPACE" \
  --values "$VALUES_FILE" \
  --dry-run

helm upgrade --install "$RELEASE_NAME" "$CHART" \
  --namespace "$NAMESPACE" \
  --values "$VALUES_FILE" \
  --wait \
  --timeout 10m

kubectl -n "$NAMESPACE" get pods
kubectl -n "$NAMESPACE" get ingress
kubectl -n "$NAMESPACE" get middleware grafana-allowlist -o yaml
kubectl -n "$NAMESPACE" get certificate
```

- [ ] **Step 2: Make the script executable**

Run:

```bash
chmod +x infra/hetzner-k8s/monitoring/deploy-monitoring.sh
```

Expected: command exits with status `0`.

- [ ] **Step 3: Run shell syntax validation**

Run:

```bash
bash -n infra/hetzner-k8s/monitoring/deploy-monitoring.sh
```

Expected: command exits with status `0` and prints nothing.

- [ ] **Step 4: Verify the script rejects missing allowlist input**

Run:

```bash
env -u ALLOWED_GRAFANA_IPS infra/hetzner-k8s/monitoring/deploy-monitoring.sh
```

Expected: command exits non-zero and prints `ALLOWED_GRAFANA_IPS is required and must be a comma-separated IPv4 list.` before it runs Helm or kubectl apply.

- [ ] **Step 5: Commit the deploy script**

Run:

```bash
git add infra/hetzner-k8s/monitoring/deploy-monitoring.sh
git commit -m "feat: add monitoring deploy script"
```

Expected: commit succeeds and includes only the deploy script.

### Task 5: Add Documentation For Running Monitoring Deployment

**Files:**
- Create: `infra/hetzner-k8s/monitoring/README.md`

- [ ] **Step 1: Create README**

Create `infra/hetzner-k8s/monitoring/README.md` with exactly:

```markdown
# Z8 Monitoring

This directory contains the Helm values and helper script for the Z8 Kubernetes monitoring stack.

The stack uses `prometheus-community/kube-prometheus-stack` and installs into namespace `monitoring`.

## Phase Requirements

Configure Phase app `z8`, environment `Production`, so the Phase operator can sync secret `grafana-admin` into namespace `monitoring` with these keys:

- `admin-user`
- `admin-password`

Provide `ALLOWED_GRAFANA_IPS` to the deploy script as a comma-separated list of allowed IPv4 addresses. The script validates the list and renders a temporary Traefik `ipAllowList` middleware. Concrete IP addresses are not committed to git.

## Deploy

Use a kubeconfig with access to the production cluster, then run:

```bash
ALLOWED_GRAFANA_IPS="203.0.113.10,198.51.100.24" ./infra/hetzner-k8s/monitoring/deploy-monitoring.sh
```

Do not use the example IPs above for production.

## Verify

```bash
kubectl -n monitoring get pods
kubectl -n monitoring get ingress
kubectl -n monitoring get middleware grafana-allowlist -o yaml
kubectl -n monitoring get certificate
```

Grafana should be available at `https://dash.z8-time.app` only from IPs listed in `ALLOWED_GRAFANA_IPS`.
```

- [ ] **Step 2: Commit README**

Run:

```bash
git add infra/hetzner-k8s/monitoring/README.md
git commit -m "docs: document monitoring deployment"
```

Expected: commit succeeds and includes only `README.md`.

### Task 6: Run Final Static Verification

**Files:**
- Verify: `infra/hetzner-k8s/monitoring/*`

- [ ] **Step 1: Check working tree contains only intended monitoring files**

Run:

```bash
git status --short
```

Expected: no unstaged changes from the monitoring implementation. Existing unrelated dirty files under `infra/hetzner-k8s/k8s/app` may still appear if they were present before this work; do not revert them.

- [ ] **Step 2: Run YAML and shell verification**

Run:

```bash
kubectl apply --dry-run=client --validate=false -f infra/hetzner-k8s/monitoring/phase-secret.yaml
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update prometheus-community
helm template z8-monitoring prometheus-community/kube-prometheus-stack --namespace monitoring --values infra/hetzner-k8s/monitoring/values.yaml >/tmp/z8-monitoring-rendered.yaml
bash -n infra/hetzner-k8s/monitoring/deploy-monitoring.sh
```

Expected: `kubectl` reports the PhaseSecret dry run, `helm template` exits with status `0`, and `bash -n` prints nothing.

- [ ] **Step 3: Run Helm render verification**

Run:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update prometheus-community
helm template z8-monitoring prometheus-community/kube-prometheus-stack --namespace monitoring --values infra/hetzner-k8s/monitoring/values.yaml >/tmp/z8-monitoring-rendered.yaml
python3 - <<'PY'
from pathlib import Path
text = Path('/tmp/z8-monitoring-rendered.yaml').read_text()
checks = [
    'dash.z8-time.app',
    'monitoring-grafana-allowlist@kubernetescrd',
    'grafana-admin',
    '15d',
]
missing = [check for check in checks if check not in text]
if missing:
    raise SystemExit(f'missing rendered values: {missing}')
print('helm render ok')
PY
```

Expected: prints `helm render ok`.

- [ ] **Step 4: Run dry-run with a non-secret sample allowlist if cluster access is available**

Run only when `kubectl` points to the intended cluster and live dry-run is acceptable:

```bash
ALLOWED_GRAFANA_IPS="203.0.113.10" helm upgrade --install z8-monitoring prometheus-community/kube-prometheus-stack --namespace monitoring --create-namespace --values infra/hetzner-k8s/monitoring/values.yaml --dry-run
```

Expected: Helm dry-run succeeds. This command does not apply resources.

- [ ] **Step 5: Commit verification note if files changed during verification**

Run:

```bash
git status --short
```

Expected: no new changes from verification. If verification caused a real file change, inspect it with `git diff` and commit only intentional changes.

### Task 7: Live Deployment And Verification

**Files:**
- Execute: `infra/hetzner-k8s/monitoring/deploy-monitoring.sh`

- [ ] **Step 1: Confirm prerequisites without printing secret values**

Run:

```bash
test -n "${ALLOWED_GRAFANA_IPS:-}" && printf 'ALLOWED_GRAFANA_IPS is set\n'
kubectl config current-context
helm version --short
```

Expected: confirms `ALLOWED_GRAFANA_IPS` is set, prints the Kubernetes context, and prints Helm version.

- [ ] **Step 2: Deploy monitoring**

Run:

```bash
./infra/hetzner-k8s/monitoring/deploy-monitoring.sh
```

Expected: namespace, PhaseSecret, middleware, and Helm release apply successfully; Helm waits until workloads are ready or fails with a concrete error.

- [ ] **Step 3: Verify workloads**

Run:

```bash
kubectl -n monitoring get pods
kubectl -n monitoring rollout status deployment/z8-monitoring-grafana --timeout=300s
kubectl -n monitoring get statefulset
```

Expected: Grafana deployment is available; Prometheus and Alertmanager statefulsets exist and pods are ready.

- [ ] **Step 4: Verify Grafana route and certificate**

Run:

```bash
kubectl -n monitoring get ingress
kubectl -n monitoring get middleware grafana-allowlist -o yaml
kubectl -n monitoring get certificate
```

Expected: ingress includes host `dash.z8-time.app`; middleware includes the rendered `/32` ranges from `ALLOWED_GRAFANA_IPS`; certificate for `dash.z8-time.app` is Ready.

- [ ] **Step 5: Verify Prometheus targets from inside the cluster**

Run:

```bash
kubectl -n monitoring port-forward svc/z8-monitoring-prometheus 9090:9090
```

In another terminal, run:

```bash
curl -fsS http://127.0.0.1:9090/api/v1/targets | python -m json.tool >/tmp/z8-prometheus-targets.json
```

Expected: targets JSON contains active Kubernetes, node-exporter, and kube-state-metrics targets. Stop the port-forward after verification.

- [ ] **Step 6: Verify Grafana access manually**

Open `https://dash.z8-time.app` from an allowed IP.

Expected: Grafana login page loads and accepts the Phase-provided admin credentials. From a non-allowed IP, Traefik should deny access before Grafana login.
