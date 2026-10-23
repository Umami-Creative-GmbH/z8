/**
 * PostgreSQL contract (#1438, Organization ADR 0006): saving a former employee
 * into a role is refused on the server, whatever the picker offered. A
 * deactivated employee and one past a due departure are former; a current
 * employee still saves. Removals and kept holders are covered next to each
 * surface's own suite.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/effect/errors";
import { savePayrollAccessGrant } from "@/lib/payroll-access/grant-store";
import { savePersonnelFileOfficerGrant } from "@/lib/personnel-file/officer-grant-store";
import { saveExpenseOfficerGrant } from "@/lib/travel-expenses/expense-officer-grant-store";
import { FORMER_EMPLOYEE_REFUSAL } from "./current-roster-guard";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const session = vi.hoisted(() => ({ userId: "", organizationId: "" }));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: session.userId, role: "user" },
				session: {
					id: `session-${session.userId}`,
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/organization-mfa/organization-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/organization-mfa/organization-access")>()),
	canAccessOrganization: async () => true,
}));

const holidays = await import("@/app/[locale]/(app)/settings/holidays/actions");
const surcharges = await import("@/app/[locale]/(app)/settings/surcharges/actions");
const changePolicies = await import("@/app/[locale]/(app)/settings/change-policies/actions");
const workCategories = await import("@/app/[locale]/(app)/settings/work-categories/actions");
const approvalPolicies = await import("@/app/[locale]/(app)/settings/approval-policies/actions");

describe("role saves refuse former employees", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	let fixture: LifecycleDatabaseFixture;
	let current: SeededEmployee;
	let deactivated: SeededEmployee;
	let departed: SeededEmployee;
	let formers: Array<[string, SeededEmployee]>;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		current = await fixture.seedEmployee();
		deactivated = await fixture.seedEmployee({ isActive: false });
		departed = await fixture.seedEmployee();
		// A scheduled departure past its cutoff: former, though still marked active.
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', '2026-09-15T00:00:00Z', $4,
			         gen_random_uuid(), 'test', 1, 'pending')`,
			[
				fixture.organizationId,
				departed.employeeId,
				departed.employmentPeriodId,
				fixture.ownerUserId,
			],
		);
		formers = [
			["deactivated", deactivated],
			["past a due departure", departed],
		];
		session.userId = fixture.ownerUserId;
		session.organizationId = fixture.organizationId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function insertRow(sql: string, values: unknown[]): Promise<string> {
		const id = randomUUID();
		await fixture.pool.query(sql, [id, ...values]);
		return id;
	}

	describe("grants", () => {
		const inTransaction = <T>(work: (tx: never) => Promise<T>) =>
			fixture.db.transaction((tx) => work(tx as never));

		const expenseOfficer = (officer: string, employeeIds: string[] = []) =>
			inTransaction((tx) =>
				saveExpenseOfficerGrant(tx, {
					organizationId: fixture.organizationId,
					actorUserId: fixture.ownerUserId,
					grant: {
						officerEmployeeId: officer,
						scope: employeeIds.length > 0 ? "specific" : "all",
						teamIds: [],
						employeeIds,
						canExport: true,
						canRecordReimbursements: true,
					},
				}),
			);

		const payrollAccess = (officer: string, employeeIds: string[] = []) =>
			inTransaction((tx) =>
				savePayrollAccessGrant(tx, {
					organizationId: fixture.organizationId,
					actorUserId: fixture.ownerUserId,
					grant: {
						payrollEmployeeId: officer,
						scope: employeeIds.length > 0 ? "specific" : "all",
						teamIds: [],
						employeeIds,
					},
				}),
			);

		const personnelFileOfficer = (officer: string, employeeIds: string[] = []) =>
			inTransaction((tx) =>
				savePersonnelFileOfficerGrant(tx, {
					organizationId: fixture.organizationId,
					actorUserId: fixture.ownerUserId,
					grant: {
						officerEmployeeId: officer,
						scope: employeeIds.length > 0 ? "specific" : "all",
						teamIds: [],
						employeeIds,
						categories: ["payslip"],
					},
				}),
			);

		it.each([
			["expense officer", expenseOfficer],
			["payroll access", payrollAccess],
			["personnel file officer", personnelFileOfficer],
		])("refuses a former %s holder and grants a current one", async (_label, save) => {
			for (const [, former] of formers) {
				await expect(save(former.employeeId)).rejects.toBeInstanceOf(ValidationError);
			}
			const holder = await fixture.seedEmployee();
			await expect(save(holder.employeeId)).resolves.toMatchObject({ outcome: "created" });
		});

		it("names the officer field and the current-roster refusal code", async () => {
			await expect(expenseOfficer(deactivated.employeeId)).rejects.toMatchObject({
				field: "officerEmployeeId",
				refusal: FORMER_EMPLOYEE_REFUSAL,
			});
		});

		it("lets expense and personnel file officers name former employees, whose files and reports stay open", async () => {
			const officer = await fixture.seedEmployee();
			await expect(
				expenseOfficer(officer.employeeId, [deactivated.employeeId]),
			).resolves.toMatchObject({
				outcome: "created",
			});
			await expect(
				personnelFileOfficer(officer.employeeId, [departed.employeeId]),
			).resolves.toMatchObject({ outcome: "created" });
		});

		it("refuses newly naming a former employee in payroll scope and keeps one already named", async () => {
			const officer = await fixture.seedEmployee();
			const leaver = await fixture.seedEmployee();
			for (const [, former] of formers) {
				await expect(payrollAccess(officer.employeeId, [former.employeeId])).rejects.toBeInstanceOf(
					ValidationError,
				);
			}
			await payrollAccess(officer.employeeId, [leaver.employeeId]);
			await fixture.pool.query("update employee set is_active = false where id = $1", [
				leaver.employeeId,
			]);
			await expect(
				payrollAccess(officer.employeeId, [leaver.employeeId, current.employeeId]),
			).resolves.toMatchObject({ outcome: "changed" });
		});
	});

	describe("policy assignments", () => {
		async function holidayCategory() {
			return insertRow(
				`insert into holiday_category (id, organization_id, type, name, updated_at)
				 values ($1, $2, 'company_holiday', $3, now())`,
				[fixture.organizationId, `Category ${randomUUID()}`],
			);
		}

		it("refuses a holiday category assignment for a former employee", async () => {
			const categoryId = await holidayCategory();
			for (const [, former] of formers) {
				expect(
					await holidays.createHolidayCategoryAssignment({
						categoryId,
						assignmentType: "employee",
						employeeId: former.employeeId,
					}),
				).toMatchObject({ success: false, code: "ValidationError" });
			}
			expect(
				await holidays.createHolidayCategoryAssignment({
					categoryId,
					assignmentType: "employee",
					employeeId: current.employeeId,
				}),
			).toMatchObject({ success: true });
		});

		it("refuses a holiday assignment for a former or foreign employee", async () => {
			const categoryId = await holidayCategory();
			const holidayId = await insertRow(
				`insert into holiday (id, organization_id, category_id, name, start_date, end_date, created_by, updated_at)
				 values ($1, $2, $3, 'Founders day', '2026-12-01', '2026-12-01', $4, now())`,
				[fixture.organizationId, categoryId, fixture.ownerUserId],
			);
			const otherOrganizationId = await fixture.createOrganization();
			const foreigner = await fixture.seedEmployee({ organizationId: otherOrganizationId });
			for (const employeeId of [
				...formers.map(([, former]) => former.employeeId),
				foreigner.employeeId,
			]) {
				expect(
					await holidays.createHolidayAssignment({
						holidayId,
						assignmentType: "employee",
						employeeId,
					}),
				).toMatchObject({ success: false, code: "ValidationError" });
			}
			expect(
				await holidays.createHolidayAssignment({
					holidayId,
					assignmentType: "employee",
					employeeId: current.employeeId,
				}),
			).toMatchObject({ success: true });
		});

		it("refuses a surcharge assignment for a former employee", async () => {
			const modelId = await insertRow(
				`insert into surcharge_model (id, organization_id, name, created_by, updated_at)
				 values ($1, $2, $3, $4, now())`,
				[fixture.organizationId, `Model ${randomUUID()}`, fixture.ownerUserId],
			);
			const assign = (employeeId: string) =>
				surcharges.createSurchargeAssignment(fixture.organizationId, {
					modelId,
					assignmentType: "employee",
					employeeId,
					effectiveFrom: null,
					effectiveUntil: null,
					isActive: true,
				});
			for (const [, former] of formers) {
				expect(await assign(former.employeeId)).toEqual({
					success: false,
					error: "Former employees can't be assigned. Choose someone on the current roster.",
				});
			}
			expect(await assign(current.employeeId)).toMatchObject({ success: true });
		});

		it("refuses a change policy assignment for a former employee", async () => {
			const policyId = await insertRow(
				`insert into change_policy (id, organization_id, name, created_by, updated_at)
				 values ($1, $2, $3, $4, now())`,
				[fixture.organizationId, `Policy ${randomUUID()}`, fixture.ownerUserId],
			);
			const assign = (employeeId: string) =>
				changePolicies.createChangePolicyAssignment(fixture.organizationId, {
					policyId,
					assignmentType: "employee",
					employeeId,
				});
			for (const [, former] of formers) {
				expect(await assign(former.employeeId)).toMatchObject({
					success: false,
					code: "ValidationError",
				});
			}
			expect(await assign(current.employeeId)).toMatchObject({ success: true });
		});

		it("refuses a work category set assignment for a former employee", async () => {
			const setId = await insertRow(
				`insert into work_category_set (id, organization_id, name, created_by, updated_at)
				 values ($1, $2, $3, $4, now())`,
				[fixture.organizationId, `Set ${randomUUID()}`, fixture.ownerUserId],
			);
			const assign = (employeeId: string) =>
				workCategories.createSetAssignment({
					organizationId: fixture.organizationId,
					setId,
					assignmentType: "employee",
					employeeId,
				});
			for (const [, former] of formers) {
				expect(await assign(former.employeeId)).toMatchObject({
					success: false,
					code: "ValidationError",
				});
			}
			expect(await assign(current.employeeId)).toMatchObject({ success: true });
		});

		it("refuses a former employee as approval employee group member", async () => {
			for (const [, former] of formers) {
				expect(
					await approvalPolicies.upsertEmployeeGroup({
						name: `Group ${randomUUID()}`,
						isActive: true,
						employeeIds: [current.employeeId, former.employeeId],
					}),
				).toMatchObject({ success: false });
			}
			expect(
				await approvalPolicies.upsertEmployeeGroup({
					name: `Group ${randomUUID()}`,
					isActive: true,
					employeeIds: [current.employeeId],
				}),
			).toEqual({ success: true });
		});
	});
});
