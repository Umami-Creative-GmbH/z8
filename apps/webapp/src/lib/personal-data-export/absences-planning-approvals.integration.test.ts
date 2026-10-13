/**
 * #1168: the Absences, Planning and Approvals categories of a personal data
 * export against a disposable PostgreSQL database. Data is seeded directly;
 * the collectors are called the way the export worker calls them.
 */

import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import type { CollectedCategory, PersonalDataExportScope, PersonalDataRow } from "./collector";

const { db } = await import("@/db");
const { absencesCollector } = await import("./collectors/absences");
const { planningCollector } = await import("./collectors/planning");
const { approvalsCollector } = await import("./collectors/approvals");
const { PERSONAL_DATA_COLLECTORS } = await import("./collectors");
const { streamPersonalDataArchive } = await import("./archive");

const ORG = "t1168-org";
const OTHER_ORG = "t1168-other";

const ids = {
	ada: "11680000-0000-4000-8000-000000000001",
	carl: "11680000-0000-4000-8000-000000000002",
	olga: "11680000-0000-4000-8000-000000000003",
	dora: "11680000-0000-4000-8000-000000000004",
	adaOther: "11680000-0000-4000-8000-000000000005",
	categorySick: "11680000-0000-4000-8000-0000000000a1",
	categoryVacation: "11680000-0000-4000-8000-0000000000a2",
	categoryOther: "11680000-0000-4000-8000-0000000000a3",
	absenceAda: "11680000-0000-4000-8000-0000000000b1",
	absenceCarl: "11680000-0000-4000-8000-0000000000b2",
	absenceOther: "11680000-0000-4000-8000-0000000000b3",
	absenceDora: "11680000-0000-4000-8000-0000000000b4",
	location: "11680000-0000-4000-8000-0000000000c1",
	subarea: "11680000-0000-4000-8000-0000000000c2",
	shiftAda: "11680000-0000-4000-8000-0000000000c3",
	shiftCarl: "11680000-0000-4000-8000-0000000000c4",
	requestAdaOwn: "11680000-0000-4000-8000-0000000000d1",
	requestCarl: "11680000-0000-4000-8000-0000000000d2",
	requestDora: "11680000-0000-4000-8000-0000000000d3",
	requestOther: "11680000-0000-4000-8000-0000000000d4",
	workflowAda: "11680000-0000-4000-8000-0000000000e1",
	stageAda: "11680000-0000-4000-8000-0000000000e2",
	workflowCarl: "11680000-0000-4000-8000-0000000000e3",
	stageCarl: "11680000-0000-4000-8000-0000000000e4",
	carlCorrectedEntry: "11680000-0000-4000-8000-0000000000e5",
	vacationPolicy: "11680000-0000-4000-8000-0000000000f1",
} as const;

const admin = integrationAdminPool();

function scopeFor(
	kind: PersonalDataExportScope["kind"],
	organizationId = ORG,
	employeeId: string = ids.ada,
): PersonalDataExportScope {
	return { organizationId, employeeId, userId: "t1168-ada", kind };
}

async function collectAll(scope: PersonalDataExportScope) {
	const [absences, planning, approvals] = [
		await absencesCollector.collect(db, scope),
		await planningCollector.collect(db, scope),
		await approvalsCollector.collect(db, scope),
	];
	return { absences, planning, approvals };
}

function table(category: CollectedCategory, key: string): PersonalDataRow[] {
	const part = category.parts.find((candidate) => candidate.key === key);
	if (part?.kind !== "table") throw new Error(`no table part ${key}`);
	return part.rows;
}

async function cleanup() {
	for (const org of [ORG, OTHER_ORG]) {
		await admin.query("delete from organization where id = $1", [org]);
	}
	await admin.query('delete from "user" where id like $1', ["t1168-%"]);
}

