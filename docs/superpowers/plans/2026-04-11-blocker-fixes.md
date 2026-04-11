# Blocker Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the three merge blockers by replacing callback token handoff with a one-time code exchange, enforcing active-organization employee scoping, and completing the canonical backfill cutover so canonical-only reads are safe.

**Architecture:** Add a small app-auth-code persistence/service layer that issues single-use short-lived codes and an exchange endpoint for app clients. Tighten employee lookup helpers to fail closed for the active organization. Extend the canonical migration helper into an executable backfill and reconciliation path, then make canonical readers surface an explicit operational error when the cutover state is missing.

**Tech Stack:** Next.js route handlers, Drizzle ORM/Postgres, Vitest, Luxon, pnpm.

---

### Task 1: Add Single-Use App Auth Code Persistence and Service

**Files:**
- Create: `apps/webapp/src/db/schema/app-auth.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/index.ts`
- Create: `apps/webapp/src/lib/auth/app-auth-code.ts`
- Create: `apps/webapp/src/lib/auth/app-auth-code.test.ts`
- Create: `apps/webapp/drizzle/0003_app_auth_codes.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`

- [ ] **Step 1: Write the failing service tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    insert: vi.fn(() => ({ values: mockState.insertValues })),
    update: vi.fn(() => ({ set: mockState.updateSet })),
    query: {
      appAuthCode: {
        findFirst: mockState.findFirst,
      },
    },
  },
  appAuthCode: {
    id: "id",
  },
}));

import {
  consumeAppAuthCode,
  createAppAuthCode,
} from "./app-auth-code";

