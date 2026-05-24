# Avatar Storage Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store avatar uploads under cleaner keys and delete obsolete Z8-hosted avatar objects on replacement or removal.

**Architecture:** Keep the existing TUS staging and image processing flow. Add small storage helpers for safe key parsing/deletion, update key generation in-place, and preserve current user-facing behavior if S3 cleanup fails.

**Tech Stack:** Next.js route handlers, Better Auth server actions, AWS S3 SDK, Uppy TUS, Vitest, `nanoid`.

---

## File Structure

- Modify `apps/webapp/src/lib/upload/tus-ownership.ts` for `.tmp/tus/` temporary keys and strict sanitizer behavior.
- Modify `apps/webapp/src/lib/upload/tus-ownership.test.ts` to cover the new key shape and traversal rejection.
- Add `apps/webapp/src/lib/upload/tus-url.ts` to parse TUS upload URLs into full S3 object keys.
- Add `apps/webapp/src/lib/upload/tus-url.test.ts` to verify nested-key extraction.
- Add `apps/webapp/src/lib/storage/avatar-storage.ts` to build avatar keys and delete only owned Z8 avatar URLs.
- Add `apps/webapp/src/lib/storage/avatar-storage.test.ts` for key generation and deletion guards.
- Modify `apps/webapp/src/hooks/use-image-upload.ts` and `apps/webapp/src/hooks/use-travel-expense-file-upload.ts` to use the parser.
- Modify `apps/webapp/src/app/api/upload/process/route.ts` to generate new avatar keys and delete old avatars after replacement.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts` to delete old avatars after explicit removal.

### Task 1: Temp Key Prefix And TUS URL Parsing

**Files:**
- Modify: `apps/webapp/src/lib/upload/tus-ownership.ts`
- Modify: `apps/webapp/src/lib/upload/tus-ownership.test.ts`
- Create: `apps/webapp/src/lib/upload/tus-url.ts`
- Create: `apps/webapp/src/lib/upload/tus-url.test.ts`
- Modify: `apps/webapp/src/hooks/use-image-upload.ts`
- Modify: `apps/webapp/src/hooks/use-travel-expense-file-upload.ts`

- [ ] Update tests to expect `.tmp/tus/dXNlci0x-random-key` and reject traversal such as `.tmp/tus/../victim`.
- [ ] Implement `createOwnedTusFileKey()` as `.tmp/tus/${encodeOwnerId(userId)}-${entropy}`.
- [ ] Update `sanitizeTusFileKey()` to allow the exact `.tmp/tus/` prefix while rejecting `..`, backslashes, empty keys, and non-owned keys.
- [ ] Add `getTusFileKeyFromUploadUrl(uploadUrl: string | undefined): string | null`, parsing URLs and decoding the path after `/api/tus/`.
- [ ] Replace `uploadUrl?.split("/").pop()` in both upload hooks.
- [ ] Run `pnpm --filter webapp test src/lib/upload/tus-ownership.test.ts src/lib/upload/tus-url.test.ts`.

### Task 2: Avatar Key Generation And Owned Deletion Helper

**Files:**
- Create: `apps/webapp/src/lib/storage/avatar-storage.ts`
- Create: `apps/webapp/src/lib/storage/avatar-storage.test.ts`
- Modify: `apps/webapp/src/app/api/upload/process/route.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`

- [ ] Add `createAvatarStorageKey(userId: string, id = nanoid()): string` returning `avatars/${userId}/${id}.webp`.
- [ ] Add `getOwnedAvatarKeyFromPublicUrl(url: string | null | undefined, userId: string): string | null`, accepting only URLs under `S3_PUBLIC_URL` with keys `avatars/${userId}/...` or legacy `avatars/${userId}-...`.
- [ ] Add `deleteOwnedAvatarObject(url: string | null | undefined, userId: string): Promise<void>` using `DeleteObjectCommand` and logging cleanup failures.
- [ ] Update image processing to use `createAvatarStorageKey(session.user.id)` for avatars and to call `deleteOwnedAvatarObject(session.user.image, session.user.id)` after a successful replacement.
- [ ] Update `updateProfileImage()` to capture the previous image and call `deleteOwnedAvatarObject(previousImage, session.user.id)` when `result.data.image` is null.
- [ ] Run focused tests for the new helper and existing upload ownership tests.

### Task 3: Verification

**Files:**
- No new files.

- [ ] Run `pnpm --filter webapp test src/lib/upload/tus-ownership.test.ts src/lib/upload/tus-url.test.ts src/lib/storage/avatar-storage.test.ts`.
- [ ] Run `pnpm --filter webapp test` if focused tests pass and runtime allows.
- [ ] Inspect `git diff` to confirm only intended files changed.
