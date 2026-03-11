# Clockin Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a shared settings import hub with `Clockodo` and `Clockin` tabs, preserving the existing Clockodo flow and introducing a conservative Clockin importer that supports time data plus absence and schedule-related imports with duplicate skipping.

**Architecture:** Build a thin shared settings page at `/settings/import` that owns access control, page framing, and tabs. Keep `Clockodo` and `Clockin` as provider-specific modules with separate actions, clients, orchestration, and mapping logic so the existing Clockodo wizard stays stable and Clockin can model its own API without premature abstraction.

**Tech Stack:** Next.js App Router, React, TanStack Query, Drizzle ORM, Vitest, shadcn/ui tabs, Tolgee, Luxon

**Design doc:** `docs/plans/2026-03-11-clockin-import-design.md`

---

### Task 1: Replace the standalone settings entry with a shared import hub entry

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Test: `apps/webapp/src/components/settings/import-settings-config.test.ts`

**Step 1: Write the failing settings-config test**

Create `import-settings-config.test.ts` with a focused test around `getVisibleSettings()` that asserts the data group contains a single import entry pointing to `/settings/import` and no longer exposes `/settings/clockodo-import`.

```tsx
import { describe, expect, it } from "vitest";
import { getVisibleSettings } from "@/components/settings/settings-config";

describe("settings import entry", () => {
	it("shows one shared import entry for admins", () => {
		const entries = getVisibleSettings(true, false);
		const importEntries = entries.filter((entry) => entry.group === "data" && entry.href.includes("import"));

		expect(importEntries.some((entry) => entry.href === "/settings/import")).toBe(true);
		expect(entries.some((entry) => entry.href === "/settings/clockodo-import")).toBe(false);
	});
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/components/settings/import-settings-config.test.ts`

Expected: FAIL because the new test file and shared import entry do not exist yet.

**Step 3: Update the settings entry**

In `settings-config.ts`, replace the existing Clockodo import entry with a new admin-only shared entry:

```ts
{
	id: "data-import",
	titleKey: "settings.import.title",
	titleDefault: "Import Data",
	descriptionKey: "settings.import.description",
	descriptionDefault: "Import data from supported providers like Clockodo and Clockin",
	href: "/settings/import",
	icon: "database-import",
	adminOnly: true,
	group: "data",
}
```

**Step 4: Run the test to verify it passes**

Run: `pnpm test -- --run apps/webapp/src/components/settings/import-settings-config.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/import-settings-config.test.ts
git commit -m "feat(settings): add shared import hub entry"
```

---

### Task 2: Create the shared import hub page with provider tabs

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/import/page.tsx`
- Create: `apps/webapp/src/components/settings/import/import-hub.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/clockodo-import/page.tsx`
- Test: `apps/webapp/src/components/settings/import/import-hub.test.tsx`

**Step 1: Write the failing import hub UI test**

Create `import-hub.test.tsx` to render the new client component and assert both tab triggers are present and that the default tab is `Clockodo`.

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImportHub } from "@/components/settings/import/import-hub";

describe("ImportHub", () => {
	it("renders Clockodo and Clockin tabs", () => {
		render(<ImportHub organizationId="org_123" />);

		expect(screen.getByRole("tab", { name: /clockodo/i })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /clockin/i })).toBeInTheDocument();
	});
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/components/settings/import/import-hub.test.tsx`

Expected: FAIL because the hub component does not exist.

**Step 3: Build the shared route and hub component**

- Create `settings/import/page.tsx` by copying the existing org/admin gate pattern from `settings/clockodo-import/page.tsx`.
- Render a shared page header and the new `ImportHub` component.
- Create `ImportHub` as a client component using `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` from `@/components/ui/tabs`.
- Render the existing `ClockodoImportWizard` inside the `Clockodo` tab.
- Render a temporary `ClockinImportWizard` placeholder component in the `Clockin` tab for now.
- Update the legacy `settings/clockodo-import/page.tsx` to `redirect("/settings/import")` so old links still work.

**Step 4: Run the test to verify it passes**

Run: `pnpm test -- --run apps/webapp/src/components/settings/import/import-hub.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/import/page.tsx apps/webapp/src/components/settings/import/import-hub.tsx apps/webapp/src/app/[locale]/(app)/settings/clockodo-import/page.tsx apps/webapp/src/components/settings/import/import-hub.test.tsx
git commit -m "feat(settings): add shared import hub tabs"
```

---

### Task 3: Scaffold Clockin provider types and API client from the customer API