describe("app auth code service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a single-use mobile auth code with expiry metadata", async () => {
    mockState.insertValues.mockResolvedValue(undefined);

    const result = await createAppAuthCode({
      app: "mobile",
      sessionToken: "session-token",
      userId: "user-1",
    });

    expect(result.code).toMatch(/^[A-Z0-9]{32}$/);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(mockState.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        app: "mobile",
        sessionToken: "session-token",
        userId: "user-1",
        status: "pending",
      }),
    );
  });

  it("consumes a pending code once and returns its session token", async () => {
    mockState.findFirst.mockResolvedValue({
      id: "code-1",
      app: "mobile",
      sessionToken: "session-token",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
    mockState.updateWhere.mockResolvedValue(undefined);

    await expect(
      consumeAppAuthCode({ app: "mobile", code: "ABCD" }),
    ).resolves.toEqual({ sessionToken: "session-token", status: "success" });

    expect(mockState.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "used" }),
    );
  });

  it("rejects expired or mismatched codes", async () => {
    mockState.findFirst.mockResolvedValue({
      id: "code-2",
      app: "desktop",
      sessionToken: "session-token",
      status: "pending",
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      consumeAppAuthCode({ app: "mobile", code: "EXPIRED" }),
    ).resolves.toEqual({ status: "invalid_code" });
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter webapp test -- src/lib/auth/app-auth-code.test.ts`
Expected: FAIL because `app-auth-code.ts` and `appAuthCode` schema do not exist yet.

- [ ] **Step 3: Add the new schema and migration**

```ts
// apps/webapp/src/db/schema/app-auth.ts
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth-schema";

export const appAuthTypeEnum = pgEnum("app_auth_type", ["mobile", "desktop"]);
export const appAuthCodeStatusEnum = pgEnum("app_auth_code_status", ["pending", "used", "expired"]);

export const appAuthCode = pgTable(
  "app_auth_code",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    app: appAuthTypeEnum("app").notNull(),
    code: text("code").notNull(),
    sessionToken: text("session_token").notNull(),
    status: appAuthCodeStatusEnum("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("appAuthCode_userId_idx").on(table.userId),
    index("appAuthCode_app_status_idx").on(table.app, table.status),
    index("appAuthCode_code_idx").on(table.code),
  ],
);
```

```sql
-- apps/webapp/drizzle/0003_app_auth_codes.sql
CREATE TYPE "app_auth_type" AS ENUM ('mobile', 'desktop');
CREATE TYPE "app_auth_code_status" AS ENUM ('pending', 'used', 'expired');

CREATE TABLE "app_auth_code" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "app" "app_auth_type" NOT NULL,
  "code" text NOT NULL,
  "session_token" text NOT NULL,
  "status" "app_auth_code_status" DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "app_auth_code"
  ADD CONSTRAINT "app_auth_code_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "appAuthCode_userId_idx" ON "app_auth_code" USING btree ("user_id");
CREATE INDEX "appAuthCode_app_status_idx" ON "app_auth_code" USING btree ("app", "status");
CREATE INDEX "appAuthCode_code_idx" ON "app_auth_code" USING btree ("code");
```

- [ ] **Step 4: Implement the service minimally**

```ts
// apps/webapp/src/lib/auth/app-auth-code.ts
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { appAuthCode, db } from "@/db";

const APP_AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export type SupportedApp = "mobile" | "desktop";

export async function createAppAuthCode(input: {
  userId: string;
  sessionToken: string;
  app: SupportedApp;
}) {
  const code = randomBytes(16).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + APP_AUTH_CODE_TTL_MS);

  await db.insert(appAuthCode).values({
    userId: input.userId,
    app: input.app,
    code,
    sessionToken: input.sessionToken,
    status: "pending",
    expiresAt,
  });

  return { code, expiresAt };
}

export async function consumeAppAuthCode(input: { code: string; app: SupportedApp }) {
  const record = await db.query.appAuthCode.findFirst({
    where: and(eq(appAuthCode.code, input.code), eq(appAuthCode.app, input.app)),
  });

  if (!record || record.status !== "pending" || record.expiresAt < new Date()) {
    return { status: "invalid_code" } as const;
  }

  await db
    .update(appAuthCode)
    .set({ status: "used", usedAt: new Date() })
    .where(eq(appAuthCode.id, record.id));

  return { status: "success", sessionToken: record.sessionToken } as const;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/auth/app-auth-code.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/db/schema/app-auth.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/index.ts apps/webapp/src/lib/auth/app-auth-code.ts apps/webapp/src/lib/auth/app-auth-code.test.ts apps/webapp/drizzle/0003_app_auth_codes.sql apps/webapp/drizzle/meta/_journal.json
git commit -m "feat(auth): add app auth code exchange persistence"
```

### Task 2: Switch App Login to Code Exchange and Update Mobile Client Flow

**Files:**
- Modify: `apps/webapp/src/app/api/auth/app-login/route.ts`
- Modify: `apps/webapp/src/app/api/auth/app-login/route.test.ts`
- Create: `apps/webapp/src/app/api/auth/app-exchange/route.ts`
- Create: `apps/webapp/src/app/api/auth/app-exchange/route.test.ts`
- Modify: `apps/mobile/src/lib/auth/app-auth.ts`
- Modify: `apps/mobile/src/lib/auth/app-auth.test.ts`
- Modify: `apps/mobile/src/features/session/use-mobile-session.ts`
- Modify: `apps/mobile/src/features/session/use-mobile-session.test.ts`

- [ ] **Step 1: Write the failing route and client tests**

```ts
// apps/webapp/src/app/api/auth/app-login/route.test.ts
it("redirects authenticated mobile clients with a one-time code instead of a session token", async () => {
  mockState.getSession.mockResolvedValue({
    user: { id: "user-1", canUseMobile: true },
    session: { token: "session-token" },
  });
  mockState.createAppAuthCode.mockResolvedValue({ code: "ONE-TIME-CODE" });

  const response = await GET(
    createRequest("https://app.example.com/api/auth/app-login?redirect=z8mobile://auth/callback"),
  );

  expect(response.headers.get("location")).toBe("z8mobile://auth/callback?code=ONE-TIME-CODE");
});
```

```ts
// apps/webapp/src/app/api/auth/app-exchange/route.test.ts
it("returns the session token when a valid mobile code is exchanged", async () => {
  mockState.consumeAppAuthCode.mockResolvedValue({
    status: "success",
    sessionToken: "session-token",
  });

  const response = await POST(
    new Request("https://app.example.com/api/auth/app-exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Z8-App-Type": "mobile" },
      body: JSON.stringify({ code: "ONE-TIME-CODE" }),
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ token: "session-token" });
});
```

```ts
// apps/mobile/src/features/session/use-mobile-session.test.ts
it("exchanges the callback code before storing the session token", async () => {
  extractAppCallbackResult.mockReturnValue({ error: null, code: "ONE-TIME-CODE", token: null });
  exchangeAppCallbackCode.mockResolvedValue("session-token");

  const queryClient = new QueryClient();
  const controller = createMobileSessionController(queryClient);

  await controller.handleCallbackUrl("z8mobile://auth/callback?code=ONE-TIME-CODE");

  expect(exchangeAppCallbackCode).toHaveBeenCalledWith("ONE-TIME-CODE", "mobile");
  expect(setStoredSessionToken).toHaveBeenCalledWith("session-token");
});
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `pnpm --filter webapp test -- src/app/api/auth/app-login/route.test.ts src/app/api/auth/app-exchange/route.test.ts && pnpm --filter mobile test -- src/lib/auth/app-auth.test.ts src/features/session/use-mobile-session.test.ts`
Expected: FAIL because login still redirects `token`, exchange route does not exist, and the mobile client does not exchange codes.

- [ ] **Step 3: Implement the route changes and exchange helper**

```ts
// apps/webapp/src/app/api/auth/app-login/route.ts
import { createAppAuthCode, type SupportedApp } from "@/lib/auth/app-auth-code";

// ...after access check succeeds
const authCode = await createAppAuthCode({
  app,
  sessionToken: session.session.token,
  userId: session.user.id,
});

callbackUrl.searchParams.set("code", authCode.code);
return NextResponse.redirect(callbackUrl.toString());
```

```ts
// apps/webapp/src/app/api/auth/app-exchange/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeAppAuthCode, type SupportedApp } from "@/lib/auth/app-auth-code";

const bodySchema = z.object({ code: z.string().trim().min(1) });

function resolveAppType(request: Request): SupportedApp | null {
  const appType = request.headers.get("x-z8-app-type")?.toLowerCase();
  return appType === "mobile" || appType === "desktop" ? appType : null;
}

export async function POST(request: Request) {
  const app = resolveAppType(request);
  if (!app) {
    return NextResponse.json({ error: "Supported app type required" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }

  const result = await consumeAppAuthCode({ app, code: parsed.data.code });
  if (result.status !== "success") {
    return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
  }

  return NextResponse.json({ token: result.sessionToken });
}
```

```ts
// apps/mobile/src/lib/auth/app-auth.ts
export interface AppCallbackResult {
  code: string | null;
  token: string | null;
  error: string | null;
}

export async function exchangeAppCallbackCode(code: string, app: "mobile" | "desktop") {
  const response = await fetch(`${getWebappUrl()}/api/auth/app-exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Z8-App-Type": app,
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    throw new Error("Failed to exchange app auth code");
  }

  const payload = (await response.json()) as { token: string };
  return payload.token;
}

