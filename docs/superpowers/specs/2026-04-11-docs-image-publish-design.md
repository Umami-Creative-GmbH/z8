# Docs Image Publish And Deployment Prep Design

## Goal

Add a dedicated GHCR publishing path for the docs app and document the exact later deployment commands, without applying anything to the Kubernetes cluster yet.

## Scope

This design covers two concrete deliverables:

1. A GitHub Actions workflow that publishes `ghcr.io/umami-creative-gmbh/z8-docs` from the root `Dockerfile` `docs` target.
2. Operator-facing instructions for the later manual deployment step using the already-prepared k8s manifests for `docs.z8-time.app`.

This design does not include applying manifests, restarting workloads, or changing any live cluster resources.

## Current Context

- The repo already publishes `z8-webapp`, `z8-worker`, and `z8-migration` through `.github/workflows/publish-images.yml`.
- The repo already publishes `z8-marketing` through `.github/workflows/publish-marketing-image.yml`.
- The docs app now has a `docs` target in the root `Dockerfile` and k8s manifests under `infra/hetzner-k8s/k8s/app/`.
- The docs ingress host is `docs.z8-time.app`.

## Approach

### Image publishing

Use a dedicated workflow modeled on the marketing image workflow.

Reasons:

- The docs app is its own Next.js site and is operationally closer to `marketing` than to the shared-runtime app services.
- This avoids complicating the shared-runtime workflow used for `webapp`, `worker`, and `migration`.
- It keeps the build target explicit: `docker build --target docs`.

The workflow should:

- trigger on `main`, semver tags, and `workflow_dispatch`
- build native `amd64` and `arm64` images
- push per-arch digests to `ghcr.io/umami-creative-gmbh/z8-docs`
- publish a multi-arch manifest with `latest`, `sha-<sha>`, and semver tags

### Deployment instructions

Add concise operator documentation describing the later manual rollout path.

That documentation should include:

- the image name: `ghcr.io/umami-creative-gmbh/z8-docs`
- the persistent manifest location under `infra/hetzner-k8s/k8s`
- the apply command: `kubectl apply -k infra/hetzner-k8s/k8s`
- the verification commands for `deployment/docs`, `service/docs`, and `ingress/docs`

The instructions should be explicit that the docs deployment is intentionally single-replica.

## File Changes

- Create: `.github/workflows/publish-docs-image.yml`
  Purpose: build and publish the multi-arch `z8-docs` image.
- Modify: `deploy/README.md`
  Purpose: document the docs image and the exact later apply and verification commands.

## Non-Goals

- No cluster apply.
- No `kubectl rollout restart`.
- No TLS or ingress debugging against the live cluster.
- No new docs app runtime features beyond publishing and deployment documentation.

## Risks And Mitigations

### Risk: docs build needs files omitted from the runtime image

Mitigation: keep the workflow pointed at the existing root `Dockerfile` `docs` target so image publishing exercises the same packaging path intended for deployment.

### Risk: operators later deploy the wrong resources or forget verification

Mitigation: add exact `kubectl` apply and status commands to repo docs instead of vague prose.

### Risk: docs gets scaled accidentally

Mitigation: keep the single-replica setting in the k8s deployment manifest and mention that expectation in the operator instructions.

## Success Criteria

- A dedicated workflow exists for publishing `ghcr.io/umami-creative-gmbh/z8-docs`.
- The workflow tags and publishes images in the same style as other repo image workflows.
- Repo documentation includes exact commands for later applying and verifying the docs deployment.
- No live cluster changes are made during this work.
