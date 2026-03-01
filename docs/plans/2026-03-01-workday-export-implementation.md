# Workday Payroll Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Workday API export (attendance + absences) to Payroll Export with org-configurable employee matching (`employeeNumber` or `email`), alongside existing export options.

**Architecture:** Introduce an API connector abstraction for payroll exporters, adapt Personio and SAP SuccessFactors API to that contract, and implement Workday as a new connector. Keep file-based formatters on the existing path. Update settings actions/UI to configure and test Workday, and update export flow to select target format instead of hardcoded DATEV.

**Tech Stack:** TypeScript, Next.js App Router, Effect runtime, Drizzle ORM, Vitest, React + @tanstack/react-form, Luxon, pnpm.

---

## Implementation Notes

- Follow @test-driven-development for each task (write failing test first).
- Keep YAGNI: do not add Workday CSV support in this plan.
- Preserve multi-tenancy: every action/query/export remains scoped by `organizationId`.
- Keep secrets in org vault only (no env vars for tenant-specific credentials).

### Task 1: Add API connector contract and registry

**Files:**
- Create: `apps/webapp/src/lib/payroll-export/connectors/types.ts`
- Create: `apps/webapp/src/lib/payroll-export/connectors/registry.ts`
- Modify: `apps/webapp/src/lib/payroll-export/export-service.ts`
- Modify: `apps/webapp/src/lib/payroll-export/index.ts`
- Test: `apps/webapp/src/lib/payroll-export/connectors/registry.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createConnectorRegistry } from "./registry";

describe("connector registry", () => {
  it("registers and resolves connectors by id", () => {
    const registry = createConnectorRegistry();
    const connector = {
      connectorId: "workday_api",
      connectorName: "Workday",
      version: "1.0.0",
      validateConfig: async () => ({ valid: true }),
      testConnection: async () => ({ success: true }),
      export: async () => ({
        success: true,
        totalRecords: 0,
        syncedRecords: 0,
        failedRecords: 0,
        skippedRecords: 0,
        errors: [],
        metadata: { employeeCount: 0, dateRange: { start: "", end: "" }, apiCallCount: 0, durationMs: 0 },
      }),
      getSyncThreshold: () => 500,
    };

    registry.register(connector);
    expect(registry.get("workday_api")?.connectorName).toBe("Workday");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/payroll-export/connectors/registry.test.ts`
Expected: FAIL with module/file not found for `connectors/registry`.

**Step 3: Write minimal implementation**

```ts
// connectors/types.ts
export interface IPayrollApiConnector {
  readonly connectorId: string;
  readonly connectorName: string;
  readonly version: string;
  validateConfig(config: Record<string, unknown>): Promise<{ valid: boolean; errors?: string[] }>;
  testConnection(organizationId: string, config: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  export(
    organizationId: string,
    workPeriods: import("../types").WorkPeriodData[],
    absences: import("../types").AbsenceData[],
    mappings: import("../types").WageTypeMapping[],
    config: Record<string, unknown>,
  ): Promise<import("../types").ApiExportResult>;
  getSyncThreshold(): number;
}

// connectors/registry.ts
export function createConnectorRegistry() {
  const map = new Map<string, import("./types").IPayrollApiConnector>();
  return {
    register: (connector: import("./types").IPayrollApiConnector) => map.set(connector.connectorId, connector),
    get: (connectorId: string) => map.get(connectorId),
    list: () => Array.from(map.values()),
    has: (connectorId: string) => map.has(connectorId),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/payroll-export/connectors/registry.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/payroll-export/connectors/types.ts apps/webapp/src/lib/payroll-export/connectors/registry.ts apps/webapp/src/lib/payroll-export/connectors/registry.test.ts apps/webapp/src/lib/payroll-export/export-service.ts apps/webapp/src/lib/payroll-export/index.ts
git commit -m "refactor(payroll): add API connector registry contract"
```

### Task 2: Add adapters for existing API exporters

