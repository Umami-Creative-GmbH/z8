# Z8 K8s Deployment Skill Design

**Goal:** Create a repo-specific skill that safely manages Z8's Kubernetes deployments, cluster manifests, and Hetzner-backed infrastructure without embedding secrets.

**Context**

The repository already uses a combined workflow:
- OpenTofu/Hetzner infrastructure under `infra/hetzner-k8s/tofu`
- Kubernetes manifests under `infra/hetzner-k8s/k8s`
- Day-2 operational commands via `kubectl` for rollouts, scaling, migration jobs, ingress checks, and cert verification

The new skill should capture this real workflow instead of teaching generic Kubernetes practices.

## Scope

The skill will cover full infrastructure and deployment management for this repo:
- Inspect current cluster and workload state
- Refresh GHCR-based web, worker, and migration workloads
- Scale deployments and verify rollout results
- Update and apply manifests for services, ingresses, middleware, jobs, and related app resources
- Recreate and verify migration jobs
- Inspect and manage RustFS, Traefik, cert-manager, and deployment-related cluster resources
- Support Hetzner/OpenTofu operations for the existing cluster layout

The skill will explicitly avoid embedding sensitive values. It will document required environment variables and external prerequisites instead.

## Recommended Skill Shape

Use a single repo-specific skill rather than splitting the workflow across multiple smaller skills.

**Why this approach fits best:**
- The repo's operational flow already crosses Kubernetes, manifests, and Hetzner infra in one task stream
- Users frequently ask for mixed tasks such as applying manifests, rolling deployments, re-running jobs, and validating cloud-side state
- A single skill can encode repo-specific defaults, file locations, and post-change verification without forcing the model to compose multiple generic skills

## Skill Responsibilities

The skill should trigger when users ask to:
- deploy or refresh images
- restart workloads
- rerun migrations
- scale workloads
- update/apply k8s manifests
- add or change ingress, middleware, services, certificates, or RustFS routing
- inspect rollout status, pods, logs, image digests, cert-manager resources, or cluster health
- change Hetzner cluster infrastructure already managed in this repo

## Skill Structure

The skill should include these sections:

1. **Trigger description**
   - Pushy, specific description covering deployment, rollout, migration, ingress, RustFS, Traefik, and Hetzner infra requests.

2. **Environment and tools**
   - Required or optional env vars
   - Required CLIs
   - What happens when any prerequisite is missing

3. **Repo map**
   - `infra/hetzner-k8s/tofu`
   - `infra/hetzner-k8s/k8s`
   - kubeconfig conventions
   - common manifest files for web, worker, migration, ingress, middleware, and RustFS

4. **Execution modes**
   - `inspect`
   - `operate`
   - `infra`

5. **Safety rules**
   - secret handling
   - non-destructive defaults
   - verification requirements

6. **Task playbooks**
   - image refresh
   - migration rerun
   - scaling
   - ingress/middleware changes
   - RustFS routes
   - OpenTofu/Hetzner changes

7. **Output expectations**
   - concise report of what changed, what was applied, and what is now live

## Documented Environment Variables

The skill should document, but never store, these values:

- `KUBECONFIG` (optional if using repo-default kubeconfig path)
  - Used for cluster operations when not relying on the checked-in kubeconfig path convention
- `HCLOUD_TOKEN`
  - Required for Hetzner `hcloud` or OpenTofu operations against Hetzner Cloud
- `GH_TOKEN` (optional)
  - Needed when inspecting GitHub package metadata, PRs, or private package details beyond unauthenticated access

The skill should state that missing env vars are not fatal unless the requested task actually needs them.

## Expected Workflow

For each task, the skill should guide the model to:

1. Classify the request as `inspect`, `operate`, or `infra`
2. Check whether required tools and env vars exist
3. Inspect current state before making changes
4. Choose the least surprising path:
   - manifest edits for persistent config changes
   - direct `kubectl` operations for operational refreshes
   - Hetzner/OpenTofu commands only for infra-level requests
5. Perform the change
6. Verify the result using live cluster or infra state
7. Report the result with concrete resource names and image digests where relevant

## Safety and Guardrails

The skill should instruct the model to:
- never write tokens, private keys, or secret values into the skill
- never print secret values unless the user explicitly asks to inspect an existing secret
- stop early and list missing prerequisites if required tools or env vars are absent
- avoid destructive operations like deleting infra, force-applying unsafe changes, or tearing down state unless explicitly requested
- gather evidence first on failures: rollout state, pods, jobs, ingresses, middleware, certificates, logs, and image IDs as appropriate

## Verification Rules

After each operation, the skill should verify outcomes by default:

- **Deployment refresh**
  - rollout status
  - live pod image digests

- **Migration rerun**
  - job recreated
  - completion state reached

- **Scaling**
  - deployment replica counts
  - pod readiness

- **Ingress/middleware/cert changes**
  - manifests applied
  - live ingress and middleware state
  - certificate issuance state when relevant

- **Hetzner/OpenTofu changes**
  - `tofu plan/apply` or `hcloud` verification output summarized
  - resulting resource state reported

## Initial Skill Test Cases

The first evaluation set should include prompts such as:
- refresh the latest webapp, worker, and migration images and verify live digests
- add or update ingress and middleware safely, then verify cert-manager status
- scale a deployment and confirm resulting pod health
- inspect prerequisites for Hetzner infra changes and clearly report missing env vars instead of guessing

## Implementation Notes

The first version likely only needs a single `SKILL.md`. If the prompt grows too large, split supporting detail into references for:
- common repo paths
- env/tool prerequisites
- playbooks for image refresh, ingress changes, and Hetzner/OpenTofu workflows

## Non-Goals

This skill is not meant to:
- store credentials
- replace Phase or Kubernetes secrets handling
- serve as a generic Kubernetes tutorial disconnected from this repo
- infer destructive infra intent without explicit user direction
