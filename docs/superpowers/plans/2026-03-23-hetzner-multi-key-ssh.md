# Hetzner Multi-Key SSH Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose repo-managed support for additional SSH public keys in the Hetzner cluster Terraform wrapper while preserving the existing primary key path workflow.

**Architecture:** Add one new wrapper variable in `infra/hetzner-k8s/tofu/variables.tf`, pass it through to the pinned `kube-hetzner` module in `infra/hetzner-k8s/tofu/main.tf`, and document the intended operator usage in `infra/hetzner-k8s/tofu/terraform.tfvars.example`. Keep the wrapper thin and rely on the upstream module's native `ssh_additional_public_keys` behavior.

**Tech Stack:** OpenTofu/Terraform, Hetzner `kube-hetzner` module, HCL

---

## References To Read First

- `AGENTS.md`
- `docs/superpowers/specs/2026-03-23-hetzner-multi-key-ssh-design.md`
- `infra/hetzner-k8s/tofu/main.tf`
- `infra/hetzner-k8s/tofu/variables.tf`
- `infra/hetzner-k8s/tofu/terraform.tfvars.example`

## File Map

- Modify: `infra/hetzner-k8s/tofu/variables.tf`
  - Add the new `ssh_additional_public_keys` input with a safe default and precise description.
- Modify: `infra/hetzner-k8s/tofu/main.tf`
  - Pass the new wrapper variable through to `module "kube-hetzner"` next to the existing SSH inputs.
- Modify: `infra/hetzner-k8s/tofu/terraform.tfvars.example`
  - Document the supported operator pattern: absolute paths for the primary key pair plus inline public strings for collaborator keys.

## Delivery Notes

- Keep this change scoped to `infra/hetzner-k8s/tofu`; do not touch `infra/hetzner-k8s/k8s`.
- Do not change the semantics of `ssh_public_key_path` or `ssh_private_key_path` beyond clarifying docs.
- Use absolute path examples in `terraform.tfvars.example`; do not rely on `~` expansion with `file(...)`.
- Do not add private key material, kubeconfig contents, or secret values to docs or examples.

## Task 1: Add the new wrapper input and example usage

**Files:**
- Modify: `infra/hetzner-k8s/tofu/variables.tf`
- Modify: `infra/hetzner-k8s/tofu/terraform.tfvars.example`

- [ ] **Step 1: Confirm the wrapper does not already expose extra SSH keys**

Run:

```bash
rg -n "ssh_additional_public_keys" infra/hetzner-k8s/tofu
```

Expected: no matches.

- [ ] **Step 2: Add the new Terraform variable in `variables.tf`**

Add this block immediately after `ssh_private_key_path` so all SSH inputs stay grouped:

```hcl
variable "ssh_additional_public_keys" {
  type        = list(string)
  default     = []
  description = "Additional SSH public keys to install on cluster nodes."
}
```

- [ ] **Step 3: Update `terraform.tfvars.example` to show the supported operator pattern**

Change the SSH example block to this shape:

```hcl
ssh_public_key_path  = "/home/operator/.ssh/id_ed25519.pub"
ssh_private_key_path = "/home/operator/.ssh/id_ed25519"

ssh_additional_public_keys = [
  "ssh-ed25519 AAAA... teammate-1",
  "ssh-ed25519 AAAA... teammate-2",
]
```

Keep the rest of the example file unchanged.

- [ ] **Step 4: Re-run the search to verify the new input is declared and documented**

Run:

```bash
rg -n "ssh_additional_public_keys|ssh_public_key_path|ssh_private_key_path" infra/hetzner-k8s/tofu/variables.tf infra/hetzner-k8s/tofu/terraform.tfvars.example
```

Expected: matches in both files, including the new list example.

- [ ] **Step 5: Commit the input contract change**

```bash
git add infra/hetzner-k8s/tofu/variables.tf infra/hetzner-k8s/tofu/terraform.tfvars.example
git commit -m "feat(infra): support additional SSH public keys"
```

## Task 2: Wire the new input into the `kube-hetzner` module and validate

**Files:**
- Modify: `infra/hetzner-k8s/tofu/main.tf`
- Modify: `infra/hetzner-k8s/tofu/variables.tf`
- Modify: `infra/hetzner-k8s/tofu/terraform.tfvars.example`

- [ ] **Step 1: Confirm the module block does not yet pass the new input**

Run:

```bash
rg -n "ssh_public_key|ssh_private_key|ssh_additional_public_keys" infra/hetzner-k8s/tofu/main.tf
```

Expected: only `ssh_public_key` and `ssh_private_key` are present.

- [ ] **Step 2: Add the module pass-through in `main.tf`**

Update the SSH block to this shape:

```hcl
  ssh_public_key            = file(var.ssh_public_key_path)
  ssh_private_key           = var.ssh_private_key_path == "" ? null : file(var.ssh_private_key_path)
  ssh_additional_public_keys = var.ssh_additional_public_keys
```

Keep the ordering grouped with the existing SSH settings.

- [ ] **Step 3: Format the Terraform files**

Run one of these, depending on which binary is installed locally:

```bash
tofu -chdir=infra/hetzner-k8s/tofu fmt
```

or

```bash
terraform -chdir=infra/hetzner-k8s/tofu fmt
```

Expected: files are formatted with aligned assignments where appropriate.