**Files:**
- Create: `apps/webapp/src/lib/payroll-export/connectors/personio-connector.ts`
- Create: `apps/webapp/src/lib/payroll-export/connectors/successfactors-connector.ts`
- Modify: `apps/webapp/src/lib/payroll-export/export-service.ts`
- Test: `apps/webapp/src/lib/payroll-export/connectors/personio-connector.test.ts`
- Test: `apps/webapp/src/lib/payroll-export/connectors/successfactors-connector.test.ts`

**Step 1: Write failing tests**

```ts
it("delegates Personio connector calls to personioExporter", async () => {
  const result = await personioConnector.validateConfig({});
  expect(result.valid).toBeTypeOf("boolean");
});
```

```ts
it("delegates SuccessFactors connector calls to successFactorsExporter", async () => {
  const result = await successFactorsConnector.testConnection("org_1", {});
  expect(result.success).toBeTypeOf("boolean");
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- src/lib/payroll-export/connectors/personio-connector.test.ts src/lib/payroll-export/connectors/successfactors-connector.test.ts`
Expected: FAIL with missing connector adapters.

**Step 3: Implement adapters and wire registry**

```ts
export const personioConnector: IPayrollApiConnector = {
  connectorId: personioExporter.exporterId,
  connectorName: personioExporter.exporterName,
  version: personioExporter.version,
  validateConfig: (config) => personioExporter.validateConfig(config),
  testConnection: (organizationId, config) => personioExporter.testConnection(organizationId, config),
  export: (organizationId, workPeriods, absences, mappings, config) =>
    personioExporter.export(organizationId, workPeriods, absences, mappings, config),
  getSyncThreshold: () => personioExporter.getSyncThreshold(),
};
```

**Step 4: Run tests to verify pass and no regression**

Run: `pnpm --filter webapp test -- src/lib/payroll-export/connectors/personio-connector.test.ts src/lib/payroll-export/connectors/successfactors-connector.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/payroll-export/connectors/personio-connector.ts apps/webapp/src/lib/payroll-export/connectors/successfactors-connector.ts apps/webapp/src/lib/payroll-export/export-service.ts apps/webapp/src/lib/payroll-export/connectors/personio-connector.test.ts apps/webapp/src/lib/payroll-export/connectors/successfactors-connector.test.ts
git commit -m "refactor(payroll): adapt Personio and SAP to connector layer"
```

### Task 3: Implement Workday connector (types, config, API client, transformer)

**Files:**
- Create: `apps/webapp/src/lib/payroll-export/exporters/workday/types.ts`
- Create: `apps/webapp/src/lib/payroll-export/exporters/workday/api-client.ts`
- Create: `apps/webapp/src/lib/payroll-export/exporters/workday/workday-connector.ts`
- Create: `apps/webapp/src/lib/payroll-export/exporters/workday/index.ts`
- Modify: `apps/webapp/src/lib/payroll-export/types.ts`
- Modify: `apps/webapp/src/lib/payroll-export/index.ts`
- Test: `apps/webapp/src/lib/payroll-export/exporters/workday/workday-connector.test.ts`
- Test: `apps/webapp/src/lib/payroll-export/exporters/workday/api-client.test.ts`

**Step 1: Write failing tests**

```ts
it("validates required Workday config", async () => {
  const result = await workdayConnector.validateConfig({ employeeMatchStrategy: "email" });
  expect(result.valid).toBe(false);
  expect(result.errors?.[0]).toContain("instanceUrl");
});

it("maps employee by configurable strategy", async () => {
  const matched = matchWorkdayEmployee(
    [{ employeeNumber: "E100", email: "a@b.com" }],
    { employeeNumber: "E100", email: "other@b.com" },
    "employeeNumber",
  );
  expect(matched).toBeTruthy();
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- src/lib/payroll-export/exporters/workday/workday-connector.test.ts src/lib/payroll-export/exporters/workday/api-client.test.ts`
Expected: FAIL with missing Workday modules.

**Step 3: Implement minimal Workday connector**

```ts
export interface WorkdayConfig {
  instanceUrl: string;
  tenantId: string;
  employeeMatchStrategy: "employeeNumber" | "email";
  includeZeroHours: boolean;
  batchSize: number;
  apiTimeoutMs: number;
}

export const DEFAULT_WORKDAY_CONFIG: WorkdayConfig = {
  instanceUrl: "",
  tenantId: "",
  employeeMatchStrategy: "employeeNumber",
  includeZeroHours: false,
  batchSize: 100,
  apiTimeoutMs: 60000,
};
```