export function extractAppCallbackResult(callbackUrl: string): AppCallbackResult {
  const searchParams = new URL(callbackUrl).searchParams;
  return {
    code: searchParams.get("code"),
    error: searchParams.get("error"),
    token: searchParams.get("token"),
  };
}
```

```ts
// apps/mobile/src/features/session/use-mobile-session.ts
const { error, code, token } = extractAppCallbackResult(url);

if (error) {
  return { error, status: "error" } as const;
}

const resolvedToken = code
  ? await exchangeAppCallbackCode(code, "mobile")
  : token;

if (!resolvedToken) {
  return { error: null, status: "ignored" } as const;
}

await setStoredSessionToken(resolvedToken);
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm --filter webapp test -- src/app/api/auth/app-login/route.test.ts src/app/api/auth/app-exchange/route.test.ts && pnpm --filter mobile test -- src/lib/auth/app-auth.test.ts src/features/session/use-mobile-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/api/auth/app-login/route.ts apps/webapp/src/app/api/auth/app-login/route.test.ts apps/webapp/src/app/api/auth/app-exchange/route.ts apps/webapp/src/app/api/auth/app-exchange/route.test.ts apps/mobile/src/lib/auth/app-auth.ts apps/mobile/src/lib/auth/app-auth.test.ts apps/mobile/src/features/session/use-mobile-session.ts apps/mobile/src/features/session/use-mobile-session.test.ts
git commit -m "fix(auth): exchange one-time app login codes"
```

### Task 3: Remove Cross-Organization Employee Fallbacks

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/current-employee.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/auth.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/absences/current-employee.test.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/auth.test.ts`
- Modify: `apps/webapp/src/app/api/organizations/switch/route.ts`
- Modify: `apps/webapp/src/app/api/mobile/session/route.test.ts`

- [ ] **Step 1: Write the failing strict-scoping tests**

