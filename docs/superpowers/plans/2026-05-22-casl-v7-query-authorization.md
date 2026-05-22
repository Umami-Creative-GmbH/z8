# CASL v7 Query Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CASL v7-backed Drizzle authorization filter foundation and migrate the first duplicated workforce authorization paths to it.

**Architecture:** Keep existing string-subject permission checks working while adding typed object subjects for database-backed checks. Add a small, explicit CASL-to-Drizzle adapter that converts v7 priority-preserving rule conditions into Drizzle predicates for known tables only. Migrate reports/employee access first, then time-entry reads, then absence and approval query paths.

**Tech Stack:** Next.js, TypeScript, CASL v7 `@casl/ability`, Drizzle ORM, PostgreSQL, Vitest, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/lib/authorization/types.ts`
  - Add condition-aware subject object types and a subject-name union for database-backed subjects.
- Modify: `apps/webapp/src/lib/authorization/ability.ts`
  - Import CASL `subject` helper and emit conditional object rules alongside current string-subject rules.
- Modify: `apps/webapp/src/lib/authorization/index.ts`
  - Export new subject helper types and query adapter APIs.
- Create: `apps/webapp/src/lib/authorization/subjects.ts`
  - Provide tiny wrappers around CASL `subject(...)` for `Employee`, `TimeEntry`, `Absence`, and `Approval` object checks.
- Create: `apps/webapp/src/lib/authorization/query/types.ts`
  - Define adapter input, supported condition shapes, field maps, and fail-closed result types.
- Create: `apps/webapp/src/lib/authorization/query/drizzle-adapter.ts`
  - Convert CASL rules to Drizzle predicates using CASL v7 priority-preserving helpers.
- Create: `apps/webapp/src/lib/authorization/query/index.ts`
  - Public exports for query authorization helpers.
- Create: `apps/webapp/src/lib/authorization/query/__tests__/drizzle-adapter.test.ts`
  - Unit tests for equality, `$in`, `and`, `or`, `not`, unsupported operators, and CASL v7 priority behavior.
- Modify: `apps/webapp/src/lib/authorization/__tests__/ability.test.ts`
  - Add object-subject runtime tests for self, manager, admin, team, and cross-org denial.
- Modify: `apps/webapp/src/lib/reports/permissions.ts`
  - Replace duplicated employee accessibility branching with a CASL-derived employee filter.
- Modify: `apps/webapp/src/lib/reports/permissions.test.ts`
  - Replace source-text assertions with behavior tests for accessible employee filtering helpers where possible.
- Modify: `apps/webapp/src/app/api/time-entries/route.ts`
  - Use the adapter for read authorization when selecting another employee's entries.
- Modify: `apps/webapp/src/lib/absences/permissions.ts`
  - Move `canApproveAbsence` toward object-subject CASL checks while preserving existing database lookup behavior.
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.ts`
  - Keep existing eligibility behavior while adding CASL-derived approval query filtering where table fields are sufficient.

## Task 1: Add Typed Object Subjects And Runtime Ability Tests

**Files:**
- Modify: `apps/webapp/src/lib/authorization/types.ts`
- Create: `apps/webapp/src/lib/authorization/subjects.ts`
- Modify: `apps/webapp/src/lib/authorization/index.ts`
- Modify: `apps/webapp/src/lib/authorization/__tests__/ability.test.ts`

- [ ] **Step 1: Write failing object-subject ability tests**

Add this import beside the existing imports at the top of `apps/webapp/src/lib/authorization/__tests__/ability.test.ts`:

```ts
import { asAppSubject } from "../subjects";
```

Append this block to the end of the same test file:

