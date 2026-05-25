# Organization Logo Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make organization logos render with plain image tags, upload to `org-logos/{orgId}/{nanoid}.webp`, and allow organization owners to clear the current logo from settings without deleting S3 objects.

**Architecture:** Add a reusable `OrganizationLogo` component around existing avatar primitives. Add a focused org-logo storage-key helper and use it in the upload process route. Add a server action to clear the organization logo and wire it into the existing organization settings card.

**Tech Stack:** Next.js App Router, React client components, Better Auth organization API, Drizzle-backed auth schema, Vitest, Testing Library, pnpm.

---

## File Structure

- Create `apps/webapp/src/components/organization/organization-logo.tsx`: reusable organization logo display component with plain image behavior through the existing avatar primitive.
- Create `apps/webapp/src/components/organization/organization-logo.test.tsx`: verifies uploaded-logo and fallback rendering.
- Modify `apps/webapp/src/components/organization/organization-details-card.tsx`: use `OrganizationLogo`, add remove-logo button, call clear-logo server action.
- Add or modify `apps/webapp/src/components/organization/organization-details-card.test.tsx`: verifies remove-logo behavior and white trash icon class.
- Modify `apps/webapp/src/components/organization-switcher.tsx`: remove `next/image`, use `OrganizationLogo` in the sidebar and dropdown.
- Modify `apps/webapp/src/lib/storage/avatar-storage.ts`: add `createOrganizationLogoStorageKey` while leaving avatar helpers unchanged.
- Modify `apps/webapp/src/lib/storage/avatar-storage.test.ts`: verify the new org-logo key helper.
- Modify `apps/webapp/src/app/api/upload/process/route.ts`: use the org-logo key helper for `uploadType === "org-logo"`.
- Modify `apps/webapp/src/app/api/upload/process/route.test.ts`: expect `org-logos/org_1/{id}.webp` public URLs.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`: add `removeOrganizationLogo` action with owner authorization and `logo: null` Better Auth update.

### Task 1: Storage Key Helper

**Files:**
- Modify: `apps/webapp/src/lib/storage/avatar-storage.ts`
- Modify: `apps/webapp/src/lib/storage/avatar-storage.test.ts`

- [ ] **Step 1: Add a failing helper test**

Add this test to `avatar-storage.test.ts`:

```ts
it("creates per-organization immutable logo keys", () => {
	expect(createOrganizationLogoStorageKey("org-1", "logo-id")).toBe(
		"org-logos/org-1/logo-id.webp",
	);
});
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter webapp test src/lib/storage/avatar-storage.test.ts`

Expected: FAIL because `createOrganizationLogoStorageKey` is not exported.

- [ ] **Step 3: Implement the helper**

In `avatar-storage.ts`, add:

```ts
export function createOrganizationLogoStorageKey(organizationId: string, id = nanoid()): string {
	return `org-logos/${organizationId}/${id}.webp`;
}
```

- [ ] **Step 4: Run the focused test again**

Run: `pnpm --filter webapp test src/lib/storage/avatar-storage.test.ts`

Expected: PASS.

### Task 2: Upload Process Route

**Files:**
- Modify: `apps/webapp/src/app/api/upload/process/route.ts`
- Modify: `apps/webapp/src/app/api/upload/process/route.test.ts`

- [ ] **Step 1: Update the expected org-logo URL test**

Change the expectation to:

```ts
logo: expect.stringMatching(/^https:\/\/cdn\.example\.com\/org-logos\/org_1\/[A-Za-z0-9_-]+\.webp$/),
```

- [ ] **Step 2: Run the route test and verify failure**

Run: `pnpm --filter webapp test src/app/api/upload/process/route.test.ts`

Expected: FAIL because the route still writes `org-logos/org_1-{timestamp}.webp`.

- [ ] **Step 3: Use the new helper in the route**

Change the storage import to include `createOrganizationLogoStorageKey` and replace the `finalKey` logic with explicit branches:

```ts
const finalKey =
	uploadType === "avatar"
		? createAvatarStorageKey(session.user.id)
		: uploadType === "org-logo" && organizationId
			? createOrganizationLogoStorageKey(organizationId)
			: `${folderMap[uploadType] || "uploads"}/${organizationId}-${Date.now()}.webp`;
