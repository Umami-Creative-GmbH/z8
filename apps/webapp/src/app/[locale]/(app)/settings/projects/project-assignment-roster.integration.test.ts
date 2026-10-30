/**
 * #1438: the project assignment list marks former employees (deactivated, or
 * past a due departure) so the panel hides them by default, and the project
 * pickers offer the current roster only. The real server actions run against a
 * disposable database; only the request/session, Next cache and logger are
 * replaced.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user", name: "Owner" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/organization-mfa/organization-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/organization-mfa/organization-access")>()),
	canAccessOrganization: async () => true,
}));

vi.mock("@/lib/logger", () => {
	const logger = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => logger,
	};
	return { logger, createLogger: () => logger };
});

const { getEmployeesForSelection, getProjects } = await import("./actions");

// 13:00 UTC is already the next day in Auckland (UTC+13 in February), the
// organization's timezone (#1439).
const PAST_CUTOFF = "2026-02-01T13:00:00Z";
const PAST_CUTOFF_LOCAL_DATE = "2026-02-02";

describe("project assignments on PostgreSQL (#1438)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let deactivated: SeededEmployee;
	let due: SeededEmployee;
	let otherOrganizationEmployee: SeededEmployee;
	const projectId = randomUUID();

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'Pacific/Auckland' where id = $1`, [
			fixture.organizationId,
		]);
		// Seeded inactive: deactivated before the instant was stored, so not recorded.
		deactivated = await fixture.seedEmployee({ isActive: false });
		due = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-01-31', 'UTC', $4, $5, gen_random_uuid(), 'test', 1,
			         'pending')`,
			[
				fixture.organizationId,
				due.employeeId,
				due.employmentPeriodId,
				PAST_CUTOFF,
				fixture.ownerUserId,
			],
		);
		const otherOrganizationId = await fixture.createOrganization();
		otherOrganizationEmployee = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		await fixture.pool.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
			 values ($1, $2, 'Apollo', 'active', true, $3, now())`,
			[projectId, fixture.organizationId, fixture.ownerUserId],
		);
		for (const employeeId of [fixture.employeeId, deactivated.employeeId, due.employeeId]) {
			await fixture.pool.query(
				`insert into project_assignment (project_id, organization_id, assignment_type, employee_id, created_by)
				 values ($1, $2, 'employee', $3, $4)`,
				[projectId, fixture.organizationId, employeeId, fixture.ownerUserId],
			);
		}
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("marks former employees' assignments", async () => {
		const result = await getProjects(fixture.organizationId);

		if (!result.success) throw new Error(result.error);
		const project = result.data.find((entry) => entry.id === projectId);
		expect(
			new Map(
				(project?.assignments ?? []).map((assignment) => [
					assignment.employeeId,
					assignment.employeeIsFormer,
				]),
			),
		).toEqual(
			new Map([
				[fixture.employeeId, false],
				[deactivated.employeeId, true],
				[due.employeeId, true],
			]),
		);
		const since = new Map(
			(project?.assignments ?? []).map((assignment) => [
				assignment.employeeId,
				assignment.employeeFormerSince,
			]),
		);
		expect(since.get(fixture.employeeId)).toBeUndefined();
		expect(since.get(deactivated.employeeId)).toBeNull();
		expect(since.get(due.employeeId)).toBe(PAST_CUTOFF_LOCAL_DATE);
	});

	it("offers only the organization's current roster for new assignments", async () => {
		const result = await getEmployeesForSelection(fixture.organizationId);

		if (!result.success) throw new Error(result.error);
		expect(result.data.map((entry) => entry.id).toSorted()).toEqual(
			[fixture.ownerEmployeeId, fixture.employeeId].toSorted(),
		);
		expect(result.data.some((entry) => entry.id === otherOrganizationEmployee.employeeId)).toBe(
			false,
		);
	});
});