```ts

describe("Object Subject Conditions", () => {
	const selfEmployee = {
		id: EMPLOYEE_1,
		employeeId: EMPLOYEE_1,
		organizationId: ORG_1,
		teamId: TEAM_1,
	};

	const managedEmployee = {
		id: EMPLOYEE_2,
		employeeId: EMPLOYEE_2,
		organizationId: ORG_1,
		teamId: TEAM_1,
	};

	const otherOrgEmployee = {
		id: "emp-other-org",
		employeeId: "emp-other-org",
		organizationId: ORG_2,
		teamId: TEAM_1,
	};

	it("allows employees to read and update their own employee record only in their organization", () => {
		const ability = defineAbilityFor(
			createPrincipal({
				employee: {
					id: EMPLOYEE_1,
					organizationId: ORG_1,
					role: "employee",
					teamId: TEAM_1,
				},
			}),
		);

		expect(ability.can("read", asAppSubject("Employee", selfEmployee))).toBe(true);
		expect(ability.can("update", asAppSubject("Employee", selfEmployee))).toBe(true);
		expect(ability.can("read", asAppSubject("Employee", managedEmployee))).toBe(false);
		expect(ability.can("read", asAppSubject("Employee", otherOrgEmployee))).toBe(false);
	});

	it("allows managers to read managed employees in their organization", () => {
		const ability = defineAbilityFor(
			createPrincipal({
				employee: {
					id: EMPLOYEE_1,
					organizationId: ORG_1,
					role: "manager",
					teamId: TEAM_1,
				},
				managedEmployeeIds: [EMPLOYEE_2],
			}),
		);

		expect(ability.can("read", asAppSubject("Employee", selfEmployee))).toBe(true);
		expect(ability.can("read", asAppSubject("Employee", managedEmployee))).toBe(true);
		expect(ability.can("read", asAppSubject("Employee", otherOrgEmployee))).toBe(false);
	});

	it("allows workforce admins to manage workforce records in their organization only", () => {
		const ability = defineAbilityFor(
			createPrincipal({
				employee: {
					id: EMPLOYEE_1,
					organizationId: ORG_1,
					role: "admin",
					teamId: TEAM_1,
				},
			}),
		);

		expect(ability.can("manage", asAppSubject("Employee", selfEmployee))).toBe(true);
		expect(ability.can("manage", asAppSubject("Employee", managedEmployee))).toBe(true);
		expect(ability.can("manage", asAppSubject("Employee", otherOrgEmployee))).toBe(false);
	});

});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test apps/webapp/src/lib/authorization/__tests__/ability.test.ts`

Expected: FAIL with a TypeScript or module error for missing `../subjects` or missing object-subject rule behavior.

- [ ] **Step 3: Add subject object types**

In `apps/webapp/src/lib/authorization/types.ts`, add these exports after `SubjectTypeMap`:

```ts
export type DatabaseSubjectName = "Employee" | "TimeEntry" | "Absence" | "Approval";

export interface EmployeeAuthorizationSubject extends EmployeeScopedSubject {
	id: string;
	teamId?: string | null;
}

export interface TimeEntryAuthorizationSubject extends EmployeeScopedSubject {
	teamId?: string | null;
	private?: boolean;
}

export interface AbsenceAuthorizationSubject extends EmployeeScopedSubject {
	teamId?: string | null;
	status?: "pending" | "approved" | "rejected";
}

export interface ApprovalAuthorizationSubject extends OrgScopedSubject {
	requestedBy: string;
	approverId: string;
	status?: "pending" | "approved" | "rejected";
}

export type AppSubjectRecord =
	| EmployeeAuthorizationSubject
	| TimeEntryAuthorizationSubject
	| AbsenceAuthorizationSubject
	| ApprovalAuthorizationSubject;
```

- [ ] **Step 4: Add subject helper wrapper**

Create `apps/webapp/src/lib/authorization/subjects.ts`:

```ts
import { subject } from "@casl/ability";
import type { DatabaseSubjectName, AppSubjectRecord } from "./types";

export function asAppSubject<T extends AppSubjectRecord>(
	subjectName: DatabaseSubjectName,
	record: T,
) {
	return subject(subjectName, record);
}
```

- [ ] **Step 5: Emit conditional object rules in the ability builder**

Modify `apps/webapp/src/lib/authorization/ability.ts` so existing string checks remain, and add conditional rules inside `if (principal.employee && principal.activeOrganizationId) { ... }`.

Update imports and `AppAbility` so object subjects produced by CASL `subject(...)` type-check:

```ts
import {
	AbilityBuilder,
	createMongoAbility,
	type ForcedSubject,
	type MongoAbility,
} from "@casl/ability";

export type AppAbility = MongoAbility<[Action, Subject | ForcedSubject<Exclude<Subject, "all">>]>;
```

Use this pattern in the existing employee role branches:

```ts
const orgCondition = { organizationId: principal.activeOrganizationId };
const selfCondition = {
	organizationId: principal.activeOrganizationId,
	employeeId: principal.employee.id,
};
const directReportCondition = {
	organizationId: principal.activeOrganizationId,
	employeeId: { $in: principal.managedEmployeeIds },
};

if (empRole === "admin") {
	can("manage", "Employee", orgCondition);
	can("manage", "TimeEntry", orgCondition);
	can("manage", "Absence", orgCondition);
	can("manage", "Approval", orgCondition);
}

if (empRole === "manager") {
	can(["read", "update"], "Employee", selfCondition);
	can("read", "Employee", directReportCondition);
	can("read", "TimeEntry", selfCondition);
	can("read", "TimeEntry", directReportCondition);
	can(["read", "create"], "Absence", selfCondition);
	can(["read", "approve", "reject"], "Absence", directReportCondition);
	can(["read", "approve", "reject"], "Approval", {
		organizationId: principal.activeOrganizationId,
		requestedBy: { $in: principal.managedEmployeeIds },
	});
}

if (empRole === "employee") {
	can(["read", "update"], "Employee", selfCondition);
	can("read", "TimeEntry", selfCondition);
	can(["read", "create"], "Absence", selfCondition);
}
```

- [ ] **Step 6: Export subject helpers**

Modify `apps/webapp/src/lib/authorization/index.ts`:

```ts
export { asAppSubject } from "./subjects";
export type {
	DatabaseSubjectName,
	AppSubjectRecord,
	EmployeeAuthorizationSubject,
	TimeEntryAuthorizationSubject,
	AbsenceAuthorizationSubject,
	ApprovalAuthorizationSubject,
} from "./types";
```

- [ ] **Step 7: Run ability tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/authorization/__tests__/ability.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/webapp/src/lib/authorization/types.ts apps/webapp/src/lib/authorization/subjects.ts apps/webapp/src/lib/authorization/index.ts apps/webapp/src/lib/authorization/ability.ts apps/webapp/src/lib/authorization/__tests__/ability.test.ts
git commit -m "feat: add condition-aware casl subjects"
```

## Task 2: Add CASL-To-Drizzle Query Adapter

**Files:**
- Create: `apps/webapp/src/lib/authorization/query/types.ts`
- Create: `apps/webapp/src/lib/authorization/query/drizzle-adapter.ts`
- Create: `apps/webapp/src/lib/authorization/query/index.ts`
- Create: `apps/webapp/src/lib/authorization/query/__tests__/drizzle-adapter.test.ts`
- Modify: `apps/webapp/src/lib/authorization/index.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `apps/webapp/src/lib/authorization/query/__tests__/drizzle-adapter.test.ts`:

```ts
import { AbilityBuilder, createMongoAbility, type MongoAbility } from "@casl/ability";
import { describe, expect, it } from "vitest";
import { employee } from "@/db/schema";
import { accessibleByDrizzle } from "../drizzle-adapter";

type TestAbility = MongoAbility<[
	"read" | "manage",
	"Employee" | "Example" | "all"
]>;

describe("accessibleByDrizzle", () => {
	it("returns null when no allow rule exists", () => {
		const ability = createMongoAbility<[
			"read" | "manage",
			"Employee" | "all"
		]>([]);

		expect(
			accessibleByDrizzle(ability, "read", "Employee", {
				organizationId: employee.organizationId,
				id: employee.id,
			}),
		).toBeNull();
	});

	it("returns a predicate for equality and $in conditions", () => {
		const { can, build } = new AbilityBuilder<TestAbility>(createMongoAbility);
		can("read", "Employee", {
			organizationId: "org-1",
			id: { $in: ["emp-1", "emp-2"] },
		});

		const predicate = accessibleByDrizzle(build(), "read", "Employee", {
			organizationId: employee.organizationId,
			id: employee.id,
		});

		expect(predicate).not.toBeNull();
	});

	it("fails closed for unsupported fields", () => {
		const { can, build } = new AbilityBuilder<TestAbility>(createMongoAbility);
		can("read", "Employee", { unsupportedField: "x" });

		expect(() =>
			accessibleByDrizzle(build(), "read", "Employee", {
				organizationId: employee.organizationId,
				id: employee.id,
			}),
		).toThrow(/Unsupported CASL condition field/);
	});

	it("preserves CASL v7 cannot priority for narrower allow rules", () => {
		const { can, cannot, build } = new AbilityBuilder<TestAbility>(createMongoAbility);
		can("read", "Employee", { organizationId: "org-1" });
		cannot("read", "Employee", { organizationId: "org-1", private: true });
		can("read", "Employee", { organizationId: "org-1", id: "emp-1" });

		const predicate = accessibleByDrizzle(build(), "read", "Employee", {
			organizationId: employee.organizationId,
			id: employee.id,
			private: employee.isActive,
		});

		expect(predicate).not.toBeNull();
	});
});
```

