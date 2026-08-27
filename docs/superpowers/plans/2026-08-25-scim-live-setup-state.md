# SCIM Live Setup State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep SCIM controls synchronized with saved wizard state and make creation recovery safe and explicit.

**Architecture:** Pass live setup and policy values from the wizard to the SCIM step. The controller reconciles setup-derived connection IDs and status metadata without persisting credentials. SCIM components obtain all display strings through Tolgee fallback calls.

**Tech Stack:** React, TanStack Form, Tolgee, Vitest.

---

### Task 1: Live Wizard Inputs

**Files:**
- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`
- Modify: `apps/webapp/src/components/settings/enterprise/scim/scim-step.tsx`
- Test: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx`

- [ ] Pass the controller's current `setup` and default role template ID to `ManagedScimStep`.
- [ ] Make `ScimStep` and `useScimAdminController` consume those live values.
- [ ] Test saving a new eligible template enables the create control in the mounted wizard.

### Task 2: Creation Reconciliation

**Files:**
- Modify: `apps/webapp/src/components/settings/enterprise/scim/use-scim-admin-controller.ts`
- Modify: `apps/webapp/src/components/settings/enterprise/scim/scim-step.tsx`
- Test: `apps/webapp/src/components/settings/enterprise/scim/use-scim-admin-controller.test.tsx`

- [ ] Add a creating-state reconcile action that fetches only safe status metadata.
- [ ] Keep duplicate create disabled until reconciliation reports a retryable state.
- [ ] Test creating, refreshing to `creation_failed` or disconnected, then retrying without exposing a token.

### Task 3: Tolgee Boundary

**Files:**
- Modify: `apps/webapp/src/components/settings/enterprise/scim/*.tsx`
- Test: `apps/webapp/src/components/settings/enterprise/scim/*.test.tsx`

- [ ] Replace SCIM user-facing literals with namespaced `t(key, fallback)` calls.
- [ ] Format credential last-use dates with current Tolgee locale and UTC timezone.
- [ ] Mock translations by key and run the scoped UI suite and typecheck.