**Files:**
- Create: `apps/webapp/src/lib/clockin/types.ts`
- Create: `apps/webapp/src/lib/clockin/client.ts`
- Test: `apps/webapp/src/lib/clockin/client.test.ts`

**Step 1: Write the failing client test**

Create `client.test.ts` with one focused test that mocks `fetch` and asserts the client sends the configured auth headers and parses a simple JSON response for one chosen endpoint.

```ts
import { describe, expect, it, vi } from "vitest";
import { ClockinClient } from "@/lib/clockin/client";

describe("ClockinClient", () => {
	it("sends authenticated requests", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: [] }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const client = new ClockinClient("token-value");
		await client.getEmployees();

		expect(fetchMock).toHaveBeenCalled();
	});
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/lib/clockin/client.test.ts`

Expected: FAIL because the Clockin client does not exist.

**Step 3: Create the minimal client and types**

- Inspect the Clockin customer API and identify the exact endpoints and auth scheme for employees, time records, absences, and schedules.
- Add typed response models in `types.ts` only for the first-release entities.
- Implement `ClockinClient` with:
  - constructor for the required credential(s)
  - shared request helper
  - one method per supported endpoint
  - a connection test method used by server actions
- Keep the client conservative: no generic provider abstraction, no unused endpoint wrappers.

**Step 4: Run the test to verify it passes**

Run: `pnpm test -- --run apps/webapp/src/lib/clockin/client.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/clockin/types.ts apps/webapp/src/lib/clockin/client.ts apps/webapp/src/lib/clockin/client.test.ts
git commit -m "feat(clockin): add typed API client"
```

---

### Task 4: Add provider-specific Clockin mapping and duplicate-detection helpers

**Files:**
- Create: `apps/webapp/src/lib/clockin/import-types.ts`
- Create: `apps/webapp/src/lib/clockin/duplicate-detection.ts`
- Test: `apps/webapp/src/lib/clockin/duplicate-detection.test.ts`

**Step 1: Write the failing duplicate-detection tests**

Create `duplicate-detection.test.ts` with cases for:

- same employee + same remote time window -> duplicate
- same employee + different time window -> not duplicate
- missing employee mapping -> not duplicate yet

```ts
import { describe, expect, it } from "vitest";
import { isClockinWorkLogDuplicate } from "@/lib/clockin/duplicate-detection";

describe("Clockin duplicate detection", () => {
	it("marks matching employee and time window as duplicate", () => {
		expect(
			isClockinWorkLogDuplicate({ employeeId: "emp_1", start: "2026-03-01T08:00:00Z", end: "2026-03-01T16:00:00Z" }, { employeeId: "emp_1", start: "2026-03-01T08:00:00Z", end: "2026-03-01T16:00:00Z" }),
		).toBe(true);
	});
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/lib/clockin/duplicate-detection.test.ts`

Expected: FAIL because the helper module does not exist.

**Step 3: Implement minimal provider-specific import types and helpers**

- Define the internal Clockin import shapes needed by the wizard and orchestrator.
- Implement explicit duplicate helpers for each supported entity class instead of one over-generic matcher.
- Use Luxon for date normalization and comparisons.

**Step 4: Run the test to verify it passes**

Run: `pnpm test -- --run apps/webapp/src/lib/clockin/duplicate-detection.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/clockin/import-types.ts apps/webapp/src/lib/clockin/duplicate-detection.ts apps/webapp/src/lib/clockin/duplicate-detection.test.ts
git commit -m "feat(clockin): add duplicate detection helpers"
```

---

### Task 5: Add Clockin server actions with org/admin enforcement

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.test.ts`

**Step 1: Write the failing server-action test**

Create `clockin-actions.test.ts` with one test that verifies unauthorized users are rejected before any Clockin client call is made.

```ts
import { describe, expect, it, vi } from "vitest";
import { validateClockinCredentials } from "@/app/[locale]/(app)/settings/import/clockin-actions";