- [ ] **Step 2: Run adapter test to verify it fails**

Run: `pnpm --filter webapp test apps/webapp/src/lib/authorization/query/__tests__/drizzle-adapter.test.ts`

Expected: FAIL with missing module `../drizzle-adapter`.

- [ ] **Step 3: Add adapter types**

Create `apps/webapp/src/lib/authorization/query/types.ts`:

```ts
import type { AnyColumn, SQL } from "drizzle-orm";

export type DrizzleFieldMap = Record<string, AnyColumn>;

export type AccessiblePredicate = SQL<unknown> | null;

export class UnsupportedAuthorizationConditionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsupportedAuthorizationConditionError";
	}
}
```

- [ ] **Step 4: Implement minimal adapter**

Create `apps/webapp/src/lib/authorization/query/drizzle-adapter.ts`:

```ts
import { rulesToCondition } from "@casl/ability/extra";
import type { AnyAbility } from "@casl/ability";
import { and, eq, inArray, not, or, type AnyColumn, type SQL } from "drizzle-orm";
import { UnsupportedAuthorizationConditionError, type DrizzleFieldMap } from "./types";

type PlainCondition = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainCondition {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function convertLeafCondition(condition: PlainCondition, fields: DrizzleFieldMap): SQL<unknown> {
	const predicates: SQL<unknown>[] = [];

	for (const [fieldName, rawValue] of Object.entries(condition)) {
		const column = fields[fieldName];
		if (!column) {
			throw new UnsupportedAuthorizationConditionError(
				`Unsupported CASL condition field: ${fieldName}`,
			);
		}

		if (isPlainObject(rawValue)) {
			if ("$in" in rawValue) {
				const values = rawValue.$in;
				if (!Array.isArray(values)) {
					throw new UnsupportedAuthorizationConditionError(
						`$in condition for ${fieldName} must be an array`,
					);
				}
				predicates.push(inArray(column as AnyColumn, values));
				continue;
			}

			throw new UnsupportedAuthorizationConditionError(
				`Unsupported CASL operator for field: ${fieldName}`,
			);
		}

		predicates.push(eq(column as AnyColumn, rawValue));
	}

	const predicate = and(...predicates);
	if (!predicate) {
		throw new UnsupportedAuthorizationConditionError("Empty CASL condition is not supported");
	}

	return predicate;
}

export function accessibleByDrizzle<TAbility extends AnyAbility>(
	ability: TAbility,
	action: Parameters<TAbility["rulesFor"]>[0],
	subjectType: Parameters<TAbility["rulesFor"]>[1],
	fields: DrizzleFieldMap,
): SQL<unknown> | null {
	const rules = ability.rulesFor(action, subjectType);

	return rulesToCondition(
		rules,
		(rule) => {
			if (!rule.conditions) {
				return undefined as unknown as SQL<unknown>;
			}

			const predicate = convertLeafCondition(rule.conditions as PlainCondition, fields);
			return rule.inverted ? not(predicate) : predicate;
		},
		{
			and: (conditions) => {
				const filtered = conditions.filter(Boolean);
				const predicate = and(...filtered);
				if (!predicate) {
					throw new UnsupportedAuthorizationConditionError("Empty AND condition is not supported");
				}
				return predicate;
			},
			or: (conditions) => {
				const filtered = conditions.filter(Boolean);
				const predicate = or(...filtered);
				if (!predicate) {
					throw new UnsupportedAuthorizationConditionError("Empty OR condition is not supported");
				}
				return predicate;
			},
			empty: () => {
				throw new UnsupportedAuthorizationConditionError(
					"Unconditional database access must be combined with an explicit organization predicate",
				);
			},
		},
	);
}
```

