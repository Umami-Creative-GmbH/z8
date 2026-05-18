# Kubernetes Prometheus Monitoring Design

## Context

Z8 runs on a Hetzner Cloud Kubernetes cluster managed from `infra/hetzner-k8s`. The current production manifests use plain Kustomize under `infra/hetzner-k8s/k8s`, with Traefik ingress, cert-manager, and application workloads in `app-prod`. The cluster does not currently include a committed monitoring stack.

The goal is to add full cluster monitoring with Prometheus, Grafana, Alertmanager, node-exporter, and kube-state-metrics, while keeping secrets out of git and preserving the existing cluster deployment conventions.

## Scope

The initial monitoring stack includes:

- Prometheus Operator and Prometheus for Kubernetes metric collection.
- Grafana for dashboards, exposed publicly at `https://dash.z8-time.app` through Traefik.
- Alertmanager installed but without external notification receivers until receiver secrets and routes are defined.
- node-exporter and kube-state-metrics for node and Kubernetes object metrics.
- Persistent storage for Prometheus and Grafana using Kubernetes PVCs backed by the existing Hetzner cluster storage integration.

Out of scope for the initial change:

- Creating additional Hetzner VMs or external monitoring hosts.
- Exposing Prometheus or Alertmanager publicly.
- Adding application-level custom metrics endpoints to `web` or `worker`.
- Configuring Slack, email, PagerDuty, or other Alertmanager receivers.

## Approach

Use `prometheus-community/kube-prometheus-stack` as the base monitoring distribution. This is preferred over hand-written Prometheus manifests because it provides the standard operator, CRDs, dashboards, node exporters, kube-state-metrics, and Alertmanager wiring with less custom maintenance.

The repo should store a small monitoring configuration area instead of committing rendered Helm output:

- `infra/hetzner-k8s/monitoring/values.yaml` for kube-prometheus-stack values.
- A deployment command or script using `helm upgrade --install` for repeatable installs and upgrades.
- Optional separate manifests only when Helm chart values are not sufficient for Z8-specific resources.

The main app Kustomize file at `infra/hetzner-k8s/k8s/kustomization.yaml` should not absorb the generated operator stack. Keeping Helm-managed monitoring separate avoids large generated YAML diffs and makes chart upgrades practical.

## Architecture

Create a dedicated `monitoring` namespace for the stack. Install `kube-prometheus-stack` there with these components enabled:

- Prometheus Operator.
- Prometheus.
- Grafana.
- Alertmanager.
- node-exporter.
- kube-state-metrics.

Grafana is exposed through Traefik at `dash.z8-time.app` with TLS issued by the existing `letsencrypt-prod` ClusterIssuer and a Traefik IP allowlist middleware. Prometheus and Alertmanager remain cluster-internal services.

Prometheus discovers Kubernetes and node targets through the operator stack. Future Z8 app metrics can be added by exposing metrics endpoints in the relevant workloads and adding `ServiceMonitor` resources scoped to the correct namespace and labels.

## Secrets

No secret values are committed.

Phase should provide the Grafana admin credential and the Grafana ingress allowlist before deployment. The required Kubernetes secret is `grafana-admin` in the `monitoring` namespace with these keys:

- `admin-user`, set to the chosen Grafana admin username.
- `admin-password`, set to the Grafana admin password.

The Helm values should reference `grafana-admin` as Grafana's existing admin secret rather than embedding credentials in `values.yaml`. If Alertmanager notification receivers are configured later, their webhook URLs, API keys, SMTP passwords, or similar credentials must also be stored through Phase-managed Kubernetes secrets.

Phase should also provide `ALLOWED_GRAFANA_IPS`, a comma-separated list of IPv4 addresses allowed to access `dash.z8-time.app`. Traefik `Middleware` resources cannot read environment variables directly, so the deployment flow should render the Grafana IP allowlist middleware from this Phase-provided value before applying it. Each IPv4 address should be converted to a `/32` CIDR entry in the middleware `sourceRange`.

## Storage And Capacity

The initial deployment uses Kubernetes persistent volume claims rather than new Hetzner VMs. The cluster's existing Hetzner-backed storage class should provision volumes for Prometheus and Grafana.

Initial sizing:

- Prometheus retention: about `15d`.
- Prometheus storage: about `30Gi`.
- Grafana storage: about `10Gi`.

These values are intentionally conservative. If monitoring data volume grows or PVC scheduling fails because of cluster capacity, the follow-up path is to expand Kubernetes worker/storage capacity in Hetzner Cloud, with `nbg1` as the preferred location.

## Access And Security

Grafana is reachable at `https://dash.z8-time.app`, requires Grafana authentication, and is additionally restricted by a Traefik `ipAllowList` middleware. The allowlist source is the Phase-provided `ALLOWED_GRAFANA_IPS` comma list. The initial design does not add OAuth or SSO. Prometheus and Alertmanager are not publicly routed.

The Grafana ingress should use:

- `ingressClassName: traefik`.
- `cert-manager.io/cluster-issuer: letsencrypt-prod`.
- `traefik.ingress.kubernetes.io/router.middlewares` pointing to the generated Grafana allowlist middleware.
- TLS secret dedicated to `dash.z8-time.app`.

DNS for `dash.z8-time.app` must point at the cluster ingress endpoint before certificate issuance can complete.

## Failure Handling

Expected operational failure modes and handling:

- If the `monitoring/grafana-admin` secret is missing, Grafana should fail clearly instead of falling back to a committed or default password.
- If `ALLOWED_GRAFANA_IPS` is missing, empty, or contains invalid IPv4 addresses, the deployment should stop before applying the Grafana ingress or middleware.
- If DNS for `dash.z8-time.app` is missing or wrong, Traefik may route internally but cert-manager HTTP-01 validation will not complete.
- If PVC provisioning fails, inspect the cluster storage class and Hetzner-backed volume capacity before resizing or adding workers.
- If Prometheus targets are down, inspect the generated ServiceMonitors, RBAC, target discovery, and affected pods before changing scrape configuration.

## Verification

Static and deployment verification should include:

- `helm repo add prometheus-community https://prometheus-community.github.io/helm-charts` if the repo is not present locally.
- `helm upgrade --install z8-monitoring prometheus-community/kube-prometheus-stack --namespace monitoring --create-namespace --values infra/hetzner-k8s/monitoring/values.yaml --dry-run`.
- Apply or upgrade the release with the same values after dry-run passes.
- Verify pods in `monitoring` become ready.
- Verify Prometheus has Kubernetes, node, and kube-state-metrics targets up.
- Verify the Grafana ingress host is `dash.z8-time.app`.
- Verify the Grafana ingress references the generated Traefik allowlist middleware.
- Verify the middleware source ranges match `ALLOWED_GRAFANA_IPS` as `/32` CIDRs.
- Verify the TLS certificate for `dash.z8-time.app` reaches Ready.
- Verify Grafana login works with the Phase-provided admin password.

## Open Operational Requirements

Before live deployment, the operator must ensure:

- Phase contains the Grafana admin username/password and syncs them to `monitoring/grafana-admin` keys `admin-user` and `admin-password`.
- Phase contains `ALLOWED_GRAFANA_IPS` as a comma-separated IPv4 list for the Grafana Traefik allowlist.
- DNS for `dash.z8-time.app` points to the cluster ingress.
- `helm` and `kubectl` are available with access to the production cluster.
