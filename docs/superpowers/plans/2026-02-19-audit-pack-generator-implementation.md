# Audit Pack Generator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a one-click GoBD audit pack generator that creates an org-scoped, date-range bundle (JSON+CSV) with full correction lineage, approval history, audit timeline, and package-level cryptographic hardening.

**Architecture:** Add a dedicated `audit-pack` application module that collects and normalizes evidence, then delegates final signing/timestamp/WORM handling to the existing `audit-export` hardening pipeline. Trigger generation from the Admin settings UI via async BullMQ jobs, and expose progress/status through existing job-status polling.

**Tech Stack:** Next.js 16, Drizzle ORM (PostgreSQL), BullMQ, Effect server actions, Luxon, TanStack Form, Vitest.

**Design doc:** `docs/plans/2026-02-19-audit-pack-generator-design.md`

---

### Task 1: Add audit-pack schema and status model

**Files:**
- Create: `apps/webapp/src/db/schema/audit-pack.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Modify: `apps/webapp/src/db/index.ts`
- Create: `apps/webapp/src/db/schema/__tests__/audit-pack-schema.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { auditPackRequest, auditPackArtifact } from "@/db/schema/audit-pack";

describe("audit-pack schema", () => {
  it("defines request and artifact tables", () => {
    expect(auditPackRequest).toBeDefined();
    expect(auditPackArtifact).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/audit-pack-schema.test.ts`
Expected: FAIL with module-not-found for `@/db/schema/audit-pack`.

**Step 3: Write minimal implementation**

Add schema with enums and tables:

```typescript
export const auditPackStatusEnum = pgEnum("audit_pack_status", [
  "requested",
  "collecting",
  "lineage_expanding",
  "assembling",
  "hardening",
  "completed",
  "failed",
]);

export const auditPackRequest = pgTable("audit_pack_request", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  requestedById: text("requested_by_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  status: auditPackStatusEnum("status").notNull().default("requested"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const auditPackArtifact = pgTable("audit_pack_artifact", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull().references(() => auditPackRequest.id, { onDelete: "cascade" }).unique(),
  auditExportPackageId: uuid("audit_export_package_id").references(() => auditExportPackage.id, { onDelete: "set null" }),
  s3Key: text("s3_key"),
  entryCount: integer("entry_count").default(0).notNull(),
  correctionNodeCount: integer("correction_node_count").default(0).notNull(),
  approvalEventCount: integer("approval_event_count").default(0).notNull(),
  timelineEventCount: integer("timeline_event_count").default(0).notNull(),
  expandedNodeCount: integer("expanded_node_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Also export tables/relations from schema barrels and db index.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/audit-pack-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/db/schema/audit-pack.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/index.ts apps/webapp/src/db/schema/__tests__/audit-pack-schema.test.ts
git commit -m "feat(audit-pack): add request and artifact schema"
```

---

### Task 2: Build correction-lineage closure logic with tests

**Files:**
- Create: `apps/webapp/src/lib/audit-pack/domain/types.ts`
- Create: `apps/webapp/src/lib/audit-pack/domain/correction-lineage-builder.ts`
- Create: `apps/webapp/src/lib/audit-pack/domain/__tests__/correction-lineage-builder.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { buildCorrectionClosure } from "../correction-lineage-builder";

describe("buildCorrectionClosure", () => {
  it("includes out-of-range linked nodes until graph closure", () => {
    const result = buildCorrectionClosure([
      { id: "b", previousEntryId: "a", replacesEntryId: null, supersededById: "c" },
    ], {
      a: { id: "a", previousEntryId: null, replacesEntryId: null, supersededById: "b" },
      c: { id: "c", previousEntryId: "b", replacesEntryId: "b", supersededById: null },
    });

    expect(result.nodeIds.sort()).toEqual(["a", "b", "c"]);
    expect(result.expandedOutsideRange).toEqual(["a", "c"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/domain/__tests__/correction-lineage-builder.test.ts`
Expected: FAIL with missing export or wrong closure behavior.

**Step 3: Write minimal implementation**

```typescript
export function buildCorrectionClosure(seed: EntryLink[], lookup: Record<string, EntryLink>): ClosureResult {
  const queue = [...seed.map((s) => s.id)];
  const visited = new Set<string>(queue);
  const seedIds = new Set(queue);

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = lookup[id] ?? seed.find((s) => s.id === id);
    if (!node) continue;

    for (const linkedId of [node.previousEntryId, node.replacesEntryId, node.supersededById]) {
      if (linkedId && !visited.has(linkedId)) {
        visited.add(linkedId);
        queue.push(linkedId);
      }
    }
  }

  return {
    nodeIds: [...visited],
    expandedOutsideRange: [...visited].filter((id) => !seedIds.has(id)),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/domain/__tests__/correction-lineage-builder.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/audit-pack/domain/types.ts apps/webapp/src/lib/audit-pack/domain/correction-lineage-builder.ts apps/webapp/src/lib/audit-pack/domain/__tests__/correction-lineage-builder.test.ts
git commit -m "feat(audit-pack): add correction lineage closure builder"
```

---

### Task 3: Implement entry, approval, and timeline evidence builders

**Files:**
- Create: `apps/webapp/src/lib/audit-pack/domain/entry-chain-builder.ts`
- Create: `apps/webapp/src/lib/audit-pack/domain/approval-evidence-builder.ts`
- Create: `apps/webapp/src/lib/audit-pack/domain/audit-timeline-builder.ts`
- Create: `apps/webapp/src/lib/audit-pack/domain/__tests__/audit-timeline-builder.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { buildAuditTimeline } from "../audit-timeline-builder";

describe("buildAuditTimeline", () => {
  it("sorts timeline deterministically by timestamp then source", () => {
    const timeline = buildAuditTimeline([
      { source: "approval", occurredAt: "2026-02-01T10:00:00.000Z", id: "2" },
      { source: "entry", occurredAt: "2026-02-01T10:00:00.000Z", id: "1" },
    ]);

    expect(timeline.map((e) => e.id)).toEqual(["1", "2"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/domain/__tests__/audit-timeline-builder.test.ts`
Expected: FAIL because builder does not exist yet.

**Step 3: Write minimal implementation**

```typescript
const sourceOrder = { entry: 0, approval: 1, audit_log: 2 } as const;

export function buildAuditTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt.localeCompare(b.occurredAt);
    const sourceCompare = sourceOrder[a.source] - sourceOrder[b.source];
    if (sourceCompare !== 0) return sourceCompare;
    return a.id.localeCompare(b.id);
  });
}
```

Implement entry and approval builders with org-scoped inputs and normalized output shapes used by the assembler.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/domain/__tests__/audit-timeline-builder.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/audit-pack/domain/entry-chain-builder.ts apps/webapp/src/lib/audit-pack/domain/approval-evidence-builder.ts apps/webapp/src/lib/audit-pack/domain/audit-timeline-builder.ts apps/webapp/src/lib/audit-pack/domain/__tests__/audit-timeline-builder.test.ts
git commit -m "feat(audit-pack): add evidence builders for entries approvals and timeline"
```

---

### Task 4: Create deterministic bundle assembler (JSON + CSV)

**Files:**
- Create: `apps/webapp/src/lib/audit-pack/domain/bundle-assembler.ts`
- Create: `apps/webapp/src/lib/audit-pack/domain/__tests__/bundle-assembler.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { assembleAuditPackZip } from "../bundle-assembler";

describe("assembleAuditPackZip", () => {
  it("produces stable output for identical input", async () => {
    const input = { entries: [], corrections: [], approvals: [], timeline: [], scope: {} };
    const zipA = await assembleAuditPackZip(input);
    const zipB = await assembleAuditPackZip(input);
    expect(zipA.equals(zipB)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/domain/__tests__/bundle-assembler.test.ts`
Expected: FAIL with missing assembler.

**Step 3: Write minimal implementation**

```typescript
const stableStringify = (value: unknown) => JSON.stringify(value, Object.keys(value as object).sort(), 2);

export async function assembleAuditPackZip(input: AuditPackAssembleInput): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("evidence/entries.json", stableStringify(input.entries));
  zip.file("evidence/corrections.json", stableStringify(input.corrections));
  zip.file("evidence/approvals.json", stableStringify(input.approvals));
  zip.file("evidence/audit-timeline.json", stableStringify(input.timeline));
  zip.file("meta/scope.json", stableStringify(input.scope));
  zip.file("views/entries.csv", toEntriesCsv(input.entries));
  zip.file("views/approvals.csv", toApprovalsCsv(input.approvals));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/domain/__tests__/bundle-assembler.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/audit-pack/domain/bundle-assembler.ts apps/webapp/src/lib/audit-pack/domain/__tests__/bundle-assembler.test.ts
git commit -m "feat(audit-pack): add deterministic zip assembler with json and csv outputs"
```

---

### Task 5: Implement audit-pack orchestrator and hardening handoff

**Files:**
- Create: `apps/webapp/src/lib/audit-pack/application/audit-pack-orchestrator.ts`
- Create: `apps/webapp/src/lib/audit-pack/application/__tests__/audit-pack-orchestrator.test.ts`
- Create: `apps/webapp/src/lib/audit-pack/index.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { AuditPackOrchestrator } from "../audit-pack-orchestrator";

describe("AuditPackOrchestrator", () => {
  it("updates request status through all stages before completion", async () => {
    const updateStatus = vi.fn();
    const orchestrator = new AuditPackOrchestrator({ updateStatus /* plus mocked deps */ } as never);
    await orchestrator.generate({ requestId: "req-1", organizationId: "org-1" });
    expect(updateStatus).toHaveBeenCalledWith("req-1", "collecting");
    expect(updateStatus).toHaveBeenCalledWith("req-1", "lineage_expanding");
    expect(updateStatus).toHaveBeenCalledWith("req-1", "assembling");
    expect(updateStatus).toHaveBeenCalledWith("req-1", "hardening");
    expect(updateStatus).toHaveBeenCalledWith("req-1", "completed");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/application/__tests__/audit-pack-orchestrator.test.ts`
Expected: FAIL due to missing orchestrator.

**Step 3: Write minimal implementation**

Implement orchestrator flow:

1. Load request and validate date range.
2. Collect in-range base entities.
3. Expand full lineage closure.
4. Build evidence payloads.
5. Assemble zip.
6. Call existing `auditExportOrchestrator.hardenExport(...)` with `exportType: "data"` and generated zip buffer.
7. Persist `auditPackArtifact` with counts and hardened package linkage.
8. Finalize status.

Use explicit failure handling:

```typescript
catch (error) {
  await this.failRequest(requestId, "hardening_failed", toMessage(error));
  throw error;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/application/__tests__/audit-pack-orchestrator.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/audit-pack/application/audit-pack-orchestrator.ts apps/webapp/src/lib/audit-pack/application/__tests__/audit-pack-orchestrator.test.ts apps/webapp/src/lib/audit-pack/index.ts
git commit -m "feat(audit-pack): add orchestrator with hardening handoff"
```

---

### Task 6: Wire queue job type and worker processing

**Files:**
- Modify: `apps/webapp/src/lib/queue/index.ts`
- Modify: `apps/webapp/src/worker.ts`
- Create: `apps/webapp/src/lib/audit-pack/application/audit-pack-processor.ts`
- Create: `apps/webapp/src/lib/audit-pack/application/audit-pack-service.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { addAuditPackJob } from "@/lib/audit-pack/application/audit-pack-service";

describe("addAuditPackJob", () => {
  it("enqueues audit-pack jobs with organization context", async () => {
    const job = await addAuditPackJob({ requestId: "req-1", organizationId: "org-1" });
    expect(job.data.type).toBe("audit-pack");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/application/audit-pack-service.test.ts`
Expected: FAIL because job type and service are missing.

**Step 3: Write minimal implementation**

- Extend `JobType` union with `"audit-pack"`.
- Add `AuditPackJobData` and `addJob("process-audit-pack", ...)` helper.
- Add worker switch branch:

```typescript
case "audit-pack": {
  const { processAuditPack } = await import("@/lib/audit-pack/application/audit-pack-processor");
  await processAuditPack(job.data);
  return { success: true, message: "Audit pack processed" };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/application/audit-pack-service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/queue/index.ts apps/webapp/src/worker.ts apps/webapp/src/lib/audit-pack/application/audit-pack-processor.ts apps/webapp/src/lib/audit-pack/application/audit-pack-service.ts apps/webapp/src/lib/audit-pack/application/audit-pack-service.test.ts
git commit -m "feat(audit-pack): enqueue and process async audit-pack jobs"
```

---

### Task 7: Add server actions for create/list/download with RBAC and audit logging

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/audit-export/actions.ts`
- Modify: `apps/webapp/src/lib/audit-logger.ts`
- Create: `apps/webapp/src/lib/audit-pack/application/request-repository.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { createAuditPackAction } from "@/app/[locale]/(app)/settings/audit-export/actions";

describe("createAuditPackAction", () => {
  it("rejects invalid ranges where start > end", async () => {
    const result = await createAuditPackAction({
      organizationId: "org-1",
      startDateIso: "2026-02-20",
      endDateIso: "2026-02-19",
    });
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/settings/audit-export/actions.audit-pack.test.ts`
Expected: FAIL due to missing action.

**Step 3: Write minimal implementation**

Add actions:

- `createAuditPackAction({ organizationId, startDateIso, endDateIso })`
- `getAuditPackRequestsAction(organizationId, limit?)`
- `getAuditPackDownloadUrlAction(requestId, organizationId)`

Validation and date handling with Luxon:

```typescript
const start = DateTime.fromISO(input.startDateIso, { zone: "utc" }).startOf("day");
const end = DateTime.fromISO(input.endDateIso, { zone: "utc" }).endOf("day");
if (!start.isValid || !end.isValid || start > end) {
  return yield* _(Effect.fail(new ValidationError({ message: "Invalid audit pack date range" })));
}
```

Add `AuditAction` members for create/retry/download and call `logAudit(...)` for each action.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/settings/audit-export/actions.audit-pack.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/audit-export/actions.ts apps/webapp/src/lib/audit-logger.ts apps/webapp/src/lib/audit-pack/application/request-repository.ts apps/webapp/src/app/[locale]/(app)/settings/audit-export/actions.audit-pack.test.ts
git commit -m "feat(audit-pack): add admin actions with validation permissions and audit events"
```

---

### Task 8: Build Admin UI card with TanStack Form and async job status

**Files:**
- Create: `apps/webapp/src/components/settings/audit-export/audit-pack-generator-card.tsx`
- Modify: `apps/webapp/src/components/settings/audit-export/index.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/audit-export/page.tsx`
- Modify: `apps/webapp/src/components/settings/audit-export/audit-packages-table.tsx`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuditPackGeneratorCard } from "../audit-pack-generator-card";

describe("AuditPackGeneratorCard", () => {
  it("renders start and end date fields", () => {
    render(<AuditPackGeneratorCard organizationId="org-1" />);
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    expect(screen.getByLabelText("End date")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/components/settings/audit-export/audit-pack-generator-card.test.tsx`
Expected: FAIL because component does not exist.

**Step 3: Write minimal implementation**

Use `@tanstack/react-form` and existing `useJobStatus`:

```tsx
const form = useForm({
  defaultValues: { startDate: "", endDate: "" },
  onSubmit: async ({ value }) => {
    const result = await createAuditPackAction({
      organizationId,
      startDateIso: value.startDate,
      endDateIso: value.endDate,
    });
    if (result.success) setJobId(result.data.jobId);
  },
});
```

Render a status list/table for recent requests (`requested`, `collecting`, `lineage_expanding`, `assembling`, `hardening`, `completed`, `failed`) and provide Download button when completed.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/components/settings/audit-export/audit-pack-generator-card.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/components/settings/audit-export/audit-pack-generator-card.tsx apps/webapp/src/components/settings/audit-export/index.ts apps/webapp/src/app/[locale]/(app)/settings/audit-export/page.tsx apps/webapp/src/components/settings/audit-export/audit-packages-table.tsx apps/webapp/src/components/settings/audit-export/audit-pack-generator-card.test.tsx
git commit -m "feat(audit-pack): add one-click generator ui with async status"
```

---

### Task 9: Add verification checks and run full regression

**Files:**
- Modify: `apps/webapp/src/lib/audit-export/application/verification-service.ts`
- Create: `apps/webapp/src/lib/audit-pack/application/__tests__/audit-pack-verification.test.ts`
- Modify: `apps/webapp/src/lib/audit-export/domain/models.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { verifyAuditPackCoverage } from "@/lib/audit-pack/application/verify-audit-pack-coverage";

describe("verifyAuditPackCoverage", () => {
  it("fails when lineage is not closed", () => {
    const result = verifyAuditPackCoverage({ nodeIds: ["b"], requiredLinkedIds: ["a", "b"] });
    expect(result.isValid).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/audit-pack/application/__tests__/audit-pack-verification.test.ts`
Expected: FAIL with missing helper.

**Step 3: Write minimal implementation**

Add pack-specific verification checks (coverage + deterministic ordering metadata) and surface them in existing verification response.

```typescript
checks.push({
  name: "Lineage closure",
  passed: missingLinkedIds.length === 0,
  details: missingLinkedIds.length === 0 ? "All linked nodes included" : `Missing: ${missingLinkedIds.join(", ")}`,
});
```

**Step 4: Run full test suite for changed scope**

Run: `pnpm --filter webapp test -- src/lib/audit-pack src/lib/audit-export src/components/settings/audit-export`
Expected: PASS.

**Step 5: Run build check**

Run: `pnpm --filter webapp build`
Expected: PASS.

**Step 6: Commit**

```bash
git add apps/webapp/src/lib/audit-export/application/verification-service.ts apps/webapp/src/lib/audit-pack/application/__tests__/audit-pack-verification.test.ts apps/webapp/src/lib/audit-export/domain/models.ts apps/webapp/src/lib/audit-pack/application/verify-audit-pack-coverage.ts
git commit -m "feat(audit-pack): add pack-specific verification checks"
```

---

### Task 10: Database migration and deployment checklist

**Files:**
- Create (generated): `apps/webapp/drizzle/0006_audit_pack_generator.sql`
- Modify (generated): `apps/webapp/drizzle/meta/_journal.json`
- Modify (generated): `apps/webapp/drizzle/meta/0006_snapshot.json`

**Step 1: Generate migration SQL from schema changes**

Run: `pnpm --filter webapp drizzle-kit generate`
Expected: new migration SQL + meta snapshot files created.

**Step 2: Apply migration in target environment**

Run: `pnpm drizzle-kit push`
Expected: new tables/enums created successfully.

**Step 3: Smoke test worker path manually**

Run: `pnpm dev` (webapp) and trigger one audit pack from settings.
Expected: request transitions to `completed` and download URL works.

**Step 4: Commit generated migration artifacts**

```bash
git add apps/webapp/drizzle/0006_audit_pack_generator.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/drizzle/meta/0006_snapshot.json
git commit -m "chore(db): add audit pack generator migration"
```

---

## Quality Gates

- Run `@vercel-react-best-practices` review for client/server boundaries and rendering costs.
- Run `@web-design-guidelines` review for accessibility and error-state UX in the new card.
- Run `@vercel-composition-patterns` review to keep audit settings components composable and avoid prop bloat.

## Notes for the Implementer

- Keep all queries strictly org-scoped (`organizationId`) and fail closed on cross-org linkage.
- Use Luxon `DateTime` for date parsing/normalization in request validation and timeline normalization.
- Keep CSV escaping consistent with existing export sanitization rules to prevent CSV injection.
- Do not add per-entry detached signatures in V1 (YAGNI).