- [ ] **Step 5: Export query adapter**

Create `apps/webapp/src/lib/authorization/query/index.ts`:

```ts
export { accessibleByDrizzle } from "./drizzle-adapter";
export { UnsupportedAuthorizationConditionError } from "./types";
export type { AccessiblePredicate, DrizzleFieldMap } from "./types";
```

Add to `apps/webapp/src/lib/authorization/index.ts`:

```ts
export { accessibleByDrizzle, UnsupportedAuthorizationConditionError } from "./query";
export type { AccessiblePredicate, DrizzleFieldMap } from "./query";
```

- [ ] **Step 6: Run adapter tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/authorization/query/__tests__/drizzle-adapter.test.ts`

Expected: PASS. If TypeScript rejects `AnyColumn` imports for the installed Drizzle version, replace `AnyColumn` with the concrete inferred column type accepted by `eq` and keep the public `DrizzleFieldMap` narrow.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/lib/authorization/query apps/webapp/src/lib/authorization/index.ts
git commit -m "feat: add casl drizzle authorization adapter"
```

## Task 3: Migrate Employee And Report Access Filters

**Files:**
- Modify: `apps/webapp/src/lib/reports/permissions.ts`
- Modify: `apps/webapp/src/lib/reports/permissions.test.ts`

- [ ] **Step 1: Write behavior tests for accessible employee IDs**

Replace `apps/webapp/src/lib/reports/permissions.test.ts` with tests for a new pure helper:

```ts
import { describe, expect, it } from "vitest";
import { getReportAccessibleEmployeeIds } from "./permissions";

describe("getReportAccessibleEmployeeIds", () => {
	it("returns only self for regular employees", () => {
		expect(
			getReportAccessibleEmployeeIds({
				currentEmployeeId: "emp-1",
				role: "employee",
				managedEmployeeIds: ["emp-2"],
			}),
		).toEqual(["emp-1"]);
	});

	it("returns self and direct reports for managers", () => {
		expect(
			getReportAccessibleEmployeeIds({
				currentEmployeeId: "emp-1",
				role: "manager",
				managedEmployeeIds: ["emp-2", "emp-3"],
			}),
		).toEqual(["emp-1", "emp-2", "emp-3"]);
	});

	it("returns null for admins because org filter is sufficient", () => {
		expect(
			getReportAccessibleEmployeeIds({
				currentEmployeeId: "emp-1",
				role: "admin",
				managedEmployeeIds: ["emp-2"],
			}),
		).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test apps/webapp/src/lib/reports/permissions.test.ts`

Expected: FAIL with missing export `getReportAccessibleEmployeeIds`.

- [ ] **Step 3: Add pure report access helper and use it in queries**

In `apps/webapp/src/lib/reports/permissions.ts`, add near the top:

```ts
export function getReportAccessibleEmployeeIds(input: {
	currentEmployeeId: string;
	role: "admin" | "manager" | "employee";
	managedEmployeeIds: string[];
}): string[] | null {
	if (input.role === "admin") {
		return null;
	}

	if (input.role === "manager") {
		return [input.currentEmployeeId, ...input.managedEmployeeIds];
	}

	return [input.currentEmployeeId];
}
```

Then update `canGenerateReport` and `getAccessibleEmployees` to compute manager relationships once and call this helper. Keep these constraints unchanged:

- `currentEmp.organizationId !== targetEmp.organizationId` returns false.
- Admin queries remain filtered by `employee.organizationId`.
- Manager queries include only self and employees listed in `employeeManagers` for `managerId = currentEmployeeId`.
- Employee queries include only self.

