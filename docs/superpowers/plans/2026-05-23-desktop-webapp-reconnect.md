# Desktop Webapp Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore desktop login compatibility with the current webapp app-auth PKCE flow and default new installs to production.

**Architecture:** Add PKCE generation in the Tauri auth layer, keep the verifier in app state until callback exchange, call the unified `/api/auth/app-login` route, and send `{ code, verifier }` to `/api/auth/app-exchange`. Preserve existing bearer-token time tracking and organization APIs.

**Tech Stack:** Rust/Tauri 2, reqwest, sha2/base64, React/Vite desktop frontend, Next.js webapp auth API.

---

### Task 1: Add PKCE Contract Tests

**Files:**
- Modify: `apps/desktop/src-tauri/src/auth.rs`

- [ ] Add tests proving desktop login uses `/api/auth/app-login?app=desktop` with `challenge` and exchange sends `{ code, verifier }`.
- [ ] Run: `cargo test auth::tests --lib`
- [ ] Expected before implementation: compile or assertion failure around missing PKCE helpers/signatures.

### Task 2: Implement Desktop PKCE Auth

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/auth.rs`
- Modify: `apps/desktop/src-tauri/src/state.rs`

- [ ] Add `sha2` and `base64` dependencies.
- [ ] Add verifier/challenge generation using random bytes, SHA-256, and URL-safe no-padding base64.
- [ ] Store pending verifier in `AppState`.
- [ ] Open `/api/auth/app-login?app=desktop&redirect=...&challenge=...`.
- [ ] Consume verifier during callback exchange and send `{ code, verifier }`.
- [ ] Clear verifier after exchange success or failure.
- [ ] Run: `cargo test auth::tests --lib`.

### Task 3: Default Desktop Webapp URL

**Files:**
- Modify: `apps/desktop/src-tauri/src/settings.rs`
- Modify: `apps/desktop/src/components/Settings.tsx`

- [ ] Default new desktop settings to `https://ui.z8-time.app`.
- [ ] Update the settings placeholder to the same production URL.
- [ ] Preserve existing saved settings.

### Task 4: Verify

**Files:**
- No source edits expected.

- [ ] Run: `pnpm --filter desktop build`.
- [ ] Run: `cargo test` from `apps/desktop/src-tauri` if Linux system dependency `xi.pc` is available.
- [ ] Report any environment-only blocker explicitly.

## Self-Review

- Spec coverage: PKCE login, verifier exchange, in-memory verifier handling, production default URL, and verification are covered.
- Placeholder scan: No TBD/TODO placeholders.
- Type consistency: Uses `code`, `verifier`, `challenge`, and `desktop` consistently with the webapp contract.