```ts
// apps/webapp/src/app/[locale]/(app)/absences/current-employee.test.ts
it("returns null when the active organization has no active employee row", async () => {
  queryState.findFirst
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ id: "employee-in-other-org", organizationId: "org-2" });

  await expect(findCurrentEmployeeByUserId(mockDb, "user-1", "org-1")).resolves.toBeNull();
});
```

```ts
// apps/webapp/src/app/[locale]/(app)/time-tracking/actions/auth.test.ts
it("does not fall back to another org employee when activeOrganizationId is set", async () => {
  dbState.findFirst
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ id: "employee-in-other-org", organizationId: "org-2" });

  await expect(getCurrentEmployee()).resolves.toBeNull();
});
```

```ts
// apps/webapp/src/app/api/mobile/session/route.test.ts
it("keeps hasEmployeeRecord false for memberships without an active employee row", async () => {
  // existing route contract should still surface false rather than impersonating another org
  expect((await response.json()).organizations[1]).toEqual(
    expect.objectContaining({ hasEmployeeRecord: false }),
  );
});
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/absences/current-employee.test.ts src/app/[locale]/(app)/time-tracking/actions/auth.test.ts src/app/api/mobile/session/route.test.ts`
Expected: FAIL because both helpers still fall back to any active employee record.

- [ ] **Step 3: Make the helpers fail closed**

```ts
// apps/webapp/src/app/[locale]/(app)/absences/current-employee.ts
export async function findCurrentEmployeeByUserId(
  queryClient: EmployeeQueryClient,
  userId: string,
  activeOrganizationId?: string | null,
) {
  if (!activeOrganizationId) {
    return null;
  }

  return queryClient.query.employee.findFirst({
    where: and(
      eq(employee.userId, userId),
      eq(employee.organizationId, activeOrganizationId),
      eq(employee.isActive, true),
    ),
  });
}
```

```ts
// apps/webapp/src/app/[locale]/(app)/time-tracking/actions/auth.ts
async function getEmployeeForUser(
  userId: string,
  activeOrganizationId?: string | null,
): Promise<CurrentEmployee | null> {
  if (!activeOrganizationId) {
    return null;
  }

  const employeeForActiveOrg = await db.query.employee.findFirst({
    where: and(
      eq(employee.userId, userId),
      eq(employee.organizationId, activeOrganizationId),
      eq(employee.isActive, true),
    ),
  });

  return employeeForActiveOrg ?? null;
}
```

```ts
// apps/webapp/src/app/api/organizations/switch/route.ts
// Keep this response contract, but do not add any fallback behavior here or downstream.
return NextResponse.json(
  {
    success: true,
    organizationId,
    hasEmployeeRecord: !!employeeRecord,
  },
  { headers: corsHeaders },
);
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/absences/current-employee.test.ts src/app/[locale]/(app)/time-tracking/actions/auth.test.ts src/app/api/mobile/session/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/absences/current-employee.ts apps/webapp/src/app/[locale]/(app)/absences/current-employee.test.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/auth.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/auth.test.ts apps/webapp/src/app/api/organizations/switch/route.ts apps/webapp/src/app/api/mobile/session/route.test.ts
git commit -m "fix(auth): enforce active organization employee scope"
```

### Task 4: Turn Canonical Backfill into an Executable and Reconciled Cutover Path

**Files:**
- Modify: `apps/webapp/src/lib/time-record/migration/backfill.ts`
- Create: `apps/webapp/src/lib/time-record/migration/reconciliation.ts`
- Create: `apps/webapp/src/lib/time-record/migration/__tests__/reconciliation.test.ts`
- Modify: `apps/webapp/src/lib/time-record/migration/__tests__/backfill.test.ts`

- [ ] **Step 1: Write the failing backfill execution and reconciliation tests**

```ts
// apps/webapp/src/lib/time-record/migration/__tests__/reconciliation.test.ts
import { describe, expect, it, vi } from "vitest";
import { reconcileLegacyToCanonical } from "@/lib/time-record/migration/reconciliation";

const mockState = vi.hoisted(() => ({
  legacyWorkCount: vi.fn(),
  legacyAbsenceCount: vi.fn(),
  canonicalWorkCount: vi.fn(),
  canonicalAbsenceCount: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      workPeriod: { findMany: mockState.legacyWorkCount },
      absenceEntry: { findMany: mockState.legacyAbsenceCount },
      timeRecord: { findMany: mockState.canonicalWorkCount },
    },
  },
}));

it("reports zero mismatches when legacy and canonical counts match", async () => {
  mockState.legacyWorkCount.mockResolvedValue([{ id: "work-1" }]);
  mockState.legacyAbsenceCount.mockResolvedValue([{ id: "absence-1" }]);
  mockState.canonicalWorkCount
    .mockResolvedValueOnce([{ id: "work-1", recordKind: "work" }])
    .mockResolvedValueOnce([{ id: "absence-1", recordKind: "absence" }]);

  await expect(reconcileLegacyToCanonical("org-1")).resolves.toEqual({
    workCountMismatch: 0,
    absenceCountMismatch: 0,
    missingAbsenceOrganizationIds: 0,
  });
});
```

