---
name: z8-k8s-deployment
description: Manage the Z8 Kubernetes deployment, manifests, and Hetzner infrastructure for this repo. Use this whenever the user asks to refresh GHCR images, rollout restart workloads, scale deployments, rerun `drizzle-migrate`, update ingress or Traefik middleware, manage RustFS routes, inspect cert-manager or rollout state, or make Hetzner/OpenTofu changes for the existing cluster. Prefer this skill even if the user only mentions `kubectl`, `app-prod`, `drizzle-migrate`, `kubeconfig.recovered.yaml`, Traefik, ingress, middleware, RustFS, `rustfs.z8-time.app`, `s3.z8-time.app`, telemetry, marketing, cert-manager, GHCR, Hetzner, `hcloud`, `tofu`, or deployment refreshes without explicitly asking for a “skill.”
---

# Z8 K8s Deployment

Operate the Z8 production cluster using the repo's real deployment workflow.

This skill is repo-specific. It is not a generic Kubernetes tutorial. Use the repo layout, existing manifests, current workload names, and the live verification patterns already used in this codebase.

## What this skill covers

- Refresh `web`, `worker`, and `drizzle-migrate` images from GHCR
- Restart, scale, and inspect workloads in `app-prod`
- Recreate and verify migration jobs
- Add or modify Kubernetes manifests under `infra/hetzner-k8s/k8s`
- Manage Traefik ingress, middleware, cert-manager, RustFS, and related routing changes
- Inspect cluster state with `kubectl`
- Perform Hetzner/OpenTofu operations for the existing cluster under `infra/hetzner-k8s/tofu`

## Hard safety rules

- Never store tokens, private keys, kubeconfig contents, or secret values in the skill.
- Never hardcode credentials into manifests, docs, or commands.
- Never print secret values unless the user explicitly asks to inspect an existing secret.
- Never guess missing credentials. Report exactly which environment variables are required.
- Prefer the least destructive path. Inspect first, change second, verify third.
- For persistent config changes, update manifests first. Use direct `kubectl` operations for day-2 actions like restarts, scaling, and one-off migration reruns.
- For destructive infra actions such as deleting Hetzner resources, tearing down OpenTofu state, or removing cluster resources, stop and ask only if the action is irreversible or ambiguous.

## Prerequisites

### Tools

- `kubectl` for cluster operations
- `hcloud` for Hetzner inspection or changes
- `tofu` or `terraform` for repo-managed infra changes
- `gh` for GitHub PR/package checks when needed

### Environment variables

- `KUBECONFIG` (optional)
  - Use when the user wants an explicit kubeconfig or the repo-default path should be overridden.
- `HCLOUD_TOKEN` (required for Hetzner or OpenTofu actions)
  - Needed for `hcloud` and repo infra changes under `infra/hetzner-k8s/tofu`.
- `GH_TOKEN` (optional)
  - Needed when GitHub package or PR inspection requires authenticated access.

### Repo defaults

- Kubernetes manifests live in `infra/hetzner-k8s/k8s`
- Hetzner/OpenTofu lives in `infra/hetzner-k8s/tofu`
- A repo-local kubeconfig path may exist at `infra/hetzner-k8s/kubeconfig.recovered.yaml`

If a task needs cluster access and `KUBECONFIG` is unset, first check whether the repo-local kubeconfig exists. Use the path only; never print its contents.

## Repo map

Use these paths as your first stop:

- `infra/hetzner-k8s/k8s/kustomization.yaml` - top-level app manifest set
- `infra/hetzner-k8s/k8s/app/web-deployment.yaml` - web deployment
- `infra/hetzner-k8s/k8s/app/worker-deployment.yaml` - worker deployment
- `infra/hetzner-k8s/k8s/app/migration-job.yaml` - migration job
- `infra/hetzner-k8s/k8s/app/web-ingress.yaml` - UI ingress
- `infra/hetzner-k8s/k8s/app/marketing-ingress.yaml` - marketing ingress
- `infra/hetzner-k8s/k8s/app/rustfs.yaml` - RustFS service, deployment, and ingress resources
- `infra/hetzner-k8s/tofu/main.tf` - Hetzner cluster topology
- `infra/hetzner-k8s/tofu/variables.tf` - required infra inputs

## Execution modes

Classify every request before acting.

### 1. Inspect

Use for read-only tasks.

Examples:
- check current pod image digests
- inspect ingress, certificates, or middleware
- verify whether a deployment rolled out
- inspect Hetzner cluster resources

Workflow:
1. Verify tool access.
2. Gather current state.
3. Summarize concrete resource names, live status, and blockers.

### 2. Operate

Use for day-2 cluster operations.

Examples:
- refresh latest GHCR images
- rollout restart `web` and `worker`
- rerun `drizzle-migrate`
- scale a deployment
- apply manifest changes under `infra/hetzner-k8s/k8s`

