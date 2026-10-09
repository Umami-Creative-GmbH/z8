/**
 * #750: a departure revokes the expense officer grant and the payroll access
 * grant the departing employee holds, with audit entries that name the
 * departure, in the departure's transaction. A rehire restores neither, and
 * grants that only name the departed employee in their scope stay as they are.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { travelExpenseReport } from "@/db/schema";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { savePayrollAccessGrant } from "@/lib/payroll-access/grant-store";
import {
	loadActivePersonnelFileOfficerGrant,
	savePersonnelFileOfficerGrant,
} from "@/lib/personnel-file/officer-grant-store";
import { officerScopeOf } from "@/lib/travel-expenses/expense-officer-grant";
import {
	loadActiveExpenseOfficerGrant,
	saveExpenseOfficerGrant,
} from "@/lib/travel-expenses/expense-officer-grant-store";
import { reportInOfficerScope } from "@/lib/travel-expenses/officer-scope-read";
import { createDepartureCommands } from "./commands";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";
import type { DepartureClockOutPort, LifecycleActor } from "./types";

const clockOut: DepartureClockOutPort = {
	async close() {
		return { kind: "not_running" };
	},
};

describe("departure access grants", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = parseInstant("2026-09-14T08:00:00Z");

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function commands() {
		return createDepartureCommands({
			db: fixture.db,
			clock: { nowInstant: () => now },
			clockOut,
		});
	}

	function owner(): LifecycleActor {
		return { userId: fixture.ownerUserId, organizationId: fixture.organizationId };
	}

	async function offboardNow(employeeId: string, at = "2026-09-14T09:30:00Z") {
		now = parseInstant(at);
		const result = await commands().offboardNow(owner(), {
			employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		const departure = await fixture.pool.query<{ id: string; status: string }>(
			`select id, status from employee_departure where employee_id = $1 order by created_at desc limit 1`,
			[employeeId],
		);
		expect(departure.rows[0]?.status).toBe("effective");
		return { result, departureId: departure.rows[0]?.id ?? "" };
	}

	function grantExpenseOfficer(officer: SeededEmployee, employeeIds: string[] = []) {
		return fixture.db.transaction((tx) =>
			saveExpenseOfficerGrant(tx, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				grant: {
					officerEmployeeId: officer.employeeId,
					scope: employeeIds.length > 0 ? "specific" : "all",
					teamIds: [],
					employeeIds,
					canExport: true,
					canRecordReimbursements: true,
				},
			}),
		);
	}

	function grantPayrollAccess(officer: SeededEmployee, employeeIds: string[] = []) {
		return fixture.db.transaction((tx) =>
			savePayrollAccessGrant(tx, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				grant: {
					payrollEmployeeId: officer.employeeId,
					scope: employeeIds.length > 0 ? "specific" : "all",
					teamIds: [],
					employeeIds,
				},
			}),
		);
	}

	async function grantState(table: "expense_officer_grant" | "payroll_access_grant", id: string) {
		const result = await fixture.pool.query<{ is_active: boolean; updated_by: string }>(
			`select is_active, updated_by from ${table} where id = $1`,
			[id],
		);
		return result.rows[0];
	}

	async function auditEntries(entityId: string) {
		const result = await fixture.pool.query<{
			action: string;
			performed_by: string;
			employee_id: string;
			changes: string;
			metadata: string | null;
		}>(
			`select action, performed_by, employee_id, changes, metadata from audit_log
			 where entity_id = $1 order by timestamp, action`,
			[entityId],
		);
		return result.rows.map((row) => ({
			action: row.action,
			performedBy: row.performed_by,
			employeeId: row.employee_id,
			changes: JSON.parse(row.changes),
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	it("revokes both grants the departing officer holds, with audit entries naming the departure", async () => {
		const officer = await fixture.seedEmployee();
		const expense = await grantExpenseOfficer(officer);
		const payroll = await grantPayrollAccess(officer);

		const { departureId } = await offboardNow(officer.employeeId);

		expect(await grantState("expense_officer_grant", expense.grantId)).toEqual({
			is_active: false,
			updated_by: fixture.ownerUserId,
		});
		expect(await grantState("payroll_access_grant", payroll.grantId)).toEqual({
			is_active: false,
			updated_by: fixture.ownerUserId,
		});
		const departure = {
			reason: "employee_departure",
			departureId,
			employmentPeriodId: officer.employmentPeriodId,
		};
		expect((await auditEntries(expense.grantId)).at(-1)).toEqual({
			action: "expense_officer.grant_revoked",
			performedBy: fixture.ownerUserId,
			employeeId: officer.employeeId,
			changes: {
				from: {
					scope: "all",
					teamIds: [],
					employeeIds: [],
					canExport: true,
					canRecordReimbursements: true,
				},
				to: null,
			},
			metadata: departure,
		});
		expect((await auditEntries(payroll.grantId)).at(-1)).toEqual({
			action: "payroll_access.grant_revoked",
			performedBy: fixture.ownerUserId,
			employeeId: officer.employeeId,
			changes: { from: { scope: "all", teamIds: [], employeeIds: [] }, to: null },
			metadata: departure,
		});
	});

	it("departs an employee who holds no grant without writing grant audit entries", async () => {
		const employee = await fixture.seedEmployee();

		await offboardNow(employee.employeeId);

		const audits = await fixture.pool.query(
			`select 1 from audit_log where employee_id = $1 and action like '%grant%'`,
			[employee.employeeId],
		);
		expect(audits.rows).toHaveLength(0);
	});

	it("never restores either grant on rehire", async () => {
		const officer = await fixture.seedEmployee();
		const expense = await grantExpenseOfficer(officer);
		const payroll = await grantPayrollAccess(officer);
		await offboardNow(officer.employeeId);
		const policy = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[fixture.organizationId, `Policy ${randomUUID()}`, fixture.ownerUserId],
		);

		now = parseInstant("2026-11-02T08:00:00Z");
		await commands().rehireEmployee(owner(), {
			employeeId: officer.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: officer.employmentPeriodId,
			role: "employee",
			teamId: null,
			primaryManagerId: fixture.ownerEmployeeId,
			workPolicyId: policy.rows[0]?.id ?? "",
			weeklyContractMinutes: 2400,
			contractType: "fixed",
			workModel: "onsite",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: "Returning",
		});

		const active = await fixture.pool.query(
			`select id from expense_officer_grant where officer_employee_id = $1 and is_active
			 union all
			 select id from payroll_access_grant where payroll_employee_id = $1 and is_active`,
			[officer.employeeId],
		);
		expect(active.rows).toHaveLength(0);
		expect(await grantState("expense_officer_grant", expense.grantId)).toMatchObject({
			is_active: false,
		});
		expect(await grantState("payroll_access_grant", payroll.grantId)).toMatchObject({
			is_active: false,
		});
		expect(
			await loadActiveExpenseOfficerGrant(fixture.db, {
				organizationId: fixture.organizationId,
				officerEmployeeId: officer.employeeId,
			}),
		).toBeNull();
	});

	it("revokes the grants when a scheduled departure takes effect at its cutoff", async () => {
		const officer = await fixture.seedEmployee();
		const expense = await grantExpenseOfficer(officer);
		const payroll = await grantPayrollAccess(officer);
		now = parseInstant("2026-09-14T08:00:00Z");
		const scheduled = await commands().scheduleDeparture(owner(), {
			employeeId: officer.employeeId,
			requestId: randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-09-30",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		const identity = {
			organizationId: fixture.organizationId,
			employeeId: officer.employeeId,
			employmentPeriodId: officer.employmentPeriodId,
			departureId: scheduled.departureId,
			revision: scheduled.revision,
		};

		expect(await commands().executeDeparture(identity)).toEqual({ status: "not_due" });
		expect(await grantState("expense_officer_grant", expense.grantId)).toMatchObject({
			is_active: true,
		});

		now = parseInstant("2026-10-02T00:00:00Z");
		await expect(commands().executeDeparture(identity)).resolves.toMatchObject({
			status: "effective",
		});
		expect(await grantState("expense_officer_grant", expense.grantId)).toMatchObject({
			is_active: false,
		});
		expect(await grantState("payroll_access_grant", payroll.grantId)).toMatchObject({
			is_active: false,
		});
		expect((await auditEntries(payroll.grantId)).at(-1)?.metadata).toEqual({
			reason: "employee_departure",
			departureId: scheduled.departureId,
			employmentPeriodId: officer.employmentPeriodId,
		});
	});

	async function insertReport(employee: SeededEmployee, approvalTeamIds: string[] | null) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into travel_expense_report
			 (organization_id, employee_id, kind, status, reimbursement_currency, submission_count,
			  submitted_at, decided_at, approval_team_ids, created_by)
			 values ($1, $2, 'standalone', 'approved', 'EUR', 1, now(), now(), $3::uuid[], $4)
			 returning id`,
			[fixture.organizationId, employee.employeeId, approvalTeamIds, employee.userId],
		);
		return result.rows[0]?.id ?? "";
	}

	async function reportsInScopeOf(officer: SeededEmployee, reportIds: string[]) {
		const grant = await loadActiveExpenseOfficerGrant(fixture.db, {
			organizationId: fixture.organizationId,
			officerEmployeeId: officer.employeeId,
		});
		if (!grant) return [];
		const rows = await fixture.db
			.select({ id: travelExpenseReport.id })
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.organizationId, fixture.organizationId),
					inArray(travelExpenseReport.id, reportIds),
					reportInOfficerScope(officerScopeOf(grant)),
				),
			);
		return rows.map((row) => row.id);
	}

	it("keeps grants that name the departed employee, so their reports stay in scope", async () => {
		const leaver = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		const officer = await fixture.seedEmployee();
		const teamOfficer = await fixture.seedEmployee();
		const teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $2, $3, now())`,
			[teamId, fixture.organizationId, `Team ${teamId}`],
		);
		const expense = await grantExpenseOfficer(officer, [leaver.employeeId]);
		const payroll = await grantPayrollAccess(officer, [leaver.employeeId]);
		await fixture.db.transaction((tx) =>
			saveExpenseOfficerGrant(tx, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				grant: {
					officerEmployeeId: teamOfficer.employeeId,
					scope: "specific",
					teamIds: [teamId],
					employeeIds: [],
					canExport: false,
					canRecordReimbursements: true,
				},
			}),
		);
		const leaverNamedReport = await insertReport(leaver, null);
		const leaverTeamReport = await insertReport(leaver, [teamId]);
		const colleagueReport = await insertReport(colleague, null);
		const reportIds = [leaverNamedReport, leaverTeamReport, colleagueReport];

		await offboardNow(leaver.employeeId);

		expect(await grantState("expense_officer_grant", expense.grantId)).toMatchObject({
			is_active: true,
		});
		expect(await grantState("payroll_access_grant", payroll.grantId)).toMatchObject({
			is_active: true,
		});
		const payrollNamed = await fixture.pool.query(
			`select 1 from payroll_access_employee where grant_id = $1 and employee_id = $2`,
			[payroll.grantId, leaver.employeeId],
		);
		expect(payrollNamed.rows).toHaveLength(1);
		expect((await reportsInScopeOf(officer, reportIds)).toSorted()).toEqual(
			[leaverNamedReport, leaverTeamReport].toSorted(),
		);
		expect(await reportsInScopeOf(teamOfficer, reportIds)).toEqual([leaverTeamReport]);
		expect(await auditEntries(expense.grantId)).toHaveLength(1);
		expect(await auditEntries(payroll.grantId)).toHaveLength(1);
	});

	function grantPersonnelFileOfficer(officer: SeededEmployee, employeeIds: string[] = []) {
		return fixture.db.transaction((tx) =>
			savePersonnelFileOfficerGrant(tx, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				grant: {
					officerEmployeeId: officer.employeeId,
					scope: employeeIds.length > 0 ? "specific" : "all",
					teamIds: [],
					employeeIds,
					categories: ["payslip", "sick_note"],
				},
			}),
		);
	}

	async function personnelFileGrantState(id: string) {
		const result = await fixture.pool.query<{ is_active: boolean; updated_by: string }>(
			"select is_active, updated_by from personnel_file_officer_grant where id = $1",
			[id],
		);
		return result.rows[0];
	}

	it("revokes the personnel file officer grant the departing officer holds (#866)", async () => {
		const officer = await fixture.seedEmployee();
		const grant = await grantPersonnelFileOfficer(officer);

		const { departureId } = await offboardNow(officer.employeeId);

		expect(await personnelFileGrantState(grant.grantId)).toEqual({
			is_active: false,
			updated_by: fixture.ownerUserId,
		});
		expect((await auditEntries(grant.grantId)).at(-1)).toEqual({
			action: "personnel_file.grant_revoked",
			performedBy: fixture.ownerUserId,
			employeeId: officer.employeeId,
			changes: {
				from: { scope: "all", teamIds: [], employeeIds: [], categories: ["payslip", "sick_note"] },
				to: null,
			},
			metadata: {
				reason: "employee_departure",
				departureId,
				employmentPeriodId: officer.employmentPeriodId,
			},
		});
		expect(
			await loadActivePersonnelFileOfficerGrant(fixture.db, {
				organizationId: fixture.organizationId,
				officerEmployeeId: officer.employeeId,
			}),
		).toBeNull();
	});

	it("leaves personnel file officer grants that name the departed employee unchanged (#866)", async () => {
		const leaver = await fixture.seedEmployee();
		const officer = await fixture.seedEmployee();
		const grant = await grantPersonnelFileOfficer(officer, [leaver.employeeId]);

		await offboardNow(leaver.employeeId);

		expect(await personnelFileGrantState(grant.grantId)).toMatchObject({ is_active: true });
		const named = await fixture.pool.query(
			"select 1 from personnel_file_officer_employee where grant_id = $1 and employee_id = $2",
			[grant.grantId, leaver.employeeId],
		);
		expect(named.rows).toHaveLength(1);
		expect(await auditEntries(grant.grantId)).toHaveLength(1);
		const active = await loadActivePersonnelFileOfficerGrant(fixture.db, {
			organizationId: fixture.organizationId,
			officerEmployeeId: officer.employeeId,
		});
		expect(active?.employeeIds).toEqual([leaver.employeeId]);
	});
});
