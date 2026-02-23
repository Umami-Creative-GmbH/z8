# Hetzner Cloud Kubernetes Baseline

This folder provisions a Hetzner Cloud Kubernetes cluster using kube-hetzner and installs a minimal production baseline for the Z8 webapp + worker.

## Folder layout

- tofu/ — OpenTofu/Terraform configuration for the cluster
- k8s/ — Kustomize base for platform + app workloads

## Prerequisites

- Hetzner Cloud API token (Read & Write)
- SSH key pair
- OpenTofu (or Terraform), kubectl, helm
- A separate Hetzner Cloud VM for Postgres on the same private network
- Phase account + service token for Kubernetes secrets sync

## Provision the cluster (kube-hetzner)

1) Create a tfvars file:

- Copy tofu/terraform.tfvars.example to tofu/terraform.tfvars and fill in values.
- Restrict `firewall_ssh_source` and `firewall_kube_api_source` to your IP range.

2) Apply:

- `tofu -chdir=infra/hetzner-k8s/tofu init -upgrade`
- `tofu -chdir=infra/hetzner-k8s/tofu apply`

3) Export kubeconfig:

- `tofu -chdir=infra/hetzner-k8s/tofu output --raw kubeconfig > ./kubeconfig.yaml`
- `kubectl --kubeconfig ./kubeconfig.yaml get nodes`

## Base platform install

### 1) Install Phase Secrets Operator (Helm)

Install the Phase operator using the official Helm chart. Update the repo URL if Phase changes it.

- `helm repo add phase https://helm.phase.dev`
- `helm repo update`
- `helm upgrade --install phase-secrets-operator phase/phase-secrets-operator \
  --namespace phase-system --create-namespace \
  --values infra/hetzner-k8s/k8s/phase/phase-operator-values.yaml`

Then update the Phase host and service token secret:

- Edit infra/hetzner-k8s/k8s/phase/phase-service-token-secret.yaml (token)
- Edit infra/hetzner-k8s/k8s/app/phase-secret.yaml (host, project, env)

### 2) Apply the base manifests

- `kubectl --kubeconfig ./kubeconfig.yaml apply -k infra/hetzner-k8s/k8s`

This installs:
- Traefik (via kube-hetzner) + cert-manager
- namespaces, ClusterIssuer
- PhaseSecret CR (syncs to app-secrets)
- Valkey (persistent, AOF)
- Vault (Raft storage)
- web + worker deployments and services

## Release rollout flow (migration first)

Use the rollout script so every release runs migrations once before web/worker rollouts:

- `bash infra/hetzner-k8s/deploy-rollout.sh sha-<commit>`

What it does:
- runs a one-shot migration Job using `ghcr.io/umami-creative-gmbh/z8-migration:<tag>`
- waits for migration completion (fails fast on error)
- updates web + worker to the same tag and waits for rollout success

## Required application secrets

These keys must exist in Phase and be synced into the `app-secrets` Kubernetes Secret.

- `PHASE_HOST` — Phase API base URL, used by your app (if applicable)
- `DATABASE_URL` — external Postgres VM connection string (private network)
- `VALKEY_URL` — use the in-cluster service URL: `redis://valkey.app-prod.svc.cluster.local:6379`

## Postgres VM (outside the cluster)

- Create a Hetzner Cloud VM in the same private network as the cluster
- Allow inbound 5432 only from the cluster subnet
- Set `DATABASE_URL` in Phase to the VM’s private IP

## Drizzle migrations with advisory lock

The migration Job uses `apps/webapp/scripts/migrate-with-lock.js` and takes a Postgres advisory lock to prevent concurrent migrations.

Rolling update safety:

- Assume rolling updates.
- Migrations must be backward compatible.
- Do not perform destructive schema changes in a single release. Split into safe, staged changes.

Run it manually only for debugging (normal deploys should use `deploy-rollout.sh`):

- `kubectl --kubeconfig ./kubeconfig.yaml apply -f infra/hetzner-k8s/k8s/app/migration-job.yaml`
- `kubectl --kubeconfig ./kubeconfig.yaml -n app-prod logs job/drizzle-migrate`

The job expects:
- `DATABASE_URL` in `app-secrets`
- `DRIZZLE_MIGRATE_COMMAND` (defaults to `pnpm dlx drizzle-kit migrate --config ./drizzle.config.ts`)

## Vault (manual init + unseal)

Vault runs with Raft storage and **manual unseal**.

Initialize (first time):

- `kubectl --kubeconfig ./kubeconfig.yaml -n vault exec -it vault-0 -- vault operator init`

Unseal (repeat after restarts):

- `kubectl --kubeconfig ./kubeconfig.yaml -n vault exec -it vault-0 -- vault operator unseal`

## App images & domains

Update these placeholders before deploying:

- Image placeholders are ${IMAGE}:${TAG} in the manifests. Replace them via CI or a kustomize/templating step.
- Ingress host: `app.example.com`

## Notes

- The kube-hetzner module is configured to install Traefik. cert-manager is managed explicitly in Kustomize.
- For upgrades, update the kube-hetzner module version in tofu/main.tf and run `tofu apply`.