```

- [ ] **Step 4: Run the route test again**

Run: `pnpm --filter webapp test src/app/api/upload/process/route.test.ts`

Expected: PASS.

### Task 3: Reusable OrganizationLogo Component

**Files:**
- Create: `apps/webapp/src/components/organization/organization-logo.tsx`
- Create: `apps/webapp/src/components/organization/organization-logo.test.tsx`

- [ ] **Step 1: Write component tests**

Create tests that assert a provided logo URL renders as an `img` with the organization name as alt text, and that missing logo falls back to a building icon container.

- [ ] **Step 2: Run the component tests and verify failure**

Run: `pnpm --filter webapp test src/components/organization/organization-logo.test.tsx`

Expected: FAIL because the component file does not exist.

- [ ] **Step 3: Implement `OrganizationLogo`**

Create a client component that accepts `logo`, `name`, `size = "md"`, `className`, and `fallbackClassName`, uses `Avatar`, `AvatarImage`, and `AvatarFallback`, and maps sizes to existing Tailwind size classes.

- [ ] **Step 4: Run the component tests again**

Run: `pnpm --filter webapp test src/components/organization/organization-logo.test.tsx`

Expected: PASS.

### Task 4: Sidebar Integration

**Files:**
- Modify: `apps/webapp/src/components/organization-switcher.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx` if existing sidebar tests assert image details.

- [ ] **Step 1: Remove `next/image` from the organization switcher**

Delete `import Image from "next/image";`.

- [ ] **Step 2: Render `OrganizationLogo` for active and dropdown organizations**

Use `OrganizationLogo` with `size="sm"` for the active organization and `size="xs"` for dropdown rows, preserving current layout classes.

- [ ] **Step 3: Run sidebar tests**

Run: `pnpm --filter webapp test src/components/app-sidebar.test.tsx`

Expected: PASS, or update mocks only if tests depend on the old direct image implementation.

### Task 5: Clear Logo Server Action

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`

- [ ] **Step 1: Add `removeOrganizationLogo` action**

Add an action that loads the current session, verifies the user is an owner member of the target organization, and calls:

```ts
await auth.api.updateOrganization({
	body: {
		organizationId,
		data: { logo: null },
	},
	headers: await headers(),
});
```

- [ ] **Step 2: Preserve authorization error behavior**

Use the same `AuthorizationError`, `NotFoundError`, `ValidationError`, `runServerActionSafe`, and tracing pattern used by `updateOrganizationDetails`.

### Task 6: Organization Settings Remove Button

**Files:**
- Modify: `apps/webapp/src/components/organization/organization-details-card.tsx`
- Add or modify: `apps/webapp/src/components/organization/organization-details-card.test.tsx`

- [ ] **Step 1: Add a failing component test**

Mock `removeOrganizationLogo`, render an owner organization with a `logo`, click the remove button, and assert the server action receives the organization id and the rendered logo image is removed.

- [ ] **Step 2: Run the focused component test**

Run: `pnpm --filter webapp test src/components/organization/organization-details-card.test.tsx`

Expected: FAIL because the button and action wiring are not present.

- [ ] **Step 3: Implement UI wiring**

Import `IconTrash` from `@tabler/icons-react` and `removeOrganizationLogo` from the organization actions. Add `isRemovingLogo` state and a remove button that appears when `canEdit`, `logoUrl`, and `!isUploading` are true. The trash icon must include `text-white`.

- [ ] **Step 4: Implement mutation behavior**

On click, call `removeOrganizationLogo(organization.id)`. On success, set `logoUrl` to `null` and show a success toast. On failure, show the returned error message or a translated fallback. Do not call any S3 deletion helper.

- [ ] **Step 5: Run focused component test again**

Run: `pnpm --filter webapp test src/components/organization/organization-details-card.test.tsx`

Expected: PASS.

### Task 7: Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run targeted tests**

Run: `pnpm --filter webapp test src/lib/storage/avatar-storage.test.ts src/app/api/upload/process/route.test.ts src/components/organization/organization-logo.test.tsx src/components/organization/organization-details-card.test.tsx src/components/app-sidebar.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run type/lint checks if available for webapp**

Run the repository's standard webapp verification command discovered in `package.json`.

Expected: PASS or document unavailable environment constraints.

## Self-Review

- Spec coverage: The plan covers reusable rendering, sidebar plain image behavior, nested org-logo S3 keys, owner-only clear-logo behavior, no S3 deletion, white trash icon, and tests.
- Placeholder scan: No placeholders remain; each task names files and exact behavior.
- Type consistency: `createOrganizationLogoStorageKey`, `OrganizationLogo`, and `removeOrganizationLogo` names are used consistently across tasks.