- [ ] **Step 4: Run report tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/reports/permissions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/reports/permissions.ts apps/webapp/src/lib/reports/permissions.test.ts
git commit -m "refactor: centralize report employee access"
```

## Task 4: Apply Query Adapter To Time Entry Reads

**Files:**
- Modify: `apps/webapp/src/app/api/time-entries/route.ts`
- Modify or create: `apps/webapp/src/app/api/time-entries/route.test.ts`

- [ ] **Step 1: Add route source guard test for adapter use**

If the current route test is heavily mocked, add this source-level regression to `apps/webapp/src/app/api/time-entries/route.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("time entries authorization query", () => {
	it("uses the CASL Drizzle adapter for cross-employee reads", () => {
		const source = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");

		expect(source).toContain("accessibleByDrizzle");
		expect(source).toContain("TimeEntry");
		expect(source).toContain("workPeriod.organizationId");
		expect(source).toContain("workPeriod.employeeId");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test apps/webapp/src/app/api/time-entries/route.test.ts`

Expected: FAIL because `route.ts` does not yet use `accessibleByDrizzle`.

- [ ] **Step 3: Use adapter in `GET /api/time-entries`**

Modify `apps/webapp/src/app/api/time-entries/route.ts` imports:

```ts
import { accessibleByDrizzle, asAppSubject } from "@/lib/authorization";
```

Inside the `targetEmployeeId !== currentEmployee.id` block, replace the broad `ability.cannot("manage", "TimeEntry")` check with an adapter availability check before loading the target employee:

```ts
const ability = await getAbility();
if (!ability) {
	const error = new ForbiddenError("read", "TimeEntry");
	const httpError = toHttpError(error);
	return NextResponse.json(httpError.body, { status: httpError.status });
}

const timeEntryAccess = accessibleByDrizzle(ability, "read", "TimeEntry", {
	organizationId: workPeriod.organizationId,
	employeeId: workPeriod.employeeId,
});

if (!timeEntryAccess) {
	const error = new ForbiddenError("read", "TimeEntry");
	const httpError = toHttpError(error);
	return NextResponse.json(httpError.body, { status: httpError.status });
}
```

Keep the existing target employee same-organization verification immediately after this block. After `targetEmployee` is loaded and before returning from the `targetEmployeeId !== currentEmployee.id` block, add a record-specific runtime check so the route does not authorize every same-org employee just because a broad filter exists:

```ts
if (
	!ability.can(
		"read",
		asAppSubject("TimeEntry", {
			employeeId: targetEmployee.id,
			organizationId: targetEmployee.organizationId,
		}),
	)
) {
	const error = new ForbiddenError("read", "TimeEntry");
	const httpError = toHttpError(error);
	return NextResponse.json(httpError.body, { status: httpError.status });
}
```

Do not remove the existing `TimeEntryService.getTimeEntries({ employeeId: targetEmployeeId, organizationId: activeOrgId, ... })` organization filter in this task.

- [ ] **Step 4: Run time entry route tests**

Run: `pnpm --filter webapp test apps/webapp/src/app/api/time-entries/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Run authorization adapter tests again**

Run: `pnpm --filter webapp test apps/webapp/src/lib/authorization/query/__tests__/drizzle-adapter.test.ts apps/webapp/src/lib/authorization/__tests__/ability.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/app/api/time-entries/route.ts apps/webapp/src/app/api/time-entries/route.test.ts
git commit -m "refactor: use casl filter for time entry reads"
```

## Task 5: Migrate Absence Permission Helpers To CASL Object Checks

**Files:**
- Modify: `apps/webapp/src/lib/absences/permissions.ts`
- Modify: `apps/webapp/src/lib/absences/permissions.test.ts`

- [ ] **Step 1: Add pure absence authorization helper tests**

Add this import beside the existing imports at the top of `apps/webapp/src/lib/absences/permissions.test.ts`:

```ts
import { canApproveAbsenceRecord } from "./permissions";
```

Append this block to the end of the same test file:

```ts

describe("canApproveAbsenceRecord", () => {
	it("allows admins in the same organization", () => {
		expect(
			canApproveAbsenceRecord({
				approver: { id: "emp-1", role: "admin", organizationId: "org-1" },
				absence: { employeeId: "emp-2", organizationId: "org-1" },
				managedEmployeeIds: [],
			}),
		).toBe(true);
	});

	it("allows managers for direct reports in the same organization", () => {
		expect(
			canApproveAbsenceRecord({
				approver: { id: "emp-1", role: "manager", organizationId: "org-1" },
				absence: { employeeId: "emp-2", organizationId: "org-1" },
				managedEmployeeIds: ["emp-2"],
			}),
		).toBe(true);
	});

	it("denies cross-organization absence approval", () => {
		expect(
			canApproveAbsenceRecord({
				approver: { id: "emp-1", role: "admin", organizationId: "org-1" },
				absence: { employeeId: "emp-2", organizationId: "org-2" },
				managedEmployeeIds: ["emp-2"],
			}),
		).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test apps/webapp/src/lib/absences/permissions.test.ts`

Expected: FAIL with missing export `canApproveAbsenceRecord`.

- [ ] **Step 3: Add pure CASL-backed absence helper**

Add to `apps/webapp/src/lib/absences/permissions.ts`:

```ts
import { defineAbilityFor, asAppSubject } from "@/lib/authorization";
import type { PrincipalContext } from "@/lib/authorization";

export function canApproveAbsenceRecord(input: {
	approver: {
		id: string;
		role: "admin" | "manager" | "employee";
		organizationId: string;
	};
	absence: {
		employeeId: string;
		organizationId: string;
	};
	managedEmployeeIds: string[];
}): boolean {
	const principal: PrincipalContext = {
		userId: input.approver.id,
		isPlatformAdmin: false,
		activeOrganizationId: input.approver.organizationId,
		orgMembership: null,
		employee: {
			id: input.approver.id,
			organizationId: input.approver.organizationId,
			role: input.approver.role,
			teamId: null,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: input.managedEmployeeIds,
		customRoles: [],
	};

	const ability = defineAbilityFor(principal);
	return ability.can(
		"approve",
		asAppSubject("Absence", {
			employeeId: input.absence.employeeId,
			organizationId: input.absence.organizationId,
		}),
	);
}
```

- [ ] **Step 4: Keep async DB helper behavior unchanged while delegating final decision**

In `canApproveAbsence`, keep the current DB lookups, but replace role branching with:

```ts
return canApproveAbsenceRecord({
	approver: {
		id: approver.id,
		role: approver.role,
		organizationId: approver.organizationId,
	},
	absence: {
		employeeId: target.id,
		organizationId: target.organizationId,
	},
	managedEmployeeIds: target.managerId === employeeId ? [targetEmployeeId] : [],
});
```

This preserves the existing deprecated `managerId` behavior for this helper. A later task can switch it to `employeeManagers` after route-level callers are checked.

- [ ] **Step 5: Run absence tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/absences/permissions.test.ts apps/webapp/src/lib/authorization/__tests__/ability.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/absences/permissions.ts apps/webapp/src/lib/absences/permissions.test.ts
git commit -m "refactor: use casl for absence approval checks"
```

## Task 6: Add Approval Query Filter Integration

**Files:**
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.ts`
- Create or modify: `apps/webapp/src/app/api/approvals/inbox/route.test.ts`

- [ ] **Step 1: Add route source guard test**

Create or append to `apps/webapp/src/app/api/approvals/inbox/route.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("approval inbox authorization query", () => {
	it("derives approval read filters through CASL where possible", () => {
		const source = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");

		expect(source).toContain("accessibleByDrizzle");
		expect(source).toContain("Approval");
		expect(source).toContain("approvalRequest.organizationId");
		expect(source).toContain("approvalRequest.requestedBy");
		expect(source).toContain("approvalRequest.approverId");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test apps/webapp/src/app/api/approvals/inbox/route.test.ts`

Expected: FAIL because `route.ts` does not yet use `accessibleByDrizzle`.

- [ ] **Step 3: Import approval schema and adapter**

Modify imports in `apps/webapp/src/app/api/approvals/inbox/route.ts`:

```ts
import { employee, approvalRequest } from "@/db/schema";
import { accessibleByDrizzle } from "@/lib/authorization";
```

If `approvalRequest` is not exported from `@/db/schema`, import it from `@/db/schema/approval` and add a follow-up export cleanup only if existing schema conventions support it.

- [ ] **Step 4: Create approval access predicate before building query params**

After `canApproveOrManage` is checked, add:

```ts
const approvalAccess = accessibleByDrizzle(ability, "read", "Approval", {
	organizationId: approvalRequest.organizationId,
	requestedBy: approvalRequest.requestedBy,
	approverId: approvalRequest.approverId,
	status: approvalRequest.status,
});

if (!canManageApprovals && !approvalAccess) {
	const error = new ForbiddenError("read", "Approval");
	const httpError = toHttpError(error);
	return NextResponse.json(httpError.body, { status: httpError.status });
}
```

Do not pass `approvalAccess` into `ApprovalQueryService` in this task unless that service already accepts a Drizzle predicate. Keep `eligibleApprovalScopes` behavior unchanged. This task establishes the CASL-derived denial check without changing pagination/query internals.

- [ ] **Step 5: Run approval route test**

Run: `pnpm --filter webapp test apps/webapp/src/app/api/approvals/inbox/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/app/api/approvals/inbox/route.ts apps/webapp/src/app/api/approvals/inbox/route.test.ts
git commit -m "refactor: add casl approval inbox filter guard"
```

## Task 7: Full Verification And Cleanup

**Files:**
- Review: `apps/webapp/src/lib/authorization/ability.ts`
- Review: `apps/webapp/src/lib/authorization/query/drizzle-adapter.ts`
- Review: `apps/webapp/src/lib/reports/permissions.ts`
- Review: `apps/webapp/src/app/api/time-entries/route.ts`
- Review: `apps/webapp/src/lib/absences/permissions.ts`
- Review: `apps/webapp/src/app/api/approvals/inbox/route.ts`

- [ ] **Step 1: Run focused authorization and migrated feature tests**

Run:

```bash
pnpm --filter webapp test apps/webapp/src/lib/authorization/__tests__/ability.test.ts apps/webapp/src/lib/authorization/query/__tests__/drizzle-adapter.test.ts apps/webapp/src/lib/reports/permissions.test.ts apps/webapp/src/lib/absences/permissions.test.ts apps/webapp/src/app/api/time-entries/route.test.ts apps/webapp/src/app/api/approvals/inbox/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full webapp test suite if focused tests pass**

Run: `pnpm --filter webapp test`

Expected: PASS. If unrelated tests fail, record exact failing test names and do not hide the failure.

- [ ] **Step 3: Run type/build check if tests pass**

Run: `CI=true pnpm build`

Expected: PASS. If the build needs unavailable Phase CLI environment variables, skip the build and report the skipped variables per `AGENTS.md`.

- [ ] **Step 4: Inspect diff for accidental broad rewrites**

Run: `git diff --stat HEAD~6..HEAD`

Expected: changed files are limited to authorization, reports, time entries, absences, approvals tests/routes, and this plan's intended files.

- [ ] **Step 5: Commit any final cleanup**

If formatting or import cleanup changed files, commit them:

```bash
git add apps/webapp/src/lib/authorization apps/webapp/src/lib/reports apps/webapp/src/lib/absences apps/webapp/src/app/api/time-entries apps/webapp/src/app/api/approvals/inbox
git commit -m "chore: verify casl authorization migration"
```

If there are no cleanup changes, do not create an empty commit.

## Self-Review Notes

- Spec coverage: typed object subjects are covered in Task 1; CASL-to-Drizzle adapter is covered in Task 2; first subject migrations are covered in Tasks 3 through 6; safety verification is covered in Task 7.
- Multi-tenancy: every migrated database-backed subject includes `organizationId` in rules, field maps, or retained route checks.
- Security: unsupported adapter fields and operators fail closed, and route authentication checks remain in place.
- Scope: this plan does not attempt the full broad rewrite; it creates the foundation and migrates the highest-value first paths.