async function seedPerson(
	organizationId: string,
	employeeId: string,
	name: string,
	display: string,
) {
	await admin.query(
		`insert into "user" (id, name, email, created_at, updated_at) values ($1, $2, $3, now(), now())
		 on conflict (id) do nothing`,
		[`t1168-${name}`, display, `t1168-${name}@example.test`],
	);
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, is_active, updated_at)
		 values ($1, $2, $3, 'employee', true, now())`,
		[employeeId, `t1168-${name}`, organizationId],
	);
}

describe("personal data export: absences, planning and approvals (#1168)", () => {
	beforeAll(async () => {
		await cleanup();
		for (const [organizationId, name] of [
			[ORG, "Acme GmbH"],
			[OTHER_ORG, "Other AG"],
		]) {
			await admin.query(
				`insert into organization (id, name, slug, timezone, created_at) values ($1, $2, $1, 'Europe/Berlin', now())`,
				[organizationId, name],
			);
		}
		await seedPerson(ORG, ids.ada, "ada", "Ada Lovelace");
		await seedPerson(ORG, ids.carl, "carl", "Carl Colleague");
		await seedPerson(ORG, ids.olga, "olga", "Olga Owner");
		await seedPerson(ORG, ids.dora, "dora", "Dora Deputy");
		await seedPerson(OTHER_ORG, ids.adaOther, "ada", "Ada Lovelace");

		// Absences: Ada's sick leave, Carl's vacation (Ada approved it), Dora's, and one elsewhere.
		await admin.query(
			`insert into absence_category (id, organization_id, type, name, updated_at) values
			   ($1, $4, 'sick', 'Sick leave', now()),
			   ($2, $4, 'vacation', 'Vacation', now()),
			   ($3, $5, 'sick', 'Other-org sick leave', now())`,
			[ids.categorySick, ids.categoryVacation, ids.categoryOther, ORG, OTHER_ORG],
		);
		await admin.query(
			`insert into absence_entry (id, employee_id, category_id, start_date, start_period, end_date, end_period,
			   status, notes, sick_detail, organization_id, deputy_employee_id, deputy_assigned_at, approved_by,
			   approved_at, created_at, updated_at) values
			   ($1, $2, $3, '2026-03-02', 'full_day', '2026-03-04', 'am', 'approved', 'Flu', 'with_certificate',
			    $4, $5, '2026-02-27 08:00:00+00', $6, '2026-02-27 09:00:00', '2026-02-27 07:30:00', now())`,
			[ids.absenceAda, ids.ada, ids.categorySick, ORG, ids.dora, ids.olga],
		);
		await admin.query(
			`insert into absence_entry (id, employee_id, category_id, start_date, end_date, status, notes,
			   organization_id, approved_by, approved_at, updated_at) values
			   ($1, $2, $3, '2026-05-04', '2026-05-08', 'approved', 'Carl private holiday plans', $4, $5,
			    '2026-04-20 10:00:00', now()),
			   ($6, $7, $3, '2026-05-11', '2026-05-12', 'rejected', 'Dora private plans', $4, null, null, now())`,
			[ids.absenceCarl, ids.carl, ids.categoryVacation, ORG, ids.ada, ids.absenceDora, ids.dora],
		);
		await admin.query(
			`insert into absence_entry (id, employee_id, category_id, start_date, end_date, status, notes,
			   organization_id, updated_at) values ($1, $2, $3, '2026-03-02', '2026-03-03', 'approved',
			   'Other-org absence', $4, now())`,
			[ids.absenceOther, ids.adaOther, ids.categoryOther, OTHER_ORG],
		);
		await admin.query(
			`insert into employee_vacation_allowance (employee_id, year, custom_annual_days, custom_carryover_days, updated_at)
			 values ($1, 2026, '28', '3.5', now()), ($2, 2026, '99', null, now())`,
			[ids.ada, ids.adaOther],
		);
		await admin.query(
			`insert into vacation_adjustment (employee_id, year, days, reason, kind, adjusted_by, created_at) values
			   ($1, 2026, '2.00', 'Overtime compensation', 'manual', $2, '2026-04-01 12:00:00'),
			   ($3, 2026, '1.00', 'Other-org adjustment', 'manual', $3, '2026-04-01 12:00:00')`,
			[ids.ada, ids.olga, ids.adaOther],
		);
		await admin.query(
			`insert into vacation_allowance (id, organization_id, name, start_date, default_annual_days, accrual_type,
			   statutory_minimum_days, created_by, updated_at) values
			   ($1, $2, 'Standard 30 days', '2026-01-01', '30', 'annual', '20', 't1168-olga', now())`,
			[ids.vacationPolicy, ORG],
		);
		await admin.query(
			`insert into vacation_policy_assignment (policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, 'organization', 0, 't1168-olga', now())`,
			[ids.vacationPolicy, ORG],
		);

		// Planning: Ada's shift, Carl's shift, a swap Ada asked for and one Carl asked of her.
		await admin.query(
			`insert into location (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Berlin HQ', 't1168-olga', now())`,
			[ids.location, ORG],
		);
		await admin.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at) values ($1, $2, 'Front desk', 't1168-olga', now())`,
			[ids.subarea, ids.location],
		);
		await admin.query(
			`insert into shift (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status,
			   published_at, published_by, notes, created_by, updated_at) values
			   ($1, $3, $4, $5, '2026-06-01 00:00:00', '09:00', '17:00', 'published', '2026-05-20 08:00:00',
			    't1168-olga', 'Opening shift', 't1168-olga', now()),
			   ($2, $3, $6, $5, '2026-06-02 00:00:00', '06:00', '14:00', 'published', null, null,
			    'Carl shift note', 't1168-olga', now())`,
			[ids.shiftAda, ids.shiftCarl, ORG, ids.ada, ids.subarea, ids.carl],
		);
		await admin.query(
			`insert into shift_request (organization_id, shift_id, type, status, requester_id, target_employee_id,
			   reason, reason_category, notes, approver_id, approved_at, created_at, updated_at) values
			   ($1, $2, 'swap', 'approved', $3, $4, 'Dentist', 'other', 'Thanks!', $5, '2026-05-25 10:00:00',
			    '2026-05-24 10:00:00', now()),
			   ($1, $6, 'swap', 'pending', $4, $3, 'Carl childcare secret', 'childcare', 'Carl note', null, null,
			    '2026-05-26 10:00:00', now())`,
			[ORG, ids.shiftAda, ids.ada, ids.carl, ids.olga, ids.shiftCarl],
		);

		// Legacy approvals: Ada's own request, Carl's (Ada decided), Dora's (Ada decided as Olga's deputy).
		await admin.query(
			`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by, approver_id,
			   status, reason, notes, approved_at, created_at, updated_at) values
			   ($1, $4, 'absence_entry', $5, $6, $7, 'approved', 'Ada own reason', 'Ada own note',
			    '2026-02-27 09:00:00', '2026-02-27 07:30:00', now()),
			   ($2, $4, 'absence_entry', $8, $9, $6, 'approved', 'Carl private reason', 'Carl note',
			    '2026-04-20 10:00:00', '2026-04-19 10:00:00', now()),
			   ($3, $4, 'absence_entry', $10, $11, $7, 'rejected', 'Dora private reason', null,
			    null, '2026-04-21 10:00:00', '2026-04-22 11:00:00')`,
			[
				ids.requestAdaOwn,
				ids.requestCarl,
				ids.requestDora,
				ORG,
				ids.absenceAda,
				ids.ada,
				ids.olga,
				ids.absenceCarl,
				ids.carl,
				ids.absenceDora,
				ids.dora,
			],
		);
		await admin.query(
			`insert into approval_deputy_decision (organization_id, deputy_employee_id, acting_for_employee_id,
			   absence_start_date, absence_end_date, authority, entity_type, entity_id, approval_request_id,
			   decision, decided_at) values
			   ($1, $2, $3, '2026-04-20', '2026-04-24', 'legacy', 'absence_entry', $4, $5, 'rejected',
			    '2026-04-22 11:00:00+00')`,
			[ORG, ids.ada, ids.olga, ids.absenceDora, ids.requestDora],
		);
		await admin.query(
			`insert into approval_request (id, organization_id, entity_type, entity_id, requested_by, approver_id,
			   status, reason, updated_at) values ($1, $2, 'absence_entry', $3, $4, $4, 'pending',
			   'Other-org request', now())`,
			[ids.requestOther, OTHER_ORG, ids.absenceOther, ids.adaOther],
		);

		// Canonical approvals: Ada's absence workflow, and Carl's time correction Ada approved.
		await admin.query(
			`insert into approval_workflow (id, organization_id, workflow_type, source_type, source_id,
			   requester_employee_id, status, policy_snapshot, context_snapshot, display_snapshot, submitted_at,
			   completed_at, decision_reason, updated_at) values
			   ($1, $3, 'absence', 'absence_entry', $4, $5, 'approved', '{}', '{}', '{}', '2026-02-27 07:30:00+00',
			    '2026-02-27 09:00:00+00', 'Get well soon', now()),
			   ($2, $3, 'time_correction', 'time_entry', $6, $7, 'approved', '{}', '{}', '{}',
			    '2026-04-23 08:00:00+00', '2026-04-23 09:30:00+00', 'Carl canonical secret', now())`,
			[
				ids.workflowAda,
				ids.workflowCarl,
				ORG,
				ids.absenceAda,
				ids.ada,
				ids.carlCorrectedEntry,
				ids.carl,
			],
		);
		await admin.query(
			`insert into approval_workflow_stage (id, organization_id, workflow_id, stage_order, label,
			   resolver_snapshot, activation_mode, status, activated_at, decided_at, updated_at) values
			   ($1, $3, $4, 1, 'Manager', '{}', 'sequential', 'approved', '2026-02-27 07:30:00+00',
			    '2026-02-27 09:00:00+00', now()),
			   ($2, $3, $5, 1, 'Team lead', '{}', 'sequential', 'approved', '2026-04-23 08:00:00+00',
			    '2026-04-23 09:30:00+00', now())`,
			[ids.stageAda, ids.stageCarl, ORG, ids.workflowAda, ids.workflowCarl],
		);
		await admin.query(
			`insert into approval_stage_assignment (organization_id, workflow_id, stage_id, assignment_sequence,
			   approver_employee_id, status, assigned_at, resolved_at, resolved_by_actor_kind, resolved_by_actor_id,
			   updated_at) values
			   ($1, $2, $3, 1, $4, 'approved', '2026-02-27 07:30:00+00', '2026-02-27 09:00:00+00', 'employee', $4, now()),
			   ($1, $5, $6, 1, $7, 'approved', '2026-04-23 08:00:00+00', '2026-04-23 09:30:00+00', 'employee', $7, now())`,
			[ORG, ids.workflowAda, ids.stageAda, ids.olga, ids.workflowCarl, ids.stageCarl, ids.ada],
		);

		await admin.query(
			`insert into period_submission (organization_id, employee_id, cadence, timezone, start_date, end_date,
			   cadence_start_date, cadence_end_date, range_start, range_end, status, submitted_by, submitted_at,
			   decided_at, decided_by_employee_id) values
			   ($1, $2, 'monthly', 'Europe/Berlin', '2026-03-01', '2026-03-31', '2026-03-01', '2026-03-31',
			    '2026-02-28 23:00:00+00', '2026-03-31 22:00:00+00', 'approved', 't1168-ada',
			    '2026-04-01 08:00:00+00', '2026-04-02 08:00:00+00', $3)`,
			[ORG, ids.ada, ids.olga],
		);
	});

	afterAll(async () => {
		await cleanup();
	});

	it("exports the employee's absences with sick detail, allowances and adjustments with reasons", async () => {
		const { absences } = await collectAll(scopeFor("employee"));

		expect(table(absences, "absences")).toEqual([
			expect.objectContaining({
				id: ids.absenceAda,
				category: "Sick leave",
				category_type: "sick",
				start_date: "2026-03-02",
				start_period: "full_day",
				end_date: "2026-03-04",
				end_period: "am",
				status: "approved",
				sick_detail: "with_certificate",
				notes: "Flu",
				deputy: "Dora Deputy",
				approved_by: "Olga Owner",
				approved_at: "2026-02-27T09:00:00Z",
			}),
		]);
		expect(table(absences, "vacation_allowances")).toEqual([
			expect.objectContaining({
				year: 2026,
				custom_annual_days: "28",
				custom_carryover_days: "3.5",
			}),
		]);
		expect(table(absences, "vacation_policies")).toEqual([
			expect.objectContaining({
				policy: "Standard 30 days",
				assignment_type: "organization",
				valid_from: "2026-01-01",
				default_annual_days: "30",
			}),
		]);
		expect(table(absences, "vacation_adjustments")).toEqual([
			expect.objectContaining({
				year: 2026,
				days: "2.00",
				kind: "manual",
				reason: "Overtime compensation",
				adjusted_by: "Olga Owner",
			}),
		]);
	});

	it("exports the employee's shifts and shift requests, naming a swap partner only", async () => {
		const { planning } = await collectAll(scopeFor("employee"));

		expect(table(planning, "shifts")).toEqual([
			expect.objectContaining({
				id: ids.shiftAda,
				date: "2026-06-01",
				start_time: "09:00",
				end_time: "17:00",
				status: "published",
				location: "Berlin HQ",
				subarea: "Front desk",
				notes: "Opening shift",
				published_by: "Olga Owner",
			}),
		]);
		expect(table(planning, "shift_requests")).toEqual([
			expect.objectContaining({
				type: "swap",
				status: "approved",
				shift_date: "2026-06-01",
				swap_partner: "Carl Colleague",
				reason: "Dentist",
				approver: "Olga Owner",
			}),
		]);
		const received = table(planning, "shift_requests_received");
		expect(received).toEqual([
			expect.objectContaining({
				type: "swap",
				status: "pending",
				shift_date: "2026-06-02",
				shift_start_time: "06:00",
				requested_by: "Carl Colleague",
			}),
		]);
		// The colleague's reasons, notes and shift details stay out.
		const text = JSON.stringify(planning);
		for (const leaked of ["Carl childcare secret", "childcare", "Carl note", "Carl shift note"]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("exports the employee's own requests with status, reasons and approver names", async () => {
		const { approvals } = await collectAll(scopeFor("employee"));

		expect(table(approvals, "requests")).toEqual([
			expect.objectContaining({
				id: ids.requestAdaOwn,
				record_kind: "absence_entry",
				record_id: ids.absenceAda,
				status: "approved",
				reason: "Ada own reason",
				notes: "Ada own note",
				approver: "Olga Owner",
			}),
		]);
		expect(table(approvals, "workflows")).toEqual([
			expect.objectContaining({
				id: ids.workflowAda,
				workflow_type: "absence",
				status: "approved",
				decision_reason: "Get well soon",
				completed_at: "2026-02-27T09:00:00Z",
			}),
		]);
		expect(table(approvals, "workflow_approvers")).toEqual([
			expect.objectContaining({
				workflow_id: ids.workflowAda,
				stage: "Manager",
				approver: "Olga Owner",
				status: "approved",
				decided_by: "Olga Owner",
			}),
		]);
		expect(table(approvals, "period_submissions")).toEqual([
			expect.objectContaining({
				start_date: "2026-03-01",
				end_date: "2026-03-31",
				timezone: "Europe/Berlin",
				status: "approved",
				submitted_by: "Ada Lovelace",
				decided_by: "Olga Owner",
			}),
		]);
	});

	it("records decisions on colleagues' requests with action, time and kind and an opaque id only", async () => {
		const { approvals } = await collectAll(scopeFor("employee"));
		const decisions = table(approvals, "decisions_on_others");

		expect(decisions).toEqual([
			{
				record_kind: "absence_entry",
				authority: "legacy",
				action: "approved",
				acted_at: "2026-04-20T10:00:00Z",
				as_deputy: false,
				other_person: expect.stringMatching(/^person-[0-9a-f]{16}$/),
			},
			{
				record_kind: "absence_entry",
				authority: "legacy",
				action: "rejected",
				acted_at: "2026-04-22T11:00:00Z",
				as_deputy: true,
				other_person: expect.stringMatching(/^person-[0-9a-f]{16}$/),
			},
			{
				record_kind: "time_correction",
				authority: "canonical",
				action: "approved",
				acted_at: "2026-04-23T09:30:00Z",
				as_deputy: false,
				other_person: expect.stringMatching(/^person-[0-9a-f]{16}$/),
			},
		]);
		// Carl is one person: the same opaque id on both of his requests; Dora another.
		expect(decisions[0]?.other_person).toBe(decisions[2]?.other_person);
		expect(decisions[1]?.other_person).not.toBe(decisions[0]?.other_person);

		// None of the colleagues' names, ids, dates or reasons.
		const text = JSON.stringify(approvals);
		for (const leaked of [
			"Carl",
			"Dora",
			ids.carl,
			ids.dora,
			ids.absenceCarl,
			ids.absenceDora,
			ids.carlCorrectedEntry,
			"2026-05-04",
			"2026-05-11",
			"2026-04-24",
			"private",
			"Carl canonical secret",
		]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("holds the same rows in the admin export", async () => {
		const withoutOpaqueIds = (categories: Awaited<ReturnType<typeof collectAll>>) =>
			JSON.stringify(categories).replace(/person-[0-9a-f]{16}/g, "person");
		expect(withoutOpaqueIds(await collectAll(scopeFor("admin")))).toBe(
			withoutOpaqueIds(await collectAll(scopeFor("employee"))),
		);
	});

	it("keeps each organization's rows to that organization", async () => {
		const here = JSON.stringify(await collectAll(scopeFor("employee")));
		for (const leaked of ["Other-org", "Other AG", ids.absenceOther, ids.requestOther]) {
			expect(here, leaked).not.toContain(leaked);
		}

		const elsewhere = await collectAll(scopeFor("employee", OTHER_ORG, ids.adaOther));
		expect(table(elsewhere.absences, "absences").map((row) => row.notes)).toEqual([
			"Other-org absence",
		]);
		expect(table(elsewhere.approvals, "requests").map((row) => row.reason)).toEqual([
			"Other-org request",
		]);
		const there = JSON.stringify(elsewhere);
		for (const leaked of [
			"Flu",
			"Sick leave",
			"Berlin HQ",
			"Dentist",
			"Ada own reason",
			"Overtime",
		]) {
			expect(there, leaked).not.toContain(leaked);
		}
	});

	it("writes the three categories as JSON and CSV in the archive", async () => {
		expect(PERSONAL_DATA_COLLECTORS.map((collector) => collector.category)).toEqual(
			expect.arrayContaining(["absences", "planning", "approvals"]),
		);
		const scope = scopeFor("employee");
		const { absences, planning, approvals } = await collectAll(scope);
		const zip = await JSZip.loadAsync(
			await new Response(
				streamPersonalDataArchive({
					exportId: "t1168-export",
					scope,
					exportedAt: "2026-10-13T00:00:00Z",
					locale: "en",
					readme: "",
					categories: [absences, planning, approvals],
				}),
			).arrayBuffer(),
		);
		const paths = Object.values(zip.files)
			.filter((entry) => !entry.dir)
			.map((entry) => entry.name);
		expect(paths).toEqual(
			expect.arrayContaining([
				"absences.json",
				"absences/absences.csv",
				"absences/vacation_adjustments.csv",
				"planning.json",
				"planning/shifts.csv",
				"planning/shift_requests.csv",
				"approvals.json",
				"approvals/requests.csv",
				"approvals/decisions_on_others.csv",
			]),
		);
	});
});
