# Platform vs Org Admin Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename ambiguous admin paths into explicit scope-based namespaces by moving platform UI to `/platform-admin`, moving org-admin APIs to `/api/org-admin`, and using `/api/platform-admin` for platform-level APIs.

**Architecture:** Apply a hard cutover with no compatibility redirects. Keep authorization behavior the same, but align route/API taxonomy to permission boundaries (`platform-admin` vs `org-admin`) so responsibilities are self-documenting. Enforce scope with tests and a guardrail that blocks reintroducing legacy `/admin` and `/api/admin` literals.

**Tech Stack:** Next.js App Router, TypeScript, Effect services, Tolgee i18n, Vitest, pnpm/turbo.

---

### Task 1: Add route-namespace tests before changes

**Files:**
- Create: `apps/webapp/src/tolgee/__tests__/shared-route-namespaces.test.ts`
- Modify: `apps/webapp/src/tolgee/shared.ts`
- Test: `apps/webapp/src/tolgee/__tests__/shared-route-namespaces.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { getNamespacesForRoute } from "@/tolgee/shared";

describe("route namespaces", () => {
  it("loads admin namespaces for /platform-admin", () => {
    expect(getNamespacesForRoute("/platform-admin")).toEqual(["common", "admin"]);
  });

  it("loads admin+settings namespaces for /platform-admin/worker-queue", () => {
    expect(getNamespacesForRoute("/platform-admin/worker-queue")).toEqual([
      "common",
      "admin",
      "settings",
    ]);
  });

  it("does not special-case legacy /admin", () => {
    expect(getNamespacesForRoute("/admin")).toEqual(["common"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/tolgee/__tests__/shared-route-namespaces.test.ts`
Expected: FAIL because `shared.ts` still maps `/admin` and not `/platform-admin`.

**Step 3: Write minimal implementation**

```ts
// in ROUTE_NAMESPACES
"/platform-admin": ["common", "admin"],
"/platform-admin/worker-queue": ["common", "admin", "settings"],
// remove legacy /admin mappings
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/tolgee/__tests__/shared-route-namespaces.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/tolgee/shared.ts apps/webapp/src/tolgee/__tests__/shared-route-namespaces.test.ts
git commit -m "test(i18n): lock platform admin route namespace mapping"
```

### Task 2: Move platform UI links/routes to `/platform-admin`

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/admin/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/admin/billing/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/admin/users/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/admin/users/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/admin/organizations/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/admin/organizations/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/admin/settings/page.tsx`

**Step 1: Write the failing test**

Create a literal-path guard test that fails if platform UI still contains `/admin` links.

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("platform admin route literals", () => {
  it("uses /platform-admin in platform layout", () => {
    const source = readFileSync(
      "src/app/[locale]/(admin)/layout.tsx",
      "utf8",
    );
    expect(source.includes('"/admin')).toBe(false);
    expect(source.includes('"/platform-admin')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/[locale]/(admin)/__tests__/platform-admin-paths.test.ts`
Expected: FAIL because layout still points to `/admin`.

**Step 3: Write minimal implementation**

```tsx
// example replacements
href: "/platform-admin"
href: "/platform-admin/users"
redirect("/platform-admin")
revalidatePath("/platform-admin/users")
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/app/[locale]/(admin)/__tests__/platform-admin-paths.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(admin)/layout.tsx apps/webapp/src/app/[locale]/(admin)/admin
git commit -m "refactor(platform-admin): move UI route links to /platform-admin"
```

### Task 3: Rename org-admin APIs from `/api/admin` to `/api/org-admin`

**Files:**
- Move: `apps/webapp/src/app/api/admin/billing/route.ts` -> `apps/webapp/src/app/api/org-admin/billing/route.ts`
- Move: `apps/webapp/src/app/api/admin/holiday-categories/route.ts` -> `apps/webapp/src/app/api/org-admin/holiday-categories/route.ts`
- Move: `apps/webapp/src/app/api/admin/holiday-categories/[id]/route.ts` -> `apps/webapp/src/app/api/org-admin/holiday-categories/[id]/route.ts`
- Move: `apps/webapp/src/app/api/admin/holidays/route.ts` -> `apps/webapp/src/app/api/org-admin/holidays/route.ts`
- Move: `apps/webapp/src/app/api/admin/holidays/[id]/route.ts` -> `apps/webapp/src/app/api/org-admin/holidays/[id]/route.ts`
- Move: `apps/webapp/src/app/api/admin/holidays/import/route.ts` -> `apps/webapp/src/app/api/org-admin/holidays/import/route.ts`
- Move: `apps/webapp/src/app/api/admin/holidays/preview/route.ts` -> `apps/webapp/src/app/api/org-admin/holidays/preview/route.ts`
- Move: `apps/webapp/src/app/api/admin/holiday-presets/route.ts` -> `apps/webapp/src/app/api/org-admin/holiday-presets/route.ts`
- Move: `apps/webapp/src/app/api/admin/holiday-presets/[id]/route.ts` -> `apps/webapp/src/app/api/org-admin/holiday-presets/[id]/route.ts`

**Step 1: Write the failing test**

Add a guard test for route-path literals in org settings callers.

```ts
expect(source.includes("/api/admin/")).toBe(false);
expect(source.includes("/api/org-admin/")).toBe(true);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/components/settings/__tests__/org-admin-endpoints.test.ts`
Expected: FAIL because current callers still use `/api/admin/...`.

**Step 3: Write minimal implementation**

Move the route directories and keep route handler logic unchanged.

