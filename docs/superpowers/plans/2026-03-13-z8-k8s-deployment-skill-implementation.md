# Z8 K8s Deployment Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a repo-specific skill for Z8 that manages Kubernetes day-2 operations, manifest updates, and Hetzner/OpenTofu infrastructure with strong secret-handling guardrails.

**Architecture:** Create a new skill under `.agents/skills/z8-k8s-deployment/` with a single `SKILL.md` that documents trigger conditions, required tools/env vars, repo-specific paths, safe execution modes, operational playbooks, and verification rules. Keep the first version lean and self-contained so it is easy to audit, then add eval prompts in a companion JSON file for future iteration.

**Tech Stack:** Markdown skill format, repo-local Kubernetes manifests, OpenTofu/Hetzner conventions, kubectl/hcloud/gh CLI workflows.

---

### Task 1: Add the skill definition

**Files:**
- Create: `.agents/skills/z8-k8s-deployment/SKILL.md`

**Step 1: Write the skill frontmatter and trigger description**

Describe the skill as the default choice for Z8 deployment, rollout, migration, ingress, RustFS, Traefik, and Hetzner/OpenTofu tasks.

**Step 2: Add repo map and prerequisites**

Document relevant directories, kubeconfig expectations, required tools, and env vars such as `HCLOUD_TOKEN`, optional `GH_TOKEN`, and `KUBECONFIG`.

**Step 3: Add safe execution modes and playbooks**

Define `inspect`, `operate`, and `infra` flows, with concrete guidance for image refreshes, migration jobs, scaling, ingress updates, RustFS changes, and Hetzner/OpenTofu actions.

**Step 4: Add verification and safety rules**

Require post-change verification, evidence gathering on failures, and strict no-secrets-in-skill handling.

### Task 2: Add starter eval prompts for later skill iteration

**Files:**
- Create: `.agents/skills/z8-k8s-deployment/evals/evals.json`

**Step 1: Add realistic prompts**

Cover image refreshes, ingress/middleware changes, scaling, and missing-env-var infra inspection behavior.

**Step 2: Keep expected outputs descriptive**

Document what a good run should achieve without overconstraining the first draft.

### Task 3: Validate structure and review content

**Files:**
- Modify: `.agents/skills/z8-k8s-deployment/SKILL.md`
- Modify: `.agents/skills/z8-k8s-deployment/evals/evals.json`

**Step 1: Review for secret safety**

Ensure no tokens, keys, or sensitive literal values are present.

**Step 2: Review for repo-specific accuracy**

Confirm paths and workflows match `infra/hetzner-k8s/tofu`, `infra/hetzner-k8s/k8s`, and current kubectl-driven operations.

**Step 3: Summarize next evaluation steps**

Be ready to run iterative skill tests later if the user wants refinement.
