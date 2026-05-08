# Kubernetes Image Webhook Rollout Design

## Context

Z8 publishes production images to GHCR from GitHub Actions, while production refreshes have historically required manual cluster operations. The production namespace is `app-prod`, with Kubernetes manifests under `infra/hetzner-k8s/k8s/app` for `web`, `worker`, `docs`, and `marketing`.

The goal is to automate production image refreshes when new immutable GHCR tags are available, while keeping rollout authority inside the Kubernetes cluster.

## Scope

The deploy webhook handles these images and targets:

- `ghcr.io/umami-creative-gmbh/z8-webapp` -> `deployment/web`
- `ghcr.io/umami-creative-gmbh/z8-worker` -> `deployment/worker`
- `ghcr.io/umami-creative-gmbh/z8-migration` -> migration job for app releases
- `ghcr.io/umami-creative-gmbh/z8-docs` -> `deployment/docs`
- `ghcr.io/umami-creative-gmbh/z8-marketing` -> `deployment/marketing`

Only immutable `sha-...` tags are accepted. Mutable tags such as `latest`, semver tags, and user-supplied package versions are out of scope.

## Architecture

An in-cluster `deploy-webhook` service runs in `app-prod`. GitHub package webhooks are sent to `/webhooks/github`; the service validates the request, extracts supported image observations, checks GHCR readiness, and reconciles Kubernetes resources.

The service has three main units:

- **Webhook endpoint**: validates GitHub HMAC signatures, parses supported package events, allowlists the expected owner/package names, and rejects malformed or unrelated requests.
- **Image readiness checker**: performs OCI/GHCR manifest checks. Public packages can pass anonymously; private package readiness follows the GHCR Bearer challenge flow and requires both optional `GHCR_USERNAME` and `GHCR_TOKEN` when authentication is challenged.
- **Rollout reconciler**: records observations in a ConfigMap, serializes same-release work in process, updates Kubernetes resources, waits for rollouts, and records deployed markers so duplicate events are safe.

## Webhook Security And Secrets

The webhook secret is read from `deploy-webhook-secrets` key `github-webhook-secret` and verified against `X-Hub-Signature-256` with HMAC-SHA256 before JSON parsing. Invalid signatures return `401`; malformed payloads return `400`.

`deploy-webhook-secrets` is provisioned through the existing PhaseSecret managed secret references. The manifest references keys only; no secret values are committed. Optional `ghcr-token` and `ghcr-username` keys are used only when GHCR requires authenticated readiness checks.

The public ingress routes only `https://deploy-webhook.z8-time.app/webhooks/github` to the service. The GitHub package webhook must use the same secret value as `github-webhook-secret`, and DNS for `deploy-webhook.z8-time.app` must point at the cluster ingress.

## App Release Flow

When the receiver observes a `sha-...` tag for any app package, it records the observation and checks whether `z8-webapp`, `z8-worker`, and `z8-migration` all exist with the same tag.

Once all three app images are ready, it reconciles the app release:

1. Create or wait for a migration job using `ghcr.io/umami-creative-gmbh/z8-migration:<sha-tag>`.
2. Run the migration container with working directory `/app`, matching `Dockerfile.migration` and the existing `migration-job.yaml` layout.
3. Wait for the migration job to complete.
4. Patch `deployment/web` to `ghcr.io/umami-creative-gmbh/z8-webapp:<sha-tag>`.
5. Patch `deployment/worker` to `ghcr.io/umami-creative-gmbh/z8-worker:<sha-tag>`.
6. Wait for both deployment rollouts to complete.
7. Record migration and app deployed markers.

If the migration fails, `web` and `worker` are not updated. A later webhook retry can reconcile the same tag again after the failure is fixed. If migration already succeeded but app rollout failed, the deployed migration marker prevents rerunning migration unnecessarily.

## Docs And Marketing Flow

Docs and marketing roll out independently because they do not share the app migration dependency.

For `z8-docs:<sha-tag>`, the receiver checks GHCR readiness, patches `deployment/docs`, waits for rollout completion, and records the docs deployed marker.

For `z8-marketing:<sha-tag>`, the receiver checks GHCR readiness, patches `deployment/marketing`, waits for rollout completion, and records the marketing deployed marker.

Duplicate events for an already deployed tag are successful no-ops after confirming rollout state.

## State, Idempotency, And Retry

The receiver stores lightweight state in ConfigMap `deploy-webhook-state` in `app-prod`. State includes observed app image tags, deployed markers, and failure metadata. Kubernetes remains the source of truth for live image references.

ConfigMap writes use resource versions and retry on conflicts, making state updates safe when multiple webhook deliveries overlap. Within one process, reconciliation is serialized by app release tag or independent deployment/tag key to avoid overlapping rollouts for the same target.

The HTTP handler returns `202 accepted` after validating and recording a supported event, then runs reconciliation asynchronously with internal retry. Unsupported but valid package events return `202 ignored`.

Before patching a deployment, the reconciler reads the current image. If it already matches the desired `sha-...` image, it waits for rollout and records success without patching.

## Kubernetes Access

The service runs as dedicated service account `deploy-webhook`. RBAC is limited to implementation-required resources and verbs in `app-prod`:

- `get` and `update` on deployments `web`, `worker`, `docs`, and `marketing`.
- `get`, `create`, and `delete` on jobs, plus `get` on `jobs/status`.
- `get` and `update` on ConfigMap `deploy-webhook-state`, plus `create` for initial state creation.

The deployment uses `ghcr.io/umami-creative-gmbh/z8-deploy-webhook:latest` with `imagePullSecrets: ghcr-credentials`; production refresh of this receiver image remains a normal Kubernetes rollout operation.

## Testing And Verification

Automated coverage should include signature verification, event parsing, GHCR readiness including authenticated Bearer challenge handling, app image gating, migration-first app rollout, independent docs/marketing rollout, duplicate-event idempotency, ConfigMap conflict retries, and async reconciliation retry after `202 accepted`.

Final static verification should run:

- `pnpm --filter deploy-webhook test`
- `pnpm --filter deploy-webhook build`
- `pnpm node scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs`
- `kubectl kustomize infra/hetzner-k8s/k8s >/tmp/z8-kustomize.yaml`

Live setup still requires the Kubernetes/Phase secret values, the GitHub package webhook pointed at `https://deploy-webhook.z8-time.app/webhooks/github`, and DNS for `deploy-webhook.z8-time.app` pointed at the cluster ingress.

## Out Of Scope

- Managing GitHub webhook creation automatically.
- Deploying mutable `latest` tags for application workloads.
- Multi-environment promotion workflows.
- Rollback automation beyond allowing a manual rollout to a previous `sha-...` tag.
- Committing GitHub webhook secrets, GHCR tokens, or registry usernames to git.