```ts
// before: src/app/api/admin/.../route.ts
// after:  src/app/api/org-admin/.../route.ts
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/components/settings/__tests__/org-admin-endpoints.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/api/org-admin apps/webapp/src/app/api/admin
git commit -m "refactor(org-admin): move org settings APIs to /api/org-admin"
```

### Task 4: Update org settings API callers to `/api/org-admin`

**Files:**
- Modify: `apps/webapp/src/components/settings/holiday-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/holiday-import-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/category-dialog.tsx`
- Modify: any additional callers found via grep for `"/api/admin/"`

**Step 1: Write the failing test**

Create a file-scan test over settings components to forbid `/api/admin/` literals.

```ts
const forbidden = "/api/admin/";
expect(source.includes(forbidden)).toBe(false);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/components/settings/__tests__/forbid-legacy-admin-api-literals.test.ts`
Expected: FAIL with matches in holiday/category components.

**Step 3: Write minimal implementation**

```ts
// examples
fetch("/api/org-admin/holidays")
fetch(`/api/org-admin/holidays/${id}`)
fetch(`/api/org-admin/holidays/preview?${params}`)
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/components/settings/__tests__/forbid-legacy-admin-api-literals.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/components/settings
git commit -m "refactor(settings): use /api/org-admin endpoints"
```

### Task 5: Establish `/api/platform-admin` namespace

**Files:**
- Create/Move as needed under: `apps/webapp/src/app/api/platform-admin/*`
- Modify callers in platform-admin pages/actions if any API fetches exist
- Test: `apps/webapp/src/lib/__tests__/admin-scope-paths.test.ts`

**Step 1: Write the failing test**

Add assertions that platform-admin API calls (if present) use `/api/platform-admin/` and not `/api/admin/`.

```ts
expect(source.includes("/api/platform-admin/")).toBe(true);
expect(source.includes("/api/admin/")).toBe(false);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/__tests__/admin-scope-paths.test.ts`
Expected: FAIL if any platform API caller still uses legacy namespace.

**Step 3: Write minimal implementation**

Create/relocate platform API handlers and update callers.

```ts
// canonical platform API root
const PLATFORM_ADMIN_API_ROOT = "/api/platform-admin";
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/__tests__/admin-scope-paths.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/api/platform-admin apps/webapp/src/lib apps/webapp/src/app/[locale]/(admin)
git commit -m "refactor(platform-admin): adopt /api/platform-admin namespace"
```

### Task 6: Update platform-admin wording and docs

**Files:**
- Modify: `apps/webapp/messages/admin/en.json`
- Modify: `apps/webapp/messages/admin/de.json`
- Modify: `apps/webapp/messages/admin/es.json`
- Modify: `apps/webapp/messages/admin/fr.json`
- Modify: `apps/webapp/messages/admin/it.json`
- Modify: `apps/webapp/messages/admin/pt.json`
- Modify: `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`

**Step 1: Write the failing test**

Add a docs/content assertion for platform entrypoint text.

```ts
expect(doc.includes("Navigate to `/platform-admin`")).toBe(true);
expect(doc.includes("Navigate to `/admin`")).toBe(false);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/__tests__/platform-admin-wording.test.ts`
Expected: FAIL until wording and route text are updated.

**Step 3: Write minimal implementation**

Update copy from generic admin labels to platform-specific wording where scope is platform-level.

```json
{
  "admin": {
    "layout": {
      "title": "Platform Admin Console"
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/__tests__/platform-admin-wording.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/messages/admin apps/docs/content/docs/guide/admin-guide/platform-admin.mdx
git commit -m "docs(i18n): rename platform scope wording and access path"
```

### Task 7: Add hard-cutover guardrail against legacy paths

**Files:**
- Create: `apps/webapp/src/lib/__tests__/legacy-admin-path-guard.test.ts`

**Step 1: Write the failing test**

Create a test that scans app code for forbidden literals:

```ts
const forbidden = ["/admin", "/api/admin/"];
// allowlist only comments/test fixtures if needed
expect(matches).toEqual([]);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/__tests__/legacy-admin-path-guard.test.ts`
Expected: FAIL while legacy literals still exist.

**Step 3: Write minimal implementation**

Finish remaining path updates until guard test is green.

```ts
// maintain a tiny allowlist for non-runtime docs or migration notes if necessary
const ALLOWLIST: string[] = [];
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/__tests__/legacy-admin-path-guard.test.ts`
Expected: PASS with zero runtime path matches.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/__tests__/legacy-admin-path-guard.test.ts apps/webapp/src
git commit -m "test(routing): block reintroduction of legacy admin paths"
```

### Task 8: Full verification and final cleanup

**Files:**
- Modify: any touched files required by lint/test fixes

**Step 1: Write the failing test**

No new test. Use full suite verification as acceptance gate.

**Step 2: Run test to verify failures (if any)**

Run: `pnpm --filter webapp test`
Expected: PASS. If FAIL, capture failing specs and fix minimally.

**Step 3: Write minimal implementation**

Apply only targeted fixes for failing tests or type errors.

```ts
// minimal fix only; no opportunistic refactors
```

**Step 4: Run final verification**

Run: `pnpm --filter webapp test && pnpm --filter webapp build`
Expected: PASS for both commands.

**Step 5: Commit**

```bash
git add apps/webapp apps/docs
git commit -m "refactor(routing): split platform-admin and org-admin namespaces"
```

## Post-Implementation Checks

- Manually verify platform-admin navigation resolves only under `/platform-admin`.
- Manually verify org settings pages perform successful requests against `/api/org-admin/*`.
- Confirm runtime logs show no requests to `/admin` or `/api/admin` after deployment.
- Update release notes: hard cutover with no legacy aliases.
