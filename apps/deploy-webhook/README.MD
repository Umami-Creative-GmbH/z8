# Deploy Webhook

`deploy-webhook` is the in-cluster receiver that automates Z8 production rollouts from GitHub package webhooks. It listens for new GHCR image tags, verifies the GitHub webhook signature, checks that the referenced images exist, and updates the matching Kubernetes workloads in `app-prod`.

This app is intentionally small and separate from the tenant-facing webapp so rollout permissions stay isolated.

## What It Deploys

- `ghcr.io/umami-creative-gmbh/z8-webapp:<sha-tag>` -> `deployment/web`
- `ghcr.io/umami-creative-gmbh/z8-worker:<sha-tag>` -> `deployment/worker`
- `ghcr.io/umami-creative-gmbh/z8-migration:<sha-tag>` -> migration Job before app rollout
- `ghcr.io/umami-creative-gmbh/z8-docs:<sha-tag>` -> `deployment/docs`
- `ghcr.io/umami-creative-gmbh/z8-marketing:<sha-tag>` -> `deployment/marketing`

Only immutable `sha-...` tags are accepted. Mutable tags such as `latest` are ignored by the webhook receiver.

## Rollout Behavior

App rollouts are gated until all three app images for the same tag exist:

- `z8-webapp`
- `z8-worker`
- `z8-migration`

When all three are ready, the receiver runs the migration Job first. It only patches `web` and `worker` after the migration completes.

Docs and marketing roll out independently because they do not depend on the app migration image.

The receiver stores lightweight rollout state in the `deploy-webhook-state` ConfigMap. That state tracks observed image events, accepted delivery IDs, deployed tags, and timestamps so duplicate, stale, or out-of-order webhooks do not roll production back.

## Security Model

- The public route is limited to `POST /webhooks/github` on `deploy-webhook.z8-time.app`.
- `X-Hub-Signature-256` is verified against the raw request body before JSON parsing.
- Requests must include `X-GitHub-Event: package` and `X-GitHub-Delivery`.
- Accepted packages and owner are allowlisted in code.
- Request bodies are limited to 1 MiB in the app and by Traefik buffering middleware.
- Traefik rate limiting is attached to the webhook ingress.
- The pod runs as non-root with privilege escalation disabled, all Linux capabilities dropped, seccomp runtime default, and a read-only root filesystem.
- The service account has narrow RBAC for the known deployments, migration Jobs, and the receiver state ConfigMap.
- No secret values are stored in this repository.

## Required Secrets

Secrets are provided through Phase into the Kubernetes Secret `app-prod/deploy-webhook-secrets`. Do not commit these values to git.

Required key:

- `github-webhook-secret`: Shared secret configured on the GitHub webhook. The receiver uses it to verify `X-Hub-Signature-256`.

Optional keys:

- `ghcr-token`: GitHub/GHCR token used if GHCR package manifest checks require authentication.
- `ghcr-username`: GitHub username or bot account name paired with `ghcr-token` for GHCR Bearer challenge authentication.

The PhaseSecret manifest already declares `deploy-webhook-secrets` as a managed secret reference:

```yaml
managedSecretReferences:
  - secretName: deploy-webhook-secrets
    secretNamespace: app-prod
```

## GitHub Webhook Setup

Create a GitHub webhook for the repository or organization that publishes the GHCR packages.

Use these settings:

- Payload URL: `https://deploy-webhook.z8-time.app/webhooks/github`
- Content type: `application/json`
- Secret: the same value stored as `github-webhook-secret` in Phase
- Events: package events only
- Active: enabled

After saving the webhook, use GitHub's delivery view to confirm the endpoint returns `202` for supported package events.

## Kubernetes Setup

The persistent Kubernetes resources live under `infra/hetzner-k8s/k8s/app`:

- `deploy-webhook-rbac.yaml`
- `deploy-webhook-deployment.yaml`
- `deploy-webhook-service.yaml`
- `deploy-webhook-ingress.yaml`
- `deploy-webhook-rate-limit-middleware.yaml`
- `deploy-webhook-request-buffer-middleware.yaml`

They are included from `infra/hetzner-k8s/k8s/kustomization.yaml`.

Before applying, verify the rendered manifests:

```bash
kubectl kustomize infra/hetzner-k8s/k8s >/tmp/z8-kustomize.yaml
```

Apply through the repo kustomization when you are ready to deploy the receiver:

```bash
kubectl apply -k infra/hetzner-k8s/k8s
```

The ingress expects DNS for `deploy-webhook.z8-time.app` to point at the cluster ingress. Cert-manager uses the `letsencrypt-prod` ClusterIssuer and writes TLS material to `deploy-webhook-tls`.

## Verification

After applying manifests, verify the receiver resources:

```bash
kubectl -n app-prod get deployment deploy-webhook
kubectl -n app-prod get pod -l app=deploy-webhook
kubectl -n app-prod get ingress deploy-webhook
kubectl -n app-prod get middleware deploy-webhook-rate-limit deploy-webhook-request-buffer
```

Check rollout status:

```bash
kubectl -n app-prod rollout status deployment/deploy-webhook
```

Check health through the cluster service:

```bash
kubectl -n app-prod port-forward svc/deploy-webhook 8080:80
curl http://127.0.0.1:8080/healthz
```

Expected response:

```text
ok
```

Do not test the public webhook endpoint with a fake unsigned payload and expect rollout behavior. Unsigned or incorrectly signed requests are rejected.

## Local Development

Run tests:

```bash
pnpm --filter deploy-webhook test
```

Build the service:

```bash
pnpm --filter deploy-webhook build
```

Run locally only with development-safe values:

```bash
GITHUB_WEBHOOK_SECRET=<development-webhook-secret> pnpm --filter deploy-webhook start
```

Local runs use the default kubeconfig outside `NODE_ENV=production`. Production pods use in-cluster Kubernetes authentication.

## Operational Notes

- The receiver acknowledges a supported webhook only after recording the observation in Kubernetes state.
- Rollout work continues asynchronously after the `202 accepted` response.
- Transient reconciliation failures are retried internally.
- Duplicate GitHub delivery IDs are recorded and ignored on redelivery.
- Older package events are ignored when a newer tag has already been accepted or deployed for the same rollout group.
- App rollouts are serialized as one group. Docs and marketing are serialized independently.
- Migration Jobs are idempotent for a given tag: a completed job is reused, an active job is waited on, and a failed job can be recreated.

## Secret Safety Checklist

Before committing changes in this app, confirm:

- No real webhook secrets, GHCR tokens, kubeconfigs, Phase tokens, or private keys are present in source files.
- Secret values are referenced through `secretKeyRef`, Phase, GitHub Actions `secrets.*`, or local environment variables only.
- Test secrets are obvious dummy values and cannot be used against real services.
- New Kubernetes secret manifests are not committed unless they are intentionally templated and contain no secret data.