```ts
// apps/webapp/src/lib/time-record/migration/__tests__/backfill.test.ts
it("builds updates that populate absence_entry.organization_id linkage during cutover", () => {
  const payload = buildCanonicalBackfillPayload({
    organizationId: "org-1",
    actorId: "actor-1",
    legacy: {
      workPeriods: [],
      absenceEntries: [
        {
          id: "absence-1",
          organizationId: "org-1",
          employeeId: "employee-1",
          categoryId: "category-1",
          startDate: "2026-01-15",
          startPeriod: "full_day",
          endDate: "2026-01-15",
          endPeriod: "full_day",
          status: "approved",
          createdAt: new Date("2026-01-10T00:00:00.000Z"),
          updatedAt: new Date("2026-01-10T00:00:00.000Z"),
        },
      ],
      approvalRequests: [],
      absenceCategories: [{ id: "category-1", countsAgainstVacation: true }],
    },
  });

  expect(payload.legacyLinks.absenceEntry).toEqual([
    { id: "absence-1", canonicalRecordId: "absence-1", organizationId: "org-1" },
  ]);
});
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `pnpm --filter webapp test -- src/lib/time-record/migration/__tests__/backfill.test.ts src/lib/time-record/migration/__tests__/reconciliation.test.ts`
Expected: FAIL because reconciliation does not exist and backfill does not include organization update/link output.

- [ ] **Step 3: Extend backfill output and add reconciliation**

```ts
// apps/webapp/src/lib/time-record/migration/backfill.ts
legacyLinks: {
  workPeriod: Array<{ id: string; canonicalRecordId: string }>;
  absenceEntry: Array<{ id: string; canonicalRecordId: string; organizationId: string }>;
  approvalRequest: Array<{ id: string; canonicalRecordId: string }>;
};

absenceEntry: absences.map((absenceEntry) => ({
  id: absenceEntry.id,
  canonicalRecordId: absenceEntry.id,
  organizationId: input.organizationId,
})),
```

```ts
// apps/webapp/src/lib/time-record/migration/reconciliation.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { absenceEntry, timeRecord, workPeriod } from "@/db/schema";

