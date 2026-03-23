# Hetzner Multi-Key SSH Design

## Summary

Add repo-managed support for extra SSH public keys in the Hetzner cluster Terraform so the existing primary key workflow remains unchanged while additional operators can retain root access across reprovisioning and node replacement.

## Context

- `infra/hetzner-k8s/tofu/main.tf` currently passes a single primary public key and optional private key into the `kube-hetzner` module.
- The live cluster needed an emergency one-off key append on all nodes so an additional operator key could access the private cluster nodes.
- The upstream `kube-hetzner` module version already supports `ssh_additional_public_keys`, but the repo wrapper does not currently expose it.
- The desired operator model is: keep the primary key path-based for provisioning, and configure collaborator keys as inline public-key strings in tfvars.

## Goals

- Preserve the current primary key provisioning workflow.
- Add declarative support for one or more additional SSH public keys.
- Keep reprovisioning and node replacement able to restore all intended operator access automatically.
- Avoid storing private key material in repo-managed inputs or examples.

## Non-Goals

- No change to Kubernetes manifests under `infra/hetzner-k8s/k8s`.
- No change to cluster topology, workload configuration, or kubeconfig handling.
- No custom SSH key sync scripts or node bootstrap hacks.
- No automatic Hetzner apply in this design; live apply still depends on local tool and credential availability.

## Approved Direction

Use the upstream module's native `ssh_additional_public_keys` support.

Keep:

- `ssh_public_key_path` for the primary public key
- `ssh_private_key_path` for the matching primary private key, preserving the current wrapper behavior when the path is set or left empty

Add:

- `ssh_additional_public_keys` as a repo variable of type `list(string)` with default `[]`

This gives the repo a minimal, upstream-aligned way to persist collaborator SSH access without disturbing the existing provisioning contract.

## Options Considered

### 1. Recommended: expose upstream `ssh_additional_public_keys`

- Smallest and cleanest change.
- Uses functionality already provided by the pinned `kube-hetzner` module.
- Keeps the repo as the source of truth for extra operator access.
- Preserves the current private-key-based provisioning flow.

### 2. Use Hetzner label-based key selection

- Could reduce key strings stored in tfvars.
- Makes access dependent on live Hetzner account label state rather than fully repo-declared inputs.
- Less predictable for disaster recovery or handoff.

### 3. Build a custom key distribution mechanism

- Could support arbitrary future sync logic.
- Adds complexity, drift risk, and security surface.
- Unnecessary because the upstream module already covers the needed use case.

## Architecture

### 1. Terraform input shape

Extend `infra/hetzner-k8s/tofu/variables.tf` with:

```hcl
variable "ssh_additional_public_keys" {
  type        = list(string)
  default     = []
  description = "Additional SSH public keys to install on cluster nodes."
}
```

Keep these existing inputs unchanged:

- `hcloud_token`
- `ssh_public_key_path`
- `ssh_private_key_path`

### 2. Module wiring

Update `infra/hetzner-k8s/tofu/main.tf` so the local wrapper passes the new list directly into the upstream module:

```hcl
ssh_public_key           = file(var.ssh_public_key_path)
ssh_private_key          = var.ssh_private_key_path == "" ? null : file(var.ssh_private_key_path)
ssh_additional_public_keys = var.ssh_additional_public_keys
```

The wrapper remains intentionally thin and delegates SSH key installation behavior to the upstream module.

### 3. Example operator configuration

Update `infra/hetzner-k8s/tofu/terraform.tfvars.example` to document the intended usage pattern:

```hcl
ssh_public_key_path  = "/home/operator/.ssh/id_ed25519.pub"
ssh_private_key_path = "/home/operator/.ssh/id_ed25519"

ssh_additional_public_keys = [
  "ssh-ed25519 AAAA... teammate-1",
  "ssh-ed25519 AAAA... teammate-2",
]
```

Use explicit absolute paths in tfvars examples because `file(...)` should not rely on `~` expansion.

This keeps the primary key path-based while making collaborator access self-contained and machine-independent.

## Data Flow

1. The operator sets the primary key paths locally as before.
2. The operator adds one or more collaborator public keys inline in tfvars.
3. Terraform passes the primary key plus extra public keys into the `kube-hetzner` module.
4. The module installs the resulting authorized key set onto provisioned or replaced nodes.
5. Future node recreation restores both the primary and additional public keys without manual intervention.

## Rollout And Safety

- This is a repo-only Terraform/OpenTofu change under `infra/hetzner-k8s/tofu`.
- It does not modify Kubernetes workload manifests or running application resources by itself.
- It preserves the existing primary key behavior to minimize operational disruption.
- Only public keys are added to the new configuration surface; no private keys or tokens are introduced.
- Live application of the change should still follow the normal infra workflow: inspect first, then `tofu plan`, then `tofu apply` once prerequisites are present.

## Error Handling

- Default the additional key list to `[]` so existing operators are not forced to change their tfvars immediately.
- Keep the variable type as `list(string)` so malformed non-list values fail validation early.
- Avoid custom parsing, file loading, or templating for extra keys to reduce operator mistakes.
- If a live apply is attempted without `HCLOUD_TOKEN` or `tofu`/`terraform`, stop after safe repo changes and report the missing prerequisite explicitly.

## Testing And Verification

Repo-level verification:

- `terraform fmt -check` or `tofu fmt -check` in `infra/hetzner-k8s/tofu`
- `terraform validate` or `tofu validate` in `infra/hetzner-k8s/tofu`

Live infra verification after apply:

- Confirm `tofu plan` shows only the intended SSH key related change.
- Apply with valid `HCLOUD_TOKEN`.
- Verify replacement or reprovisioned nodes receive the extra authorized keys.
- Confirm node reachability still depends on the private-network access path or bastion/NAT-router path already used by the cluster.

## Expected Outcome

- The repo supports multiple operator SSH public keys declaratively.
- Existing provisioning behavior stays familiar for the primary operator key.
- Future node replacement no longer requires manual emergency key insertion for collaborator access.

## Notes

- The current live cluster was updated manually before this design so access is already restored, but that live state is not yet represented in repo-managed infra inputs.
- I did not create a git commit for this spec because no commit was requested.
