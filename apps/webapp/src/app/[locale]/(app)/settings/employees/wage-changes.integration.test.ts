/**
 * #1177: wages change only through employment terms, and only org admins
 * change them. The real server actions run against a disposable database;
 * only the request/session, SSO session store, Next cache and logger are
 * replaced.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);

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

vi.mock(
	"@/lib/organization-mfa/organization-access",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("@/lib/organization-mfa/organization-access")
		>()),
		canAccessOrganization: async () => true,
	}),
);

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({
			error: () => {},
			warn: () => {},
			info: () => {},
			debug: () => {},
		}),
	}),
}));

const { changeEmployeeWageAction } = await import(
	"./employment-history-actions"
);
const { updateEmployeeAction } = await import("./employee-mutations.actions");
const { getEmployeeAction } = await import("./employee-queries.actions");

describe("wage changes on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let managerUserId: string;

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = fixture.organizationId;
	}

	async function terms() {
		const { rows } = await fixture.pool.query<{
			valid_from: Date;
			valid_until: Date | null;
			hourly_rate: string | null;
			weekly_contract_minutes: number;
			work_model: string;
			currency: string;
			change_reason: string | null;
			review_state: string;
		}>(
			`select valid_from, valid_until, hourly_rate::text, weekly_contract_minutes, work_model,
			        currency, change_reason, review_state
			 from employee_employment_history where employee_id = $1 order by valid_from, created_at`,
			[fixture.employeeId],
		);
		return rows;
	}

	async function employeeContractFields() {
		const { rows } = await fixture.pool.query<{
			contract_type: string;
			position: string | null;
		}>("select contract_type, position from employee where id = $1", [
			fixture.employeeId,
		]);
		return rows[0];
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		const manager = await fixture.seedEmployee();
		managerUserId = manager.userId;
		await fixture.pool.query(
			"update employee set role = 'manager' where id = $1",
			[manager.employeeId],
		);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[fixture.employeeId, manager.employeeId, fixture.ownerUserId],
		);
	});

	beforeEach(async () => {
		await fixture.pool.query(
			"delete from employee_employment_history where employee_id = $1",
			[fixture.employeeId],
		);
		await fixture.pool.query(
			"update employee set contract_type = 'hourly', position = null where id = $1",
			[fixture.employeeId],
		);
		await fixture.pool.query(
			`insert into employee_employment_history
			 (employee_id, organization_id, employment_period_id, valid_from, contract_type,
			  weekly_contract_minutes, work_model, hourly_rate, currency, review_state, created_by, updated_at)
			 values ($1, $2, $3, '2026-01-01 00:00:00', 'hourly', 1800, 'hybrid', 25.00, 'CHF',
			         'confirmed', $4, now())`,
			[
				fixture.employeeId,
				fixture.organizationId,
				fixture.employmentPeriodId,
				fixture.ownerUserId,
			],
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("lets an org admin change the wage through new terms that copy every other field", async () => {
		actAs(fixture.ownerUserId);

		const result = await changeEmployeeWageAction(fixture.employeeId, {
			effectiveOn: "2026-07-01",
			hourlyRate: "27.50",
			changeReason: "Annual review",
		});

		expect(result).toMatchObject({ success: true });
		expect(
			(await terms()).map((row) => [
				row.valid_from.toISOString().slice(0, 10),
				row.valid_until?.toISOString().slice(0, 10) ?? null,
				row.hourly_rate,
				row.weekly_contract_minutes,
				row.work_model,
				row.currency,
				row.change_reason,
				row.review_state,
			]),
		).toEqual([
			[
				"2026-01-01",
				"2026-07-01",
				"25.00",
				1800,
				"hybrid",
				"CHF",
				null,
				"confirmed",
			],
			[
				"2026-07-01",
				null,
				"27.50",
				1800,
				"hybrid",
				"CHF",
				"Annual review",
				"confirmed",
			],
		]);
	});

	it("keeps a draft wage change out of the confirmed timeline", async () => {
		actAs(fixture.ownerUserId);

		const result = await changeEmployeeWageAction(fixture.employeeId, {
			effectiveOn: "2026-07-01",
			hourlyRate: 27.5,
			changeReason: "Proposal",
			reviewState: "draft",
		});

		expect(result).toMatchObject({ success: true });
		expect(
			(await terms()).map((row) => [row.review_state, row.valid_until]),
		).toEqual([
			["confirmed", null],
			["draft", null],
		]);
	});

	it("shows the refusal when the terms in force are not hourly", async () => {
		actAs(fixture.ownerUserId);
		await fixture.pool.query(
			"update employee_employment_history set contract_type = 'fixed', hourly_rate = null where employee_id = $1",
			[fixture.employeeId],
		);

		const result = await changeEmployeeWageAction(fixture.employeeId, {
			effectiveOn: "2026-07-01",
			hourlyRate: 27.5,
			changeReason: "Raise",
		});

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error: "The employment terms in force on this date are not hourly.",
		});
	});

	it("rejects a scoped manager's wage change", async () => {
		actAs(managerUserId);

		const result = await changeEmployeeWageAction(fixture.employeeId, {
			effectiveOn: "2026-07-01",
			hourlyRate: 99,
			changeReason: "Raise",
		});

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await terms()).toHaveLength(1);
	});

	it("leaves every wage and contract field unchanged on a scoped manager's save", async () => {
		actAs(managerUserId);

		const result = await updateEmployeeAction(fixture.employeeId, {
			position: "Lead",
			contractType: "fixed",
			hourlyRate: "99",
		} as Parameters<typeof updateEmployeeAction>[1]);

		expect(result).toMatchObject({ success: true });
		expect(await employeeContractFields()).toEqual({
			contract_type: "hourly",
			position: "Lead",
		});
		expect(await terms()).toHaveLength(1);
	});

	it("reads the contract type of today's confirmed terms for the edit form", async () => {
		actAs(managerUserId);
		await fixture.pool.query(
			"update employee set contract_type = 'fixed' where id = $1",
			[fixture.employeeId],
		);

		const result = await getEmployeeAction(fixture.employeeId);

		expect(result).toMatchObject({
			success: true,
			data: { contractTypeToday: "hourly" },
		});
	});

	it("leaves every wage and contract field unchanged on an org admin's save", async () => {
		actAs(fixture.ownerUserId);

		const result = await updateEmployeeAction(fixture.employeeId, {
			position: "Lead",
			contractType: "fixed",
			hourlyRate: "99",
		} as Parameters<typeof updateEmployeeAction>[1]);

		expect(result).toMatchObject({ success: true });
		expect(await employeeContractFields()).toEqual({
			contract_type: "hourly",
			position: "Lead",
		});
		expect(await terms()).toHaveLength(1);
	});
});