describe("Clockin actions", () => {
	it("rejects non-admin imports", async () => {
		await expect(validateClockinCredentials("token", "org_123")).rejects.toThrow("Unauthorized");
	});
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.test.ts`

Expected: FAIL because the action module does not exist.

**Step 3: Implement the minimal action surface**

Model the new module after the existing Clockodo actions file, but keep it Clockin-specific.

Add actions for:

- credential validation and preview loading
- fetching Clockin users/employees for mapping
- fetching Z8 employees for mapping
- starting the import run

Use a local `requireAdmin()` helper and ensure every query and write is scoped by `organizationId`.

**Step 4: Run the test to verify it passes**

Run: `pnpm test -- --run apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.ts apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.test.ts
git commit -m "feat(clockin): add scoped import actions"
```

---

### Task 6: Implement the Clockin import orchestrator

**Files:**
- Create: `apps/webapp/src/lib/clockin/import-orchestrator.ts`
- Test: `apps/webapp/src/lib/clockin/import-orchestrator.test.ts`

**Step 1: Write the failing orchestrator tests**

Create `import-orchestrator.test.ts` with one happy-path test and one duplicate-skip test.

```ts
import { describe, expect, it } from "vitest";
import { orchestrateClockinImport } from "@/lib/clockin/import-orchestrator";

describe("orchestrateClockinImport", () => {
	it("reports duplicate work logs as skipped", async () => {
		const result = await orchestrateClockinImport(/* mocked dependencies */);

		expect(result.entries.skipped).toBe(1);
		expect(result.entries.imported).toBe(0);
	});
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/lib/clockin/import-orchestrator.test.ts`

Expected: FAIL because the orchestrator does not exist.

**Step 3: Implement the orchestrator in phases**

- fetch provider data for selected entities
- resolve employee mappings
- query existing Z8 data inside the active organization
- skip duplicates using the provider-specific helpers
- write only non-duplicate records
- build a structured per-entity result summary with `imported`, `skipped`, and `failed`

Keep phases narrow and restartable. Prefer clear result reporting over a single giant transaction.

**Step 4: Run the test to verify it passes**

Run: `pnpm test -- --run apps/webapp/src/lib/clockin/import-orchestrator.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/clockin/import-orchestrator.ts apps/webapp/src/lib/clockin/import-orchestrator.test.ts
git commit -m "feat(clockin): add phased import orchestrator"
```

---

### Task 7: Build the Clockin wizard UI and wire it into the import hub

**Files:**
- Create: `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx`
- Modify: `apps/webapp/src/components/settings/import/import-hub.tsx`
- Test: `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx`

**Step 1: Write the failing wizard UI test**

Create a test that renders the Clockin wizard and verifies the first step collects credentials and can progress to a preview state when the mocked validation action succeeds.

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ClockinImportWizard } from "@/components/settings/clockin-import/clockin-import-wizard";

describe("ClockinImportWizard", () => {
	it("advances from credentials to preview", async () => {
		render(<ClockinImportWizard organizationId="org_123" />);

		expect(screen.getByText(/connect/i)).toBeInTheDocument();
	});
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm test -- --run apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx`

Expected: FAIL because the wizard does not exist.

**Step 3: Implement the minimal wizard**

- Follow the structure of `ClockodoImportWizard` without trying to extract a shared mega-wizard.
- Add states for `connect`, `preview`, `mapping`, `selection`, `importing`, and `complete`.
- Use provider-specific copy and result summaries.
- Wire the Clockin tab in `ImportHub` to render the real wizard instead of the placeholder.

**Step 4: Run the test to verify it passes**

Run: `pnpm test -- --run apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx apps/webapp/src/components/settings/import/import-hub.tsx apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx
git commit -m "feat(clockin): add import wizard UI"
```

---

### Task 8: Finalize i18n, regression checks, and end-to-end verification

**Files:**
- Modify: `apps/webapp/src/tolgee/shared.ts`
- Modify: any touched locale files discovered from the existing settings translation structure
- Verify: `apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.tsx`
- Verify: `apps/webapp/src/components/settings/import/import-hub.tsx`

**Step 1: Add missing translation keys**

Add translation keys for the new shared import hub and all new Clockin copy introduced by the wizard.

**Step 2: Run targeted tests**

Run:

```bash
pnpm test -- --run apps/webapp/src/components/settings/import/import-hub.test.tsx apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.test.tsx apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.test.ts apps/webapp/src/lib/clockin/client.test.ts apps/webapp/src/lib/clockin/duplicate-detection.test.ts apps/webapp/src/lib/clockin/import-orchestrator.test.ts
```

Expected: PASS

**Step 3: Run the full app verification commands**

Run:

```bash
pnpm test
pnpm build
```

Expected: PASS

**Step 4: Manual verification checklist**

- open `/settings/import` as an admin
- confirm `Clockodo` tab still loads the existing flow
- confirm `Clockin` tab keeps its own state when switching tabs
- verify duplicate imports are reported as skipped, not updated
- verify old `/settings/clockodo-import` links redirect correctly

**Step 5: Commit**

```bash
git add apps/webapp/src/tolgee/shared.ts apps/webapp/src/components/settings/import/import-hub.tsx apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx
git commit -m "feat(import): finalize shared import hub and clockin flow"
```
