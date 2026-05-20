# Compliance Command Center I18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `/compliance` command-center copy through Tolgee `t()` with locale messages.

**Architecture:** Keep loaders responsible for compliance data and risk status. Add translation descriptors to command-center data and render those descriptors in client components using `useTranslate()`.

**Tech Stack:** Next.js client components, React, Tolgee, Luxon, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify `apps/webapp/src/lib/compliance-command-center/types.ts`: add translation descriptor types and update display fields.
- Modify `apps/webapp/src/lib/compliance-command-center/view-model.ts`: summary headline becomes keyed data.
- Modify command-center section loaders under `apps/webapp/src/lib/compliance-command-center/sections/`: return keyed facts/events/link labels.
- Modify `apps/webapp/src/lib/compliance-command-center/loader.ts`: return keyed unavailable states and coverage notes.
- Modify components in `apps/webapp/src/components/compliance-command-center/`: render keyed text via `t()`.
- Modify tests in the same component/lib areas for keyed data and translated rendering.
- Modify `apps/webapp/messages/compliance/{en,de,es,fr,it,pt}.json`: add `compliance.commandCenter.*` messages.

## Tasks

- [ ] Add a failing component test that supplies translated values for command-center keys and expects translated page chrome/data.
- [ ] Add translation descriptor types and update loaders/view-models to return keys/params instead of final English for command-center display text.
- [ ] Update client command-center components to render all descriptors with `t()`.
- [ ] Add locale keys for English, German, Spanish, French, Italian, and Portuguese.
- [ ] Run focused component and lib tests, Biome on touched TS/TSX files, and JSON parsing for edited locale files.

## Verification

- `pnpm --filter webapp test "src/components/compliance-command-center/*.test.tsx" "src/lib/compliance-command-center/**/*.test.ts"`
- `pnpm --dir apps/webapp exec biome check <touched ts/tsx files>`
- `node -e "JSON.parse(...)"` for edited locale JSON files.

## Self-Review

- Spec coverage: includes client chrome, server-generated display strings, locale messages, tests, and unchanged compliance behavior.
- Placeholder scan: no TBD/TODO items remain.
- Type consistency: translation descriptors use `key` plus optional `params`, rendered via Tolgee `t()` on the client.
