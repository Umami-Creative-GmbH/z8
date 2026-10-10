/**
 * #999: the bulk opening balance upload, through its server actions on
 * PostgreSQL. A preview lists every row with its errors; a commit writes all
 * opening balances in one transaction, or none while any row has an error.
 * Only the session is mocked.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
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
								id: `t999-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const actions = await import(
	"@/app/[locale]/(app)/settings/employees/opening-balance-upload-actions"
);
const workBalanceActions = await import(
	"@/app/[locale]/(app)/settings/employees/work-balance-actions"
);
const workBalance = await import("@/lib/work-balance/service");

const today = plainDateAt(systemClock.nowInstant(), "UTC");
const tomorrow = today.add({ days: 1 }).toString();
const openingDay = "2026-03-31";
const HEADER = "employee_number,day,balance,reason";

describe("bulk opening balance upload on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let otherOrganizationId: string;
	let owner: string;
	let admin: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		owner = fixture.ownerUserId;
		otherOrganizationId = await fixture.createOrganization();
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = any($1)`, [
			[organizationId, otherOrganizationId],
		]);
		admin = await fixture.seedEmployee({ role: "admin" });
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seedNumbered(
		employeeNumber: string,
		options: { isActive?: boolean; organizationId?: string } = {},
	) {
		const seeded = await fixture.seedEmployee(options);
		await fixture.pool.query(`update employee set employee_number = $2 where id = $1`, [
			seeded.employeeId,
			employeeNumber,
		]);
		return seeded;
	}

	function actAs(userId: string, activeOrganizationId: string = organizationId) {
		harness.userId = userId;
		harness.organizationId = activeOrganizationId;
	}

	function csv(...rows: string[]) {
		return [HEADER, ...rows].join("\n");
	}

	async function openingBalancesInEffect(employeeIds: string[]) {
		const result = await fixture.pool.query<{ employee_id: string; minutes: number; day: string }>(
			`select employee_id, minutes, to_char(day, 'YYYY-MM-DD') as day from balance_adjustment
			 where organization_id = $1 and employee_id = any($2)
				 and kind = 'opening_balance' and cancelled_at is null`,
			[organizationId, employeeIds],
		);
		return result.rows;
	}

	async function auditRows(employeeIds: string[]) {
		const result = await fixture.pool.query<{
			employee_id: string;
			action: string;
			performed_by: string;
			metadata: unknown;
		}>(
			`select employee_id, action, performed_by, metadata from audit_log
			 where organization_id = $1 and employee_id = any($2) and entity_type = 'balance_adjustment'
			 order by timestamp, action desc`,
			[organizationId, employeeIds],
		);
		return result.rows.map((row) => ({
			...row,
			metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
		}));
	}

	async function notifications(userIds: string[]) {
		const result = await fixture.pool.query<{ user_id: string; type: string; entity_id: string }>(
			`select user_id, type::text as type, entity_id from notification
			 where organization_id = $1 and user_id = any($2) order by created_at`,
			[organizationId, userIds],
		);
		return result.rows;
	}

	async function insertPayout(employeeId: string, day: string) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into balance_adjustment
			 (organization_id, employee_id, kind, day, minutes, reason, recorded_by, recorded_at)
			 values ($1, $2, 'overtime_payout', $3, -60, 'Paid out', $4, now()) returning id`,
			[organizationId, employeeId, day, owner],
		);
		return result.rows[0]?.id as string;
	}

	it("previews 80 valid rows, then commits 80 opening balances at once", async () => {
		const employees: SeededEmployee[] = [];
		for (let index = 1; index <= 80; index += 1) {
			employees.push(await seedNumbered(`B${String(index).padStart(3, "0")}`));
		}
		const ids = employees.map((employee) => employee.employeeId);
		const file = csv(
			...employees.map(
				(_, index) =>
					`B${String(index + 1).padStart(3, "0")},${openingDay},${index}:15,Carried over`,
			),
		);

		actAs(admin.userId);
		const preview = await actions.previewOpeningBalanceUploadAction({ csv: file });
		expect(preview).toMatchObject({ success: true, data: { status: "ready" } });
		const rows = preview.success && preview.data.status === "ready" ? preview.data.rows : [];
		expect(rows).toHaveLength(80);
		expect(rows[3]).toMatchObject({
			row: 5,
			employeeNumber: "B004",
			employee: { id: ids[3], isActive: true },
			day: openingDay,
			minutes: 195,
			replaces: null,
			errors: [],
		});
		// A preview writes nothing.
		expect(await openingBalancesInEffect(ids)).toEqual([]);

		const committed = await actions.commitOpeningBalanceUploadAction({ csv: file });
		expect(committed).toMatchObject({
			success: true,
			data: { status: "committed", created: 80, replaced: 0 },
		});
		expect(await openingBalancesInEffect(ids)).toHaveLength(80);
		const audit = await auditRows(ids);
		expect(audit).toHaveLength(80);
		expect(audit.every((row) => row.action === "balance_adjustment.recorded")).toBe(true);
		expect(audit[0]).toMatchObject({
			performed_by: admin.userId,
			metadata: expect.objectContaining({ source: "opening_balance_upload" }),
		});

		// Each employee is notified once, as when it is set individually.
		const notified = await notifications(employees.map((employee) => employee.userId));
		expect(notified).toHaveLength(80);
		expect(new Set(notified.map((row) => row.user_id)).size).toBe(80);
		expect(notified.every((row) => row.type === "work_balance_adjustment_recorded")).toBe(true);

		// Each balance is rebuilt right after the commit.
		expect(
			await workBalance.getEmployeeWorkBalance({ employeeId: ids[3] as string, organizationId }),
		).toMatchObject({ adjustmentMinutes: 195, computedFromDate: "2026-04-01" });
	});

	it("lists every row's errors and commits nothing while any row has one", async () => {
		const valid = await seedNumbered("C-1");
		const sharedA = await seedNumbered("C-2");
		const sharedB = await seedNumbered("c-2");
		const twice = await seedNumbered("C-3");
		const future = await seedNumbered("C-4");
		const paidOut = await seedNumbered("C-5");
		const ids = [valid, sharedA, sharedB, twice, future, paidOut].map((e) => e.employeeId);
		const payoutId = await insertPayout(paidOut.employeeId, "2026-03-15");

		const file = csv(
			`C-1,${openingDay},10:00,Carried over`,
			`C-404,${openingDay},10:00,Carried over`,
			`C-2,${openingDay},10:00,Carried over`,
			`C-3,${openingDay},10:00,Carried over`,
			`C-3,${openingDay},-1:00,Carried over again`,
			`C-4,${tomorrow},10:00,Carried over`,
			`C-5,${openingDay},10:00,Carried over`,
			`C-1x,2026-13-01,10,`,
		);

		actAs(owner);
		for (const action of [
			actions.previewOpeningBalanceUploadAction,
			actions.commitOpeningBalanceUploadAction,
		]) {
			const result = await action({ csv: file });
			expect(result).toMatchObject({ success: true, data: { status: "has_errors" } });
			const rows = result.success && result.data.status === "has_errors" ? result.data.rows : [];
			expect(rows.map(({ row, errors }) => ({ row, errors }))).toEqual([
				{ row: 2, errors: [] },
				{ row: 3, errors: [{ code: "unknown_employee" }] },
				{ row: 4, errors: [{ code: "ambiguous_employee" }] },
				{ row: 5, errors: [{ code: "duplicate_employee" }] },
				{ row: 6, errors: [{ code: "duplicate_employee" }] },
				{ row: 7, errors: [{ code: "future_day" }] },
				{
					row: 8,
					errors: [
						{
							code: "conflicting_payouts",
							conflictingPayouts: [{ id: payoutId, day: "2026-03-15", minutes: -60 }],
						},
					],
				},
				{
					row: 9,
					errors: [
						{ code: "invalid_day" },
						{ code: "invalid_amount" },
						{ code: "reason_required" },
						{ code: "unknown_employee" },
					],
				},
			]);
		}
		expect(await openingBalancesInEffect(ids)).toEqual([]);
		expect(await auditRows(ids)).toEqual([]);
		expect(
			await notifications(
				[valid, sharedA, sharedB, twice, future, paidOut].map((employee) => employee.userId),
			),
		).toEqual([]);
	});

	it("re-checks every row when committing, so a payout recorded since the preview refuses it", async () => {
		const first = await seedNumbered("D-1");
		const second = await seedNumbered("D-2");
		const file = csv(`D-1,${openingDay},1:00,Carried over`, `D-2,${openingDay},2:00,Carried over`);

		actAs(admin.userId);
		expect(await actions.previewOpeningBalanceUploadAction({ csv: file })).toMatchObject({
			success: true,
			data: { status: "ready" },
		});
		await insertPayout(second.employeeId, openingDay);

		const committed = await actions.commitOpeningBalanceUploadAction({ csv: file });
		expect(committed).toMatchObject({
			success: true,
			data: {
				status: "has_errors",
				rows: [
					{ row: 2, errors: [] },
					{ row: 3, errors: [{ code: "conflicting_payouts" }] },
				],
			},
		});
		expect(await openingBalancesInEffect([first.employeeId, second.employeeId])).toEqual([]);
	});

	it("replaces an opening balance in effect, so the uploaded one is the only one", async () => {
		const subject = await seedNumbered("E-1");
		actAs(admin.userId);
		const earlier = await workBalanceActions.setOpeningBalanceAction({
			employeeId: subject.employeeId,
			day: "2026-02-28",
			negative: false,
			hours: 5,
			minutes: 0,
			reason: "Set by hand",
		});
		const earlierId = earlier.success ? earlier.data.adjustmentId : "";

		const file = csv(`E-1,${openingDay},-3:30,Corrected carry-over`);
		const preview = await actions.previewOpeningBalanceUploadAction({ csv: file });
		expect(preview).toMatchObject({
			success: true,
			data: {
				status: "ready",
				rows: [{ replaces: { day: "2026-02-28", minutes: 300 }, minutes: -210, errors: [] }],
			},
		});

		expect(await actions.commitOpeningBalanceUploadAction({ csv: file })).toMatchObject({
			success: true,
			data: { status: "committed", created: 1, replaced: 1 },
		});
		expect(await openingBalancesInEffect([subject.employeeId])).toEqual([
			{ employee_id: subject.employeeId, minutes: -210, day: openingDay },
		]);
		const cancelled = await fixture.pool.query<{ cancellation_reason: string }>(
			`select cancellation_reason from balance_adjustment where id = $1`,
			[earlierId],
		);
		expect(cancelled.rows).toEqual([{ cancellation_reason: "Corrected carry-over" }]);
		const inEffectId = (
			await fixture.pool.query<{ id: string }>(
				`select id from balance_adjustment where employee_id = $1 and cancelled_at is null`,
				[subject.employeeId],
			)
		).rows[0]?.id;
		// The replaced one as cancelled, the uploaded one as recorded.
		expect(
			(await notifications([subject.userId])).map(({ type, entity_id }) => ({ type, entity_id })),
		).toEqual(
			expect.arrayContaining([
				{ type: "work_balance_adjustment_cancelled", entity_id: earlierId },
				{ type: "work_balance_adjustment_recorded", entity_id: inEffectId },
			]),
		);
		expect(await notifications([subject.userId])).toHaveLength(3);
		expect((await auditRows([subject.employeeId])).map((row) => row.action).sort()).toEqual([
			"balance_adjustment.cancelled",
			"balance_adjustment.recorded",
			"balance_adjustment.recorded",
		]);
	});

	it("limits a payroll grant holder to the employees their grant covers, departed ones included", async () => {
		const holder = await seedNumbered("F-HOLDER");
		const covered = await seedNumbered("F-1");
		const left = await seedNumbered("F-2", { isActive: false });
		const outsider = await seedNumbered("F-3");
		const grantId = randomUUID();
		await fixture.pool.query(
			`insert into payroll_access_grant
			 (id, organization_id, payroll_employee_id, scope, is_active, created_by, updated_at)
			 values ($1, $2, $3, 'specific', true, $4, now())`,
			[grantId, organizationId, holder.employeeId, owner],
		);
		for (const employeeId of [covered.employeeId, left.employeeId, holder.employeeId]) {
			await fixture.pool.query(
				`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
				 values ($1, $2, $3, $4)`,
				[organizationId, grantId, employeeId, owner],
			);
		}
		const ids = [holder, covered, left, outsider].map((employee) => employee.employeeId);

		actAs(holder.userId);
		const refused = await actions.commitOpeningBalanceUploadAction({
			csv: csv(
				`F-1,${openingDay},1:00,Carried over`,
				`F-2,${openingDay},2:00,Carried over`,
				`F-3,${openingDay},3:00,Carried over`,
				`F-HOLDER,${openingDay},4:00,My own`,
			),
		});
		expect(refused).toMatchObject({ success: true, data: { status: "has_errors" } });
		const rows = refused.success && refused.data.status === "has_errors" ? refused.data.rows : [];
		expect(rows.map(({ row, employee, errors }) => ({ row, employee, errors }))).toEqual([
			{ row: 2, employee: expect.objectContaining({ id: covered.employeeId }), errors: [] },
			{
				row: 3,
				employee: expect.objectContaining({ id: left.employeeId, isActive: false }),
				errors: [],
			},
			// Outside the scope: the employee is not named.
			{ row: 4, employee: null, errors: [{ code: "out_of_scope" }] },
			{ row: 5, employee: null, errors: [{ code: "out_of_scope" }] },
		]);
		expect(await openingBalancesInEffect(ids)).toEqual([]);

		const committed = await actions.commitOpeningBalanceUploadAction({
			csv: csv(`F-1,${openingDay},1:00,Carried over`, `F-2,${openingDay},2:00,Carried over`),
		});
		expect(committed).toMatchObject({ success: true, data: { status: "committed", created: 2 } });
		expect(await auditRows(ids)).toEqual([
			expect.objectContaining({
				performed_by: holder.userId,
				metadata: expect.objectContaining({ via: "payroll_access_grant", grantId }),
			}),
			expect.objectContaining({
				performed_by: holder.userId,
				metadata: expect.objectContaining({ via: "payroll_access_grant", grantId }),
			}),
		]);
		// The balance worker skips employees who have left; the upload refreshes them.
		expect(
			await workBalance.getEmployeeWorkBalance({ employeeId: left.employeeId, organizationId }),
		).toMatchObject({ adjustmentMinutes: 120 });
	});

	it("refuses managers and employees, and resolves numbers in the uploader's organization only", async () => {
		await seedNumbered("G-1");
		const manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		const member = await fixture.seedEmployee();
		const file = csv(`G-1,${openingDay},1:00,Carried over`);
		for (const userId of [manager.userId, member.userId]) {
			actAs(userId);
			for (const action of [
				actions.previewOpeningBalanceUploadAction,
				actions.commitOpeningBalanceUploadAction,
			]) {
				expect(await action({ csv: file })).toMatchObject({
					success: false,
					code: "not_permitted",
				});
			}
		}

		const foreignOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		actAs(foreignOwner.userId, otherOrganizationId);
		expect(await actions.commitOpeningBalanceUploadAction({ csv: file })).toMatchObject({
			success: true,
			data: { status: "has_errors", rows: [{ errors: [{ code: "unknown_employee" }] }] },
		});
	});

	it("refuses a file without the required columns as a whole", async () => {
		actAs(admin.userId);
		expect(
			await actions.previewOpeningBalanceUploadAction({ csv: "employee_number,day\n1,2026-01-01" }),
		).toEqual({
			success: true,
			data: {
				status: "invalid_file",
				code: "missing_columns",
				missingColumns: ["balance", "reason"],
			},
		});
	});
});