**Step 4: Run tests to verify pass**

Run: `pnpm --filter webapp test -- src/lib/payroll-export/exporters/workday/workday-connector.test.ts src/lib/payroll-export/exporters/workday/api-client.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/payroll-export/exporters/workday/types.ts apps/webapp/src/lib/payroll-export/exporters/workday/api-client.ts apps/webapp/src/lib/payroll-export/exporters/workday/workday-connector.ts apps/webapp/src/lib/payroll-export/exporters/workday/index.ts apps/webapp/src/lib/payroll-export/types.ts apps/webapp/src/lib/payroll-export/index.ts apps/webapp/src/lib/payroll-export/exporters/workday/workday-connector.test.ts apps/webapp/src/lib/payroll-export/exporters/workday/api-client.test.ts
git commit -m "feat(payroll): add Workday API connector"
```

### Task 4: Add Workday server actions and format/config bootstrap

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.ts`
- Modify: `apps/webapp/src/lib/payroll-export/export-service.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.workday.test.ts`

**Step 1: Write failing tests**

```ts
it("saves and returns Workday config for org", async () => {
  const result = await saveWorkdayConfigAction({
    organizationId: "org_1",
    config: {
      instanceUrl: "https://impl.workday.com",
      tenantId: "tenant_1",
      employeeMatchStrategy: "employeeNumber",
      includeZeroHours: false,
      batchSize: 100,
      apiTimeoutMs: 60000,
    },
  });
  expect(result.success).toBe(true);
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter webapp test -- "src/app/[locale]/(app)/settings/payroll-export/actions.workday.test.ts"`
Expected: FAIL with missing action exports.

**Step 3: Implement actions and format bootstrap**

```ts
const WORKDAY_FORMAT_ID = "workday_api";
const WORKDAY_VAULT_KEY_CLIENT_ID = "payroll/workday/client_id";
const WORKDAY_VAULT_KEY_CLIENT_SECRET = "payroll/workday/client_secret";

export async function getWorkdayConfigAction(organizationId: string) { /* admin check + get config */ }
export async function saveWorkdayConfigAction(input: SaveWorkdayConfigInput) { /* upsert format + config */ }
export async function saveWorkdayCredentialsAction(input: SaveWorkdayCredentialsInput) { /* vault store */ }
export async function deleteWorkdayCredentialsAction(organizationId: string) { /* vault delete */ }
export async function testWorkdayConnectionAction(input: { organizationId: string; config: WorkdayConfig }) { /* connector test */ }
```

**Step 4: Run test to verify pass**

Run: `pnpm --filter webapp test -- "src/app/[locale]/(app)/settings/payroll-export/actions.workday.test.ts"`
Expected: PASS.

**Step 5: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.ts" apps/webapp/src/lib/payroll-export/export-service.ts "apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.workday.test.ts"
git commit -m "feat(payroll): add Workday settings server actions"
```

### Task 5: Add Workday settings UI tab

**Files:**
- Create: `apps/webapp/src/components/settings/payroll-export/workday-config-form.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/page.tsx`
- Modify: `apps/webapp/src/components/settings/payroll-export/index.ts`
- Test: `apps/webapp/src/components/settings/payroll-export/workday-config-form.test.tsx`

**Step 1: Write failing test**

```tsx
it("renders Workday config fields and submits", async () => {
  render(<WorkdayConfigForm organizationId="org_1" initialConfig={null} />);
  expect(screen.getByLabelText(/Instance URL/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Tenant ID/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Save Configuration/i })).toBeInTheDocument();
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter webapp test -- src/components/settings/payroll-export/workday-config-form.test.tsx`
Expected: FAIL with missing component.

**Step 3: Implement minimal UI and page wiring**

```tsx
<TabsTrigger value="workday">{t("settings.payrollExport.tabs.workday", "Workday")}</TabsTrigger>
...
<TabsContent value="workday" className="mt-4">
  <WorkdayConfigForm organizationId={organizationId} initialConfig={workdayConfig} />
</TabsContent>
```

**Step 4: Run test to verify pass**

Run: `pnpm --filter webapp test -- src/components/settings/payroll-export/workday-config-form.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/components/settings/payroll-export/workday-config-form.tsx apps/webapp/src/app/[locale]/(app)/settings/payroll-export/page.tsx apps/webapp/src/components/settings/payroll-export/index.ts apps/webapp/src/components/settings/payroll-export/workday-config-form.test.tsx
git commit -m "feat(payroll-ui): add Workday configuration tab"
```

### Task 6: Make Export tab format-selectable and support Workday start export

**Files:**
- Modify: `apps/webapp/src/components/settings/payroll-export/export-form.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.ts`
- Modify: `apps/webapp/src/lib/payroll-export/export-service.ts`
- Test: `apps/webapp/src/components/settings/payroll-export/export-form.test.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.start-export.test.ts`

**Step 1: Write failing tests**

```tsx
it("sends selected format to startExportAction", async () => {
  render(<ExportForm organizationId="org_1" config={{} as never} />);
  // select Workday and submit
  // assert startExportAction called with formatId: "workday_api"
});
```

```ts
it("uses input formatId instead of hardcoded datev_lohn", async () => {
  const result = await startExportAction({
    organizationId: "org_1",
    formatId: "workday_api",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
  });
  expect(result.success).toBe(true);
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- src/components/settings/payroll-export/export-form.test.tsx "src/app/[locale]/(app)/settings/payroll-export/actions.start-export.test.ts"`
Expected: FAIL due to missing `formatId` support and hardcoded format.

**Step 3: Implement minimal format-selection flow**

```ts
export interface StartExportInput {
  organizationId: string;
  formatId: string;
  startDate: string;
  endDate: string;
  employeeIds?: string[];
  teamIds?: string[];
  projectIds?: string[];
}

// startExportAction -> createExportJob({ formatId: input.formatId, ... })
```

**Step 4: Run tests to verify pass**

Run: `pnpm --filter webapp test -- src/components/settings/payroll-export/export-form.test.tsx "src/app/[locale]/(app)/settings/payroll-export/actions.start-export.test.ts"`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/components/settings/payroll-export/export-form.tsx "apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.ts" apps/webapp/src/lib/payroll-export/export-service.ts apps/webapp/src/components/settings/payroll-export/export-form.test.tsx "apps/webapp/src/app/[locale]/(app)/settings/payroll-export/actions.start-export.test.ts"
git commit -m "feat(payroll): make export target selectable including Workday"
```

### Task 7: Update docs and run full payroll-export verification

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`
- Test: (verification command only)

**Step 1: Write failing doc assertion test (optional lightweight guard)**

```ts
it("documents Workday integration", async () => {
  const doc = await fs.readFile("apps/docs/content/docs/guide/admin-guide/payroll-export.mdx", "utf8");
  expect(doc).toContain("Workday");
});
```

**Step 2: Run check to verify it fails before edit (if test added)**

Run: `pnpm --filter webapp test -- src/lib/payroll-export/docs-smoke.test.ts`
Expected: FAIL until docs mention Workday.

**Step 3: Update documentation**

```md
**API Integrations:**
- **Workday**: Direct API integration with Workday
```

Include:
- setup steps
- matching strategy (`employeeNumber`/`email`)
- connection test flow
- sync status semantics and retry behavior

**Step 4: Run verification suite**

Run: `pnpm --filter webapp test -- src/lib/payroll-export src/components/settings/payroll-export "src/app/[locale]/(app)/settings/payroll-export"`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/docs/content/docs/guide/admin-guide/payroll-export.mdx
git commit -m "docs(payroll): add Workday export guide"
```

## Final Validation Checklist

Run these before opening PR:

1. `pnpm --filter webapp test -- src/lib/payroll-export`
2. `pnpm --filter webapp test -- src/components/settings/payroll-export`
3. `pnpm --filter webapp test -- "src/app/[locale]/(app)/settings/payroll-export"`
4. `pnpm --filter webapp build`

Expected: all PASS.
