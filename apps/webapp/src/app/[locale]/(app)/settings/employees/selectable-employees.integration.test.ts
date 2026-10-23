/**
 * #1438: the shared employee pickers and the employee directory read the
 * current roster by default. Former employees (deactivated, or past a due
 * departure) appear only where a view of the past opts in, marked. The real
 * server actions run against a disposable database; only the request/session,
 * Next cache and logger are replaced.
 */
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
							user: { id: harness.userId, role: "user" },
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

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
	}),
}));

const { getEmployeesByIdsAction, listEmployeesAction, listEmployeesForSelectAction } = await import(
	"./employee-queries.actions"
);

/** A cutoff well before the test runs, so the scheduled departure is due. */
const PAST_CUTOFF = "2026-02-01T00:00:00Z";

describe("employee pickers and directory on PostgreSQL (#1438)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let manager: SeededEmployee;
	let deactivated: SeededEmployee;
	let due: SeededEmployee;
	let unmanaged: SeededEmployee;
	let otherOrganizationEmployee: SeededEmployee;

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = fixture.organizationId;
	}

	async function manage(managerId: string, employeeId: string) {
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[employeeId, managerId, fixture.ownerUserId],
		);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		manager = await fixture.seedEmployee();
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			manager.employeeId,
		]);
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
		unmanaged = await fixture.seedEmployee();
		for (const report of [fixture.employeeId, deactivated.employeeId, due.employeeId]) {
			await manage(manager.employeeId, report);
		}
		const otherOrganizationId = await fixture.createOrganization();
		otherOrganizationEmployee = await fixture.seedEmployee({ organizationId: otherOrganizationId });
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function pickerRows(params: Parameters<typeof listEmployeesForSelectAction>[0] = {}) {
		const result = await listEmployeesForSelectAction({ limit: 100, ...params });
		if (!result.success) throw new Error(result.error);
		return new Map(result.data.employees.map((row) => [row.id, row.isFormer]));
	}

	describe("the shared picker loader", () => {
		it("offers only the current roster by default", async () => {
			actAs(fixture.ownerUserId);

			const rows = await pickerRows();

			expect([...rows.keys()].toSorted()).toEqual(
				[
					fixture.ownerEmployeeId,
					fixture.employeeId,
					manager.employeeId,
					unmanaged.employeeId,
				].toSorted(),
			);
			expect([...rows.values()].every((isFormer) => isFormer === false)).toBe(true);
		});

		it("includes and marks former employees when a picker opts in", async () => {
			actAs(fixture.ownerUserId);

			const rows = await pickerRows({ status: "all" });

			expect(rows.get(deactivated.employeeId)).toBe(true);
			expect(rows.get(due.employeeId)).toBe(true);
			expect(rows.get(fixture.employeeId)).toBe(false);
			expect(rows.has(otherOrganizationEmployee.employeeId)).toBe(false);
		});

		it("lists only former employees on the former filter", async () => {
			actAs(fixture.ownerUserId);

			const rows = await pickerRows({ status: "former" });

			expect([...rows.keys()].toSorted()).toEqual(
				[deactivated.employeeId, due.employeeId].toSorted(),
			);
		});

		it("reads an unknown or legacy status as the current roster", async () => {
			actAs(fixture.ownerUserId);

			const legacy = await pickerRows({ status: "active" });
			const unknown = await pickerRows({ status: "everyone" as never });

			expect(legacy.has(deactivated.employeeId)).toBe(false);
			expect(unknown.has(due.employeeId)).toBe(false);
			expect(legacy.has(fixture.employeeId)).toBe(true);
		});

		it("never offers another organization's employees", async () => {
			actAs(fixture.ownerUserId);

			for (const status of ["current", "former", "all"] as const) {
				expect((await pickerRows({ status })).has(otherOrganizationEmployee.employeeId)).toBe(
					false,
				);
			}
		});

		it("keeps a manager's picker to their current reports", async () => {
			actAs(manager.userId);

			const current = await pickerRows();
			const all = await pickerRows({ status: "all" });

			expect([...current.keys()]).toEqual([fixture.employeeId]);
			expect([...all.keys()].toSorted()).toEqual(
				[fixture.employeeId, deactivated.employeeId, due.employeeId].toSorted(),
			);
			expect(all.has(unmanaged.employeeId)).toBe(false);
		});

		it("still resolves an already selected former employee, marked", async () => {
			actAs(fixture.ownerUserId);

			const result = await getEmployeesByIdsAction([
				fixture.employeeId,
				deactivated.employeeId,
				due.employeeId,
				otherOrganizationEmployee.employeeId,
			]);

			if (!result.success) throw new Error(result.error);
			expect(new Map(result.data.map((row) => [row.id, row.isFormer]))).toEqual(
				new Map([
					[fixture.employeeId, false],
					[deactivated.employeeId, true],
					[due.employeeId, true],
				]),
			);
		});
	});

	describe("the employee directory", () => {
		async function directory(
			status?: NonNullable<Parameters<typeof listEmployeesAction>[0]>["status"],
		) {
			const result = await listEmployeesAction({ limit: 100, status });
			if (!result.success) throw new Error(result.error);
			return new Map(
				result.data.employees.map((row) => [
					row.id,
					row.kind === "employee" ? row.isFormer : undefined,
				]),
			);
		}

		it("filters current and former employees, a due departure counting as former", async () => {
			actAs(fixture.ownerUserId);

			const current = await directory("current");
			const former = await directory("former");

			expect(current.has(fixture.employeeId)).toBe(true);
			expect(current.has(deactivated.employeeId)).toBe(false);
			expect(current.has(due.employeeId)).toBe(false);
			expect([...former.keys()].toSorted()).toEqual(
				[deactivated.employeeId, due.employeeId].toSorted(),
			);
			expect([...former.values()]).toEqual([true, true]);
		});

		it("keeps the legacy active and inactive values working", async () => {
			actAs(fixture.ownerUserId);

			expect((await directory("active")).has(deactivated.employeeId)).toBe(false);
			expect([...(await directory("inactive")).keys()].toSorted()).toEqual(
				[deactivated.employeeId, due.employeeId].toSorted(),
			);
		});

		it("lists everyone, marked, without a status", async () => {
			actAs(fixture.ownerUserId);

			const all = await directory();

			expect(all.get(fixture.employeeId)).toBe(false);
			expect(all.get(deactivated.employeeId)).toBe(true);
			expect(all.has(otherOrganizationEmployee.employeeId)).toBe(false);
		});
	});
});