- [ ] **Step 4: Initialize the working directory before validation**

Run one of these, depending on which binary is installed locally:

```bash
tofu -chdir=infra/hetzner-k8s/tofu init
```

or

```bash
terraform -chdir=infra/hetzner-k8s/tofu init
```

Expected: provider and module dependencies are installed successfully.

- [ ] **Step 5: Validate the wrapper configuration**

Run one of these, depending on which binary is installed locally:

```bash
tofu -chdir=infra/hetzner-k8s/tofu validate
```

or

```bash
terraform -chdir=infra/hetzner-k8s/tofu validate
```

Expected: validation succeeds with no HCL errors.

- [ ] **Step 6: Run the repo-level formatting verification check**

Run one of these, depending on which binary is installed locally:

```bash
tofu -chdir=infra/hetzner-k8s/tofu fmt -check
```

or

```bash
terraform -chdir=infra/hetzner-k8s/tofu fmt -check
```

Expected: no formatting changes are required.

- [ ] **Step 7: Verify the final diff is scoped correctly**

Run:

```bash
git diff -- infra/hetzner-k8s/tofu/main.tf infra/hetzner-k8s/tofu/variables.tf infra/hetzner-k8s/tofu/terraform.tfvars.example
```

Expected: only the new variable, module wiring, and example usage/path clarification appear.

- [ ] **Step 8: Commit the module wiring**

```bash
git add infra/hetzner-k8s/tofu/main.tf infra/hetzner-k8s/tofu/variables.tf infra/hetzner-k8s/tofu/terraform.tfvars.example
git commit -m "feat(infra): wire additional cluster SSH keys"
```

## Task 3: Capture manual post-merge verification guidance without applying infra changes here

**Files:**
- No repo file changes required.

- [ ] **Step 1: Check infra prerequisites before planning**

Run:

```bash
test -n "$HCLOUD_TOKEN" && echo "HCLOUD_TOKEN set" || echo "HCLOUD_TOKEN missing"
command -v tofu || command -v terraform
```

Expected: `HCLOUD_TOKEN` is set and either `tofu` or `terraform` is installed.

- [ ] **Step 2: Prepare the operator guidance for a manual infra plan**

Use the same real input source the operator normally uses for this cluster, for example a populated `terraform.tfvars`, `*.auto.tfvars`, or explicit `-var-file` arguments that include `ssh_additional_public_keys`.

The manual command the operator should run later is one of these, depending on which binary is installed locally:

```bash
tofu -chdir=infra/hetzner-k8s/tofu plan
```

or

```bash
terraform -chdir=infra/hetzner-k8s/tofu plan
```

Expected: when the operator runs it with real inputs, the plan uses the cluster's real tfvars and shows only the intended SSH key input-related change.

- [ ] **Step 3: Decide whether the plan includes node replacement or reprovisioning**

Review the manual plan output before any future operator-driven apply.

Expected:

- If the plan includes node replacement or reprovisioning, continue with the end-to-end key verification steps below.
- If the plan does not touch any nodes, do not claim node-bootstrap verification yet; record that repo wiring is complete and end-to-end verification remains pending until the next intentional node replacement or reprovision.

- [ ] **Step 4: Prepare the operator guidance for post-apply cluster health verification**

Use the operator's normal kubeconfig path or exported `KUBECONFIG` for this cluster. If the repo-local kubeconfig is the standard path in the current environment, use it without printing its contents.

The manual command the operator should run after their own apply path is:

```bash
kubectl get nodes -o wide
```

Expected: nodes remain `Ready` after the infra change.

- [ ] **Step 5: Prepare the operator guidance for direct key verification on a replaced node**

Run this against the replaced node name, substituting the exact public key string being added:

```bash
kubectl debug node/<replaced-node-name> --image=busybox:1.36 --profile=sysadmin --attach=false -- sleep 300
kubectl exec -n default <debug-pod-name> -- chroot /host sh -lc "grep -qxF 'ssh-ed25519 AAAA... teammate-1' /root/.ssh/authorized_keys"
kubectl delete pod -n default <debug-pod-name>
```

Expected: the `grep` exits successfully, proving the replaced node received the additional authorized key from infra-managed bootstrap.

- [ ] **Step 6: Prepare the operator guidance for validating the access path invariant**

The manual checks after any future apply/reprovision must confirm node reachability still uses the cluster's existing private-network or bastion/NAT-router path, not a new public access path.

Expected: verification notes explicitly confirm the SSH path is unchanged except for the additional authorized public key.

- [ ] **Step 7: If no node was replaced, record the verification boundary explicitly**

Expected: the implementation notes state that config wiring is applied, but end-to-end node bootstrap verification is deferred until a future node replacement or reprovision event.

## Final Verification Checklist

- `infra/hetzner-k8s/tofu/variables.tf` defines `ssh_additional_public_keys` with `default = []`
- `infra/hetzner-k8s/tofu/main.tf` passes `ssh_additional_public_keys = var.ssh_additional_public_keys`
- `infra/hetzner-k8s/tofu/terraform.tfvars.example` shows absolute primary key paths and inline extra public keys
- `tofu fmt -check` or `terraform fmt -check` passes
- `tofu validate` or `terraform validate` passes
- No secrets, private keys, or kubeconfig contents were added to repo files