Workflow:
1. Inspect current state first.
2. Update manifests if the change should persist.
3. Apply or operate with `kubectl`.
4. Verify rollout, job completion, ingress state, cert state, or image digests.

### 3. Infra

Use for Hetzner/OpenTofu changes.

Examples:
- update server/network/load balancer/firewall settings
- inspect SSH key usage in Hetzner
- review OpenTofu-managed cluster inputs

Workflow:
1. Confirm `HCLOUD_TOKEN` is available.
2. Inspect current infra or run a plan first.
3. Prefer `tofu plan` before `tofu apply` when changing repo-managed infra.
4. Verify resulting Hetzner resources after the change.

## Core playbooks

### Refresh web, worker, and migration images

Use this when the user says a new image was published to GHCR.

1. Restart `deployment/web` and `deployment/worker` in `app-prod`.
2. Wait for both rollouts to complete.
3. Delete and recreate `job/drizzle-migrate` from `infra/hetzner-k8s/k8s/app/migration-job.yaml`.
4. Wait for the job to complete.
5. Report the live image digests for `web`, `worker`, and the migration pod.

Why: `:latest` tags only become real after new pods are created, and the migration job must be recreated to pull the new image.

### Scale workloads

1. Inspect the current deployment state.
2. Scale the deployment to the requested replica count.
3. Wait for rollout or readiness.
4. Report the resulting deployment status and pods.

### Apply manifest changes

1. Edit files under `infra/hetzner-k8s/k8s`.
2. Prefer `kubectl apply -k infra/hetzner-k8s/k8s` when the resource is part of the kustomization.
3. If a resource is intentionally outside `kustomization.yaml`, apply that file directly and say so.
4. Verify the live resources after apply.

### Ingress, Traefik middleware, and cert-manager changes

1. Inspect existing ingress and middleware before changing them.
2. Keep middleware and ingress wiring explicit in manifests.
3. After apply, verify:
   - ingress host/path rules
   - attached middleware
   - certificate readiness when TLS hosts changed
4. If routing fails, inspect the live ingress YAML, middleware, service ports, and cert-manager resources before proposing a fix.

### RustFS changes

1. Treat `infra/hetzner-k8s/k8s/app/rustfs.yaml` as the source of truth.
2. Distinguish between:
   - S3 API route (`9000`)
   - Web UI route (`9001`)
3. If the Web UI is exposed publicly, use IP allowlist middleware unless the user explicitly wants it open.
4. Verify both ingress resources and certificate status after changes.

### Hetzner/OpenTofu changes

1. Inspect `infra/hetzner-k8s/tofu/main.tf` and `variables.tf` first.
2. Use `tofu plan` before `tofu apply` for repo-managed changes.
3. Use `hcloud` for live inspection or for tasks outside the current OpenTofu state only when appropriate.
4. Report which env vars were required and whether they were present.

## Failure investigation

If an operation fails, gather evidence before changing anything else.

Examples of evidence to collect:
- `kubectl get deployment,pods,job,ingress,svc -n app-prod`
- rollout status and pod image IDs
- relevant workload logs
- ingress and middleware YAML
- certificate, challenge, and order status
- Hetzner resource lists or `tofu plan` output

Do not guess. Identify the failing layer first: image pull, rollout, service routing, TLS issuance, or infra provisioning.

## Verification checklist

Always verify based on the task type.

### After deployment refresh

- rollout completed
- new pods running
- image digests reported

### After migration rerun

- job recreated
- job reached `Complete`
- latest migration image reported

### After scaling

- deployment shows requested replicas
- pods are ready or explain why not

### After ingress or middleware updates

- manifests applied successfully
- ingress and middleware visible live
- TLS certificate status checked when relevant

### After infra changes

- `tofu plan/apply` or `hcloud` result summarized
- changed Hetzner resources confirmed live

## Output style

Report concise, concrete results:
- what changed
- what commands/actions were taken
- what is now live
- any blockers or missing prerequisites

Always include exact resource names and, for refreshed images, the live image digests.

## Missing prerequisite behavior

If a task cannot proceed because of missing env vars or tools, do all safe read-only work first, then report the exact missing prerequisite.

Examples:
- "Need `HCLOUD_TOKEN` to inspect Hetzner SSH keys."
- "Need `kubectl` and a valid kubeconfig to refresh app-prod workloads."
- "Need authenticated GitHub access via `GH_TOKEN` for private package metadata."

## Example prompts this skill should handle

- "refresh webapp, worker and migration from the latest GH image"
- "scale marketing to 0 and verify it stayed down"
- "add an IP allowlist to the rustfs webui ingress"
- "route telemetry through Traefik to an external VM and verify TLS"
- "check which Hetzner ssh keys can access the control planes"
- "update the k8s deployment and pull the newest webapp images"