export async function reconcileLegacyToCanonical(organizationId: string) {
  const [legacyWork, legacyAbsence, canonicalWork, canonicalAbsence, missingOrgAbsences] = await Promise.all([
    db.query.workPeriod.findMany({ where: eq(workPeriod.organizationId, organizationId), columns: { id: true } }),
    db.query.absenceEntry.findMany({ where: eq(absenceEntry.organizationId, organizationId), columns: { id: true } }),
    db.query.timeRecord.findMany({ where: and(eq(timeRecord.organizationId, organizationId), eq(timeRecord.recordKind, "work")), columns: { id: true } }),
    db.query.timeRecord.findMany({ where: and(eq(timeRecord.organizationId, organizationId), eq(timeRecord.recordKind, "absence")), columns: { id: true } }),
    db.query.absenceEntry.findMany({ where: eq(absenceEntry.organizationId, organizationId), columns: { id: true, canonicalRecordId: true } }),
  ]);

  return {
    workCountMismatch: Math.abs(legacyWork.length - canonicalWork.length),
    absenceCountMismatch: Math.abs(legacyAbsence.length - canonicalAbsence.length),
    missingAbsenceOrganizationIds: missingOrgAbsences.filter((row) => !row.canonicalRecordId).length,
  };
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm --filter webapp test -- src/lib/time-record/migration/__tests__/backfill.test.ts src/lib/time-record/migration/__tests__/reconciliation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/time-record/migration/backfill.ts apps/webapp/src/lib/time-record/migration/reconciliation.ts apps/webapp/src/lib/time-record/migration/__tests__/backfill.test.ts apps/webapp/src/lib/time-record/migration/__tests__/reconciliation.test.ts
git commit -m "fix(cutover): add executable canonical reconciliation path"
```

### Task 5: Gate Canonical Readers on Verified Cutover State

**Files:**
- Modify: `apps/webapp/src/lib/payroll-export/data-fetcher.ts`
- Create: `apps/webapp/src/lib/time-record/migration/cutover-state.ts`
- Create: `apps/webapp/src/lib/time-record/migration/cutover-state.test.ts`
- Modify: `apps/webapp/src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts`

- [ ] **Step 1: Write the failing cutover-state and reader tests**

```ts
// apps/webapp/src/lib/time-record/migration/cutover-state.test.ts
import { describe, expect, it, vi } from "vitest";
import { assertCanonicalCutoverReady } from "@/lib/time-record/migration/cutover-state";

const reconcileLegacyToCanonical = vi.fn();

vi.mock("@/lib/time-record/migration/reconciliation", () => ({
  reconcileLegacyToCanonical,
}));

it("throws when canonical cutover still has mismatches", async () => {
  reconcileLegacyToCanonical.mockResolvedValue({
    workCountMismatch: 1,
    absenceCountMismatch: 0,
    missingAbsenceOrganizationIds: 0,
  });

  await expect(assertCanonicalCutoverReady("org-1")).rejects.toThrow(
    "Canonical time-record backfill is incomplete for organization org-1",
  );
});
```

```ts
// apps/webapp/src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts
it("rejects payroll export reads when canonical cutover is incomplete", async () => {
  mockAssertCanonicalCutoverReady.mockRejectedValue(
    new Error("Canonical time-record backfill is incomplete for organization org-1"),
  );

  await expect(
    dataFetcher.fetchWorkPeriodsForExport("org-1", {
      dateRange: {
        start: DateTime.fromISO("2026-01-01T00:00:00.000Z"),
        end: DateTime.fromISO("2026-01-31T23:59:59.999Z"),
      },
    }),
  ).rejects.toThrow("Canonical time-record backfill is incomplete for organization org-1");
});
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `pnpm --filter webapp test -- src/lib/time-record/migration/cutover-state.test.ts src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts`
Expected: FAIL because there is no cutover-state guard and payroll export does not assert readiness.

- [ ] **Step 3: Add the guard and call it from canonical readers**

```ts
// apps/webapp/src/lib/time-record/migration/cutover-state.ts
import { reconcileLegacyToCanonical } from "./reconciliation";

export async function assertCanonicalCutoverReady(organizationId: string) {
  const result = await reconcileLegacyToCanonical(organizationId);

  if (
    result.workCountMismatch > 0 ||
    result.absenceCountMismatch > 0 ||
    result.missingAbsenceOrganizationIds > 0
  ) {
    throw new Error(`Canonical time-record backfill is incomplete for organization ${organizationId}`);
  }
}
```

```ts
// apps/webapp/src/lib/payroll-export/data-fetcher.ts
import { assertCanonicalCutoverReady } from "@/lib/time-record/migration/cutover-state";

export async function fetchWorkPeriodsForExport(organizationId: string, filters: PayrollExportFilters) {
  await assertCanonicalCutoverReady(organizationId);
  // existing canonical query follows
}

export async function fetchAbsencesForExport(organizationId: string, filters: PayrollExportFilters) {
  await assertCanonicalCutoverReady(organizationId);
  // existing canonical query follows
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm --filter webapp test -- src/lib/time-record/migration/cutover-state.test.ts src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts`
Expected: PASS.

- [ ] **Step 5: Run broader verification**

Run: `pnpm --filter webapp test -- src/app/api/auth/app-login/route.test.ts src/app/api/auth/app-exchange/route.test.ts src/lib/auth/app-auth-code.test.ts src/app/[locale]/(app)/absences/current-employee.test.ts src/app/[locale]/(app)/time-tracking/actions/auth.test.ts src/lib/time-record/migration/__tests__/backfill.test.ts src/lib/time-record/migration/__tests__/reconciliation.test.ts src/lib/time-record/migration/cutover-state.test.ts src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full verification**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/lib/payroll-export/data-fetcher.ts apps/webapp/src/lib/time-record/migration/cutover-state.ts apps/webapp/src/lib/time-record/migration/cutover-state.test.ts apps/webapp/src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts
git commit -m "fix(cutover): gate canonical readers on reconciliation"
```
