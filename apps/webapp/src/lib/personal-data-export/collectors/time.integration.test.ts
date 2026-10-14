/**
 * #1167: the Time category of a personal data export against a disposable
 * PostgreSQL database. Ada works for two organizations; her export in one
 * never holds rows of the other. Data is seeded directly.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import type { CollectedCategory, PersonalDataExportScope, PersonalDataRow } from "../collector";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { db } = await import("@/db");
const { timeCollector } = await import("./time");
const { PERSONAL_DATA_COLLECTORS } = await import("./index");

const ORG = "t1167-org";
const OTHER_ORG = "t1167-other";

const ids = {
	ada: "11670000-0000-4000-8000-000000000001",
	adaOther: "11670000-0000-4000-8000-000000000002",
	owner: "11670000-0000-4000-8000-000000000003",
	clockIn: "11670000-0000-4000-8000-0000000000a1",
	clockOut: "11670000-0000-4000-8000-0000000000a2",
	byManager: "11670000-0000-4000-8000-0000000000a3",
	correction: "11670000-0000-4000-8000-0000000000a4",
	otherClockIn: "11670000-0000-4000-8000-0000000000a5",
	period: "11670000-0000-4000-8000-0000000000b1",
	deletedPeriod: "11670000-0000-4000-8000-0000000000b2",
	otherPeriod: "11670000-0000-4000-8000-0000000000b3",
	project: "11670000-0000-4000-8000-0000000000c1",
	task: "11670000-0000-4000-8000-0000000000c2",
	category: "11670000-0000-4000-8000-0000000000c3",
	operation: "11670000-0000-4000-8000-0000000000d1",
	otherOperation: "11670000-0000-4000-8000-0000000000d2",
	autoClockOut: "11670000-0000-4000-8000-0000000000d3",
	policy: "11670000-0000-4000-8000-0000000000e1",
	otherPolicy: "11670000-0000-4000-8000-0000000000e2",
	surchargeModel: "11670000-0000-4000-8000-0000000000e3",
	surchargeRule: "11670000-0000-4000-8000-0000000000e4",
	proposal: "11670000-0000-4000-8000-0000000000e5",
	van: "11670000-0000-4000-8000-0000000000f1",
	otherVan: "11670000-0000-4000-8000-0000000000f2",
} as const;

const admin = integrationAdminPool();

function scope(
	kind: PersonalDataExportScope["kind"],
	organizationId = ORG,
): PersonalDataExportScope {
	return {
		organizationId,
		employeeId: organizationId === ORG ? ids.ada : ids.adaOther,
		userId: "t1167-ada",
		kind,
	};
}

function table(collected: CollectedCategory, key: string): PersonalDataRow[] {
	const part = collected.parts.find((candidate) => candidate.key === key);
	if (part?.kind !== "table") throw new Error(`no table part ${key}`);
	for (const row of part.rows) expect(Object.keys(row)).toEqual(part.columns);
	return part.rows;
}

async function cleanup() {
	for (const org of [ORG, OTHER_ORG]) {
		await admin.query("delete from organization where id = $1", [org]);
	}
	await admin.query('delete from "user" where id like $1', ["t1167-%"]);
}

async function seedUser(name: string, displayName: string) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
		[`t1167-${name}`, displayName, `t1167-${name}@example.test`],
	);
}

async function seedEmployee(organizationId: string, id: string, name: string) {
	await admin.query(
		`insert into employee (id,user_id,organization_id,role,is_active,updated_at)
		 values ($1,$2,$3,'employee',true,now())`,
		[id, `t1167-${name}`, organizationId],
	);
}

async function seedTimeEntry(input: {
	id: string;
	organizationId: string;
	employeeId: string;
	type: "clock_in" | "clock_out" | "correction";
	timestamp: string;
	offset: number;
	timezone: string;
	createdBy: string;
	notes?: string;
	replaces?: string;
}) {
	await admin.query(
		`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
		   timezone_source, hash, previous_hash, previous_entry_id, replaces_entry_id, notes, ip_address, device_info, created_by)
		 values ($1, $2, $3, $4, $5, $6, $7, 'browser', $8, 'secret-previous-hash', null, $9, $10, $11, $12, $13)`,
		[
			input.id,
			input.employeeId,
			input.organizationId,
			input.type,
			input.timestamp,
			input.offset,
			input.timezone,
			`secret-hash-${input.id}`,
			input.replaces ?? null,
			input.notes ?? null,
			`ip-of-${input.createdBy}`,
			`device-of-${input.createdBy}`,
			`t1167-${input.createdBy}`,
		],
	);
}

describe("personal data export: Time category (#1167)", () => {
	beforeAll(async () => {
		await cleanup();
		for (const organizationId of [ORG, OTHER_ORG]) {
			await admin.query(
				`insert into organization (id, name, slug, timezone, created_at) values ($1, $2, $1, 'Europe/Berlin', now())`,
				[organizationId, organizationId === ORG ? "Acme GmbH" : "Other AG"],
			);
		}
		await seedUser("ada", "Ada Lovelace");
		await seedUser("owner", "Olga Owner");
		await seedEmployee(ORG, ids.ada, "ada");
		await seedEmployee(ORG, ids.owner, "owner");
		await seedEmployee(OTHER_ORG, ids.adaOther, "ada");

		// Clock-in in Berlin (summer, +120), clock-out in New York (-240): travel.
		await seedTimeEntry({
			id: ids.clockIn,
			organizationId: ORG,
			employeeId: ids.ada,
			type: "clock_in",
			timestamp: "2026-07-01 06:00:00",
			offset: 120,
			timezone: "Europe/Berlin",
			createdBy: "ada",
			notes: "Flight day",
		});
		await seedTimeEntry({
			id: ids.clockOut,
			organizationId: ORG,
			employeeId: ids.ada,
			type: "clock_out",
			timestamp: "2026-07-01 15:30:00",
			offset: -240,
			timezone: "America/New_York",
			createdBy: "ada",
		});
		// The owner recorded an entry on Ada's behalf, then corrected it.
		await seedTimeEntry({
			id: ids.byManager,
			organizationId: ORG,
			employeeId: ids.ada,
			type: "clock_in",
			timestamp: "2026-07-02 07:00:00",
			offset: 120,
			timezone: "Europe/Berlin",
			createdBy: "owner",
		});
		await seedTimeEntry({
			id: ids.correction,
			organizationId: ORG,
			employeeId: ids.ada,
			type: "correction",
			timestamp: "2026-07-02 07:15:00",
			offset: 120,
			timezone: "Europe/Berlin",
			createdBy: "owner",
			replaces: ids.byManager,
		});
		await admin.query(
			"update time_entry set is_superseded = true, superseded_by_id = $1 where id = $2",
			[ids.correction, ids.byManager],
		);
		await seedTimeEntry({
			id: ids.otherClockIn,
			organizationId: OTHER_ORG,
			employeeId: ids.adaOther,
			type: "clock_in",
			timestamp: "2026-07-03 08:00:00",
			offset: 120,
			timezone: "Europe/Berlin",
			createdBy: "ada",
			notes: "Other-org secret note",
		});

		// Ada's travel day as a work period booked on a project task and category,
		// shortened by an automatic break, with a pending change she asked for.
		await admin.query(
			`insert into project (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Platform rebuild', 't1167-owner', now())`,
			[ids.project, ORG],
		);
		await admin.query(
			`insert into project_task (id, organization_id, project_id, name, created_by, updated_at) values ($1, $2, $3, 'Migration', 't1167-owner', now())`,
			[ids.task, ORG, ids.project],
		);
		await admin.query(
			`insert into work_category (id, organization_id, name, factor, created_by, updated_at) values ($1, $2, 'Passive travel', '0.50', 't1167-owner', now())`,
			[ids.category, ORG],
		);
		await admin.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, clock_out_id, project_id, task_id,
			   work_category_id, work_location_type, start_time, end_time, duration_minutes, is_active, approval_status,
			   pending_changes, was_auto_adjusted, auto_adjustment_reason, auto_adjusted_at, original_end_time,
			   original_duration_minutes, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, 'remote', '2026-07-01 06:00:00', '2026-07-01 15:30:00', 540, false,
			   'pending', $9, true, $10, '2026-07-01 15:31:00+00', '2026-07-01 15:00:00+00', 570, now())`,
			[
				ids.period,
				ids.ada,
				ORG,
				ids.clockIn,
				ids.clockOut,
				ids.project,
				ids.task,
				ids.category,
				JSON.stringify({
					originalStartTime: "2026-07-01T06:00:00.000Z",
					originalEndTime: "2026-07-01T15:30:00.000Z",
					originalDurationMinutes: 540,
					requestedStartTime: "2026-07-01T05:45:00.000Z",
					requestedEndTime: "2026-07-01T15:30:00.000Z",
					requestedDurationMinutes: 555,
					requestedAt: "2026-07-02T08:00:00.000Z",
					requestedBy: "t1167-ada",
					reason: "Forgot the taxi ride",
					ordinarySubmission: { submissionId: "secret-submission", kind: "manual_time_submission" },
				}),
				JSON.stringify({
					type: "break_enforcement",
					regulationId: "regulation-id",
					regulationName: "German working time act",
					breakInsertedMinutes: 30,
					breakInsertedAt: "2026-07-01T12:00:00.000Z",
					originalDurationMinutes: 570,
					adjustedDurationMinutes: 540,
					ruleApplied: { workingMinutesThreshold: 540, requiredBreakMinutes: 45 },
				}),
			],
		);
		// A period the owner deleted on the next day.
		await admin.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, is_active,
			   deleted_at, deleted_by, deletion_reason, updated_at)
			 values ($1, $2, $3, $4, '2026-07-02 07:15:00', false, '2026-07-03 09:00:00', 't1167-owner', 'Duplicate', now())`,
			[ids.deletedPeriod, ids.ada, ORG, ids.correction],
		);
		await admin.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, updated_at)
			 values ($1, $2, $3, $4, '2026-07-03 08:00:00', now())`,
			[ids.otherPeriod, ids.adaOther, OTHER_ORG, ids.otherClockIn],
		);
		// Vehicle use (#807): Ada drove an organization van, since archived, on the travel
		// day, and her own car on the deleted period; the other organization has its own van.
		await admin.query(
			`insert into organization_vehicle (id, organization_id, name, licence_plate, archived_at) values
			   ($1, $3, 'Sprinter 3', 'M AB 123', '2026-09-01 00:00:00+00'),
			   ($2, $4, 'Other-org van', 'B XY 999', null)`,
			[ids.van, ids.otherVan, ORG, OTHER_ORG],
		);
		await admin.query(
			`update work_period set vehicle_kind = 'organization', vehicle_id = $2, odometer_start_km = 12000,
			   odometer_end_km = 12180, driven_distance_km = 180 where id = $1`,
			[ids.period, ids.van],
		);
		await admin.query(
			`update work_period set vehicle_kind = 'own', driven_distance_km = 42 where id = $1`,
			[ids.deletedPeriod],
		);
		await admin.query(
			`update work_period set vehicle_kind = 'organization', vehicle_id = $2, odometer_start_km = 5,
			   odometer_end_km = 7, driven_distance_km = 2 where id = $1`,
			[ids.otherPeriod, ids.otherVan],
		);
		// The work operation log: the owner's amendment (receipts stay out), and one in the other org.
		await admin.query(
			`insert into completed_work_operation (id, organization_id, employee_id, kind, writer, writer_version,
			   command_version, command, append_admission, actor_kind, actor_user_id, work_period_id, result_version,
			   result, created_at)
			 values ($1, $2, $3, 'amend_completed_work', 'admin_time_edit', 1, 1, '{"secret":"command-receipt"}', 'append',
			   'human', 't1167-owner', $4, 1, '{"secret":"result-receipt"}', '2026-07-02 08:30:00+00'),
			   ($5, $6, $7, 'close_active_work', 'web_clock_out', 1, 1, '{}', 'append', 'human', 't1167-ada', $8, 1, '{}', now())`,
			[
				ids.operation,
				ORG,
				ids.ada,
				ids.period,
				ids.otherOperation,
				OTHER_ORG,
				ids.adaOther,
				ids.otherPeriod,
			],
		);
		// Ada clocked out automatically once.
		await admin.query(
			`insert into automatic_clock_out_execution (id, organization_id, employee_id, work_period_id, start_time,
			   cutoff_time, max_uninterrupted_minutes, settings_revision, timezone, utc_offset_minutes,
			   recipient_user_id, provenance_user_id, clock_out_entry_id, closure_payload, processed_at)
			 values ($1, $2, $3, $4, '2026-07-01 06:00:00+00', '2026-07-01 16:00:00+00', 600, 3, 'America/New_York', -240,
			   't1167-ada', 't1167-ada', $5, '{"secret":"closure-payload"}', '2026-07-01 16:00:05+00')`,
			[ids.autoClockOut, ORG, ids.ada, ids.period, ids.clockOut],
		);
		// The owner proposed a historical repair of the travel day and applied it.
		await admin.query(
			`insert into historical_work_proposal (id, organization_id, employee_id, kind, status, work_period_id,
			   fingerprint, proposal, reason, proposed_by, proposed_at, approved_by, approved_at, resolved_by,
			   resolved_at, outcome)
			 values ($1, $2, $3, 'field_repair', 'applied', $4, 'secret-fingerprint', '{"secret":"proposal-body"}',
			   'Missing clock-out', 't1167-owner', '2026-07-04 10:00:00+00', 't1167-owner', '2026-07-04 11:00:00+00',
			   't1167-owner', '2026-07-04 11:00:01+00', '{"secret":"proposal-outcome"}')`,
			[ids.proposal, ORG, ids.ada, ids.period],
		);

		// Compliance: an approved exception, and a violation nobody shows Ada in the app.
		await admin.query(
			`insert into compliance_exception (organization_id, employee_id, exception_type, status, reason,
			   planned_duration_minutes, valid_from, valid_until, approver_id, approved_at, work_period_id,
			   created_by, created_at, updated_at)
			 values ($1, $2, 'overtime_daily', 'approved', 'Release night', 120, '2026-07-01 00:00:00+00',
			   '2026-07-02 00:00:00+00', $3, '2026-06-30 12:00:00+00', $4, 't1167-ada', '2026-06-30 10:00:00+00', now())`,
			[ORG, ids.ada, ids.owner, ids.period],
		);
		await admin.query(
			`insert into compliance_exception (organization_id, employee_id, exception_type, reason, valid_from,
			   valid_until, created_by, updated_at)
			 values ($1, $2, 'rest_period', 'Other-org exception', now(), now(), 't1167-ada', now())`,
			[OTHER_ORG, ids.adaOther],
		);
		await admin.query(
			`insert into work_policy (id, organization_id, name, created_by, updated_at) values
			   ($1, $3, 'Standard week', 't1167-owner', now()), ($2, $4, 'Other-org policy', 't1167-owner', now())`,
			[ids.policy, ids.otherPolicy, ORG, OTHER_ORG],
		);
		await admin.query(
			`insert into work_policy_violation (employee_id, organization_id, policy_id, work_period_id, violation_date,
			   violation_type, details, acknowledged_by, acknowledged_at, acknowledged_note, created_at)
			 values ($1, $2, $3, $4, '2026-07-01 15:30:00', 'max_daily', $9,
			   $5, '2026-07-02 09:00:00', 'Travel day', '2026-07-01 15:31:00'),
			   ($6, $7, $8, null, '2026-07-03 08:00:00', 'rest_period', null, null, null, null, now())`,
			[
				ids.ada,
				ORG,
				ids.policy,
				ids.period,
				ids.owner,
				ids.adaOther,
				OTHER_ORG,
				ids.otherPolicy,
				JSON.stringify({
					actualMinutes: 570,
					limitMinutes: 600,
					warningShownAt: "2026-07-01T17:20:00.000+02:00",
					exceptionApprovedBy: ids.owner,
				}),
			],
		);

		// Surcharges on the travel day.
		await admin.query(
			`insert into surcharge_model (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Night work', 't1167-owner', now())`,
			[ids.surchargeModel, ORG],
		);
		await admin.query(
			`insert into surcharge_rule (id, model_id, name, rule_type, percentage, window_start_time, window_end_time, created_by)
			 values ($1, $2, 'Late evening', 'time_window', '0.2500', '20:00', '23:59', 't1167-owner')`,
			[ids.surchargeRule, ids.surchargeModel],
		);
		await admin.query(
			`insert into surcharge_calculation (employee_id, organization_id, work_period_id, surcharge_rule_id,
			   surcharge_model_id, calculation_date, base_minutes, qualifying_minutes, surcharge_minutes,
			   applied_percentage, calculation_details, created_at)
			 values ($1, $2, $3, $4, $5, '2026-07-01 15:31:00', 540, 60, 15, '0.2500', '{"rulesApplied":[]}', '2026-07-01 15:31:00')`,
			[ids.ada, ORG, ids.period, ids.surchargeRule, ids.surchargeModel],
		);

		// Balances: current, monthly and the legacy yearly balance; one per organization.
		for (const [organizationId, employeeId, minutes] of [
			[ORG, ids.ada, 75],
			[OTHER_ORG, ids.adaOther, 9999],
		] as const) {
			await admin.query(
				`insert into employee_work_balance (employee_id, organization_id, actual_minutes, required_minutes,
				   adjustment_minutes, balance_minutes, computed_from_date, computed_through_date, computed_at,
				   is_dirty, last_error, updated_at)
				 values ($1, $2, 10000, 9985, 60, $3, '2026-01-01', '2026-07-31', '2026-08-01 02:00:00+00', true,
				   'secret-refresh-error', now())`,
				[employeeId, organizationId, minutes],
			);
		}
		await admin.query(
			`insert into employee_work_balance_period (employee_id, organization_id, period_type, period_start,
			   period_end, actual_minutes, required_minutes, balance_minutes, computed_at, is_closed, updated_at)
			 values ($1, $2, 'month', '2026-07-01', '2026-07-31', 10000, 9985, 15, '2026-08-01 02:00:00+00', true, now())`,
			[ids.ada, ORG],
		);
		await admin.query(
			`insert into employee_time_balance (employee_id, organization_id, year, actual_minutes, expected_minutes,
			   absence_adjusted_minutes, balance_minutes, calculated_at, updated_at)
			 values ($1, $2, 2025, 100000, 99000, 480, 1480, '2026-01-02 03:00:00', now())`,
			[ids.ada, ORG],
		);

		// Balance adjustments: an opening balance, and a payout the owner cancelled.
		await admin.query(
			`insert into balance_adjustment (organization_id, employee_id, kind, day, minutes, reason, recorded_by, recorded_at)
			 values ($1, $2, 'opening_balance', '2026-01-01', 600, 'Carried over from paper sheets', 't1167-owner',
			   '2026-01-05 09:00:00+00')`,
			[ORG, ids.ada],
		);
		await admin.query(
			`insert into balance_adjustment (organization_id, employee_id, kind, day, minutes, reason, recorded_by,
			   recorded_at, cancelled_at, cancelled_by, cancellation_reason)
			 values ($1, $2, 'overtime_payout', '2026-06-30', -540, 'June payout', 't1167-owner', '2026-07-01 09:00:00+00',
			   '2026-07-01 10:00:00+00', 't1167-owner', 'Paid twice by mistake'),
			   ($3, $4, 'overtime_payout', '2026-06-30', -60, 'Other-org payout', 't1167-owner', now(), null, null, null)`,
			[ORG, ids.ada, OTHER_ORG, ids.adaOther],
		);
	});

	afterAll(async () => {
		await cleanup();
	});

	it("exports time entries as UTC instants with each entry's own offset and no hash chain", async () => {
		const collected = await timeCollector.collect(db, scope("employee"));
		expect(collected.category).toBe("time");

		const entries = table(collected, "time_entries");
		expect(entries.map((row) => row.id)).toEqual([
			ids.clockIn,
			ids.clockOut,
			ids.byManager,
			ids.correction,
		]);
		expect(entries[0]).toMatchObject({
			type: "clock_in",
			timestamp: "2026-07-01T06:00:00Z",
			utc_offset_minutes: 120,
			timezone: "Europe/Berlin",
			timezone_source: "browser",
			notes: "Flight day",
			created_by: "Ada Lovelace",
			ip_address: "ip-of-ada",
			device_info: "device-of-ada",
		});
		expect(entries[1]).toMatchObject({
			timestamp: "2026-07-01T15:30:00Z",
			utc_offset_minutes: -240,
			timezone: "America/New_York",
		});
		// Entries someone else recorded keep the editor's name, not their IP or device.
		expect(entries[2]).toMatchObject({
			created_by: "Olga Owner",
			ip_address: null,
			device_info: null,
			is_superseded: true,
			superseded_by_id: ids.correction,
		});
		expect(entries[3]).toMatchObject({ type: "correction", replaces_entry_id: ids.byManager });

		const text = JSON.stringify(collected);
		for (const leaked of ["secret-hash", "secret-previous-hash", "Other-org secret note"]) {
			expect(text, leaked).not.toContain(leaked);
		}
		for (const column of ["hash", "previous_hash", "previous_entry_id"]) {
			expect(Object.keys(entries[0] ?? {})).not.toContain(column);
		}
	});

	it("exports work periods with endpoint offsets, deletions, pending changes, break adjustments and the edit log", async () => {
		const collected = await timeCollector.collect(db, scope("employee"));

		const periods = table(collected, "work_periods");
		expect(periods.map((row) => row.id)).toEqual([ids.period, ids.deletedPeriod]);
		expect(periods[0]).toMatchObject({
			start_time: "2026-07-01T06:00:00Z",
			start_utc_offset_minutes: 120,
			end_time: "2026-07-01T15:30:00Z",
			end_utc_offset_minutes: -240,
			duration_minutes: 540,
			clock_in_entry_id: ids.clockIn,
			clock_out_entry_id: ids.clockOut,
			project: "Platform rebuild",
			task: "Migration",
			work_category: "Passive travel",
			work_location_type: "remote",
			approval_status: "pending",
			pending_start_time: "2026-07-01T05:45:00Z",
			pending_end_time: "2026-07-01T15:30:00Z",
			pending_duration_minutes: 555,
			pending_requested_at: "2026-07-02T08:00:00Z",
			pending_requested_by: "Ada Lovelace",
			pending_reason: "Forgot the taxi ride",
			deleted_at: null,
		});
		expect(periods[1]).toMatchObject({
			deleted_at: "2026-07-03T09:00:00Z",
			deleted_by: "Olga Owner",
			deletion_reason: "Duplicate",
			end_time: null,
		});

		expect(table(collected, "break_adjustments")).toEqual([
			{
				work_period_id: ids.period,
				adjusted_at: "2026-07-01T15:31:00Z",
				policy: "German working time act",
				break_inserted_at: "2026-07-01T12:00:00Z",
				break_inserted_minutes: 30,
				required_break_minutes: 45,
				working_minutes_threshold: 540,
				original_end_time: "2026-07-01T15:00:00Z",
				original_duration_minutes: 570,
				adjusted_duration_minutes: 540,
			},
		]);

		expect(table(collected, "work_operations")).toEqual([
			{
				work_period_id: ids.period,
				kind: "amend_completed_work",
				writer: "admin_time_edit",
				actor_kind: "human",
				actor: "Olga Owner",
				created_at: "2026-07-02T08:30:00Z",
			},
		]);

		expect(table(collected, "automatic_clock_outs")).toEqual([
			{
				work_period_id: ids.period,
				start_time: "2026-07-01T06:00:00Z",
				cutoff_time: "2026-07-01T16:00:00Z",
				max_uninterrupted_minutes: 600,
				timezone: "America/New_York",
				utc_offset_minutes: -240,
				clock_out_entry_id: ids.clockOut,
				processed_at: "2026-07-01T16:00:05Z",
			},
		]);

		const text = JSON.stringify(collected);
		for (const leaked of [
			"secret-submission",
			"command-receipt",
			"result-receipt",
			"closure-payload",
			ids.otherPeriod,
			ids.otherOperation,
			"secret-fingerprint",
			"proposal-body",
			"proposal-outcome",
		]) {
			expect(text, leaked).not.toContain(leaked);
		}

		expect(table(collected, "historical_repair_proposals")).toEqual([
			{
				id: ids.proposal,
				kind: "field_repair",
				status: "applied",
				work_period_id: ids.period,
				reason: "Missing clock-out",
				proposed_by: "Olga Owner",
				proposed_at: "2026-07-04T10:00:00Z",
				approved_by: "Olga Owner",
				approved_at: "2026-07-04T11:00:00Z",
				resolved_by: "Olga Owner",
				resolved_at: "2026-07-04T11:00:01Z",
			},
		]);
	});

	it("exports each work period's vehicle use with the vehicle's name and plate, archived vehicles too", async () => {
		const periods = table(await timeCollector.collect(db, scope("employee")), "work_periods");
		const vehicleUse = (row: PersonalDataRow | undefined) => ({
			vehicle_kind: row?.vehicle_kind,
			vehicle_name: row?.vehicle_name,
			licence_plate: row?.licence_plate,
			odometer_start_km: row?.odometer_start_km,
			odometer_end_km: row?.odometer_end_km,
			driven_distance_km: row?.driven_distance_km,
		});
		expect(vehicleUse(periods[0])).toEqual({
			vehicle_kind: "organization",
			vehicle_name: "Sprinter 3",
			licence_plate: "M AB 123",
			odometer_start_km: 12000,
			odometer_end_km: 12180,
			driven_distance_km: 180,
		});
		// An own vehicle identifies no vehicle: no name, no plate; the distance was entered directly.
		expect(vehicleUse(periods[1])).toEqual({
			vehicle_kind: "own",
			vehicle_name: null,
			licence_plate: null,
			odometer_start_km: null,
			odometer_end_km: null,
			driven_distance_km: 42,
		});

		const other = table(
			await timeCollector.collect(db, scope("employee", OTHER_ORG)),
			"work_periods",
		);
		expect(vehicleUse(other[0])).toMatchObject({
			vehicle_name: "Other-org van",
			licence_plate: "B XY 999",
		});
		expect(JSON.stringify(periods)).not.toContain("Other-org van");
		expect(JSON.stringify(other)).not.toContain("Sprinter 3");
	});

	it("exports compliance exceptions, work-policy violations and surcharge calculations", async () => {
		const collected = await timeCollector.collect(db, scope("employee"));

		expect(table(collected, "compliance_exceptions")).toEqual([
			expect.objectContaining({
				exception_type: "overtime_daily",
				status: "approved",
				reason: "Release night",
				planned_duration_minutes: 120,
				valid_from: "2026-07-01T00:00:00Z",
				valid_until: "2026-07-02T00:00:00Z",
				approver: "Olga Owner",
				approved_at: "2026-06-30T12:00:00Z",
				work_period_id: ids.period,
				created_by: "Ada Lovelace",
				created_at: "2026-06-30T10:00:00Z",
			}),
		]);
		// No employee-facing page shows violations; the export does.
		expect(table(collected, "work_policy_violations")).toEqual([
			expect.objectContaining({
				policy: "Standard week",
				work_period_id: ids.period,
				violation_type: "max_daily",
				violated_at: "2026-07-01T15:30:00Z",
				// People by name, never by id; instants in UTC like everywhere else.
				details: JSON.stringify({
					actualMinutes: 570,
					limitMinutes: 600,
					warningShownAt: "2026-07-01T15:20:00Z",
					exceptionApprovedBy: "Olga Owner",
				}),
				acknowledged_by: "Olga Owner",
				acknowledged_at: "2026-07-02T09:00:00Z",
				acknowledged_note: "Travel day",
			}),
		]);
		expect(table(collected, "surcharge_calculations")).toEqual([
			expect.objectContaining({
				work_period_id: ids.period,
				surcharge_model: "Night work",
				surcharge_rule: "Late evening",
				calculated_at: "2026-07-01T15:31:00Z",
				base_minutes: 540,
				qualifying_minutes: 60,
				surcharge_minutes: 15,
				applied_percentage: "0.2500",
				calculation_details: '{"rulesApplied":[]}',
			}),
		]);
	});

	it("exports balances with plain calendar days and every balance adjustment, cancelled ones with their reason", async () => {
		const collected = await timeCollector.collect(db, scope("employee"));

		expect(table(collected, "work_balance")).toEqual([
			{
				actual_minutes: 10000,
				required_minutes: 9985,
				adjustment_minutes: 60,
				balance_minutes: 75,
				computed_from_date: "2026-01-01",
				computed_through_date: "2026-07-31",
				computed_at: "2026-08-01T02:00:00Z",
			},
		]);
		expect(table(collected, "work_balance_periods")).toEqual([
			{
				period_type: "month",
				period_start: "2026-07-01",
				period_end: "2026-07-31",
				actual_minutes: 10000,
				required_minutes: 9985,
				balance_minutes: 15,
				is_closed: true,
				computed_at: "2026-08-01T02:00:00Z",
			},
		]);
		expect(table(collected, "yearly_balances")).toEqual([
			{
				year: 2025,
				actual_minutes: 100000,
				expected_minutes: 99000,
				absence_adjusted_minutes: 480,
				balance_minutes: 1480,
				calculated_at: "2026-01-02T03:00:00Z",
			},
		]);
		expect(table(collected, "balance_adjustments")).toEqual([
			expect.objectContaining({
				kind: "opening_balance",
				day: "2026-01-01",
				minutes: 600,
				reason: "Carried over from paper sheets",
				recorded_by: "Olga Owner",
				recorded_at: "2026-01-05T09:00:00Z",
				cancelled_at: null,
				cancelled_by: null,
				cancellation_reason: null,
			}),
			expect.objectContaining({
				kind: "overtime_payout",
				day: "2026-06-30",
				minutes: -540,
				reason: "June payout",
				cancelled_at: "2026-07-01T10:00:00Z",
				cancelled_by: "Olga Owner",
				cancellation_reason: "Paid twice by mistake",
			}),
		]);
		expect(JSON.stringify(collected)).not.toContain("secret-refresh-error");
	});

	it("holds the same Time data in the admin export, and only the active organization's", async () => {
		const employeeExport = await timeCollector.collect(db, scope("employee"));
		const adminExport = await timeCollector.collect(db, scope("admin"));
		expect(adminExport).toEqual(employeeExport);

		const other = await timeCollector.collect(db, scope("employee", OTHER_ORG));
		expect(table(other, "time_entries").map((row) => row.id)).toEqual([ids.otherClockIn]);
		expect(table(other, "work_periods").map((row) => row.id)).toEqual([ids.otherPeriod]);
		expect(table(other, "balance_adjustments").map((row) => row.reason)).toEqual([
			"Other-org payout",
		]);
		expect(table(other, "work_balance").map((row) => row.balance_minutes)).toEqual([9999]);
		const otherText = JSON.stringify(other);
		for (const leaked of [
			"Flight day",
			"Platform rebuild",
			"Standard week",
			"Release night",
			"Night work",
			"Paid twice by mistake",
			ids.period,
		]) {
			expect(otherText, leaked).not.toContain(leaked);
		}
		const ownText = JSON.stringify(employeeExport);
		for (const leaked of ["Other-org exception", "Other-org policy", "Other-org payout"]) {
			expect(ownText, leaked).not.toContain(leaked);
		}
	});

	it("is a category of every personal data export, after Employment", () => {
		const categories = PERSONAL_DATA_COLLECTORS.map((collector) => collector.category);
		expect(categories).toContain("time");
		expect(categories.indexOf("time")).toBe(categories.indexOf("employment") + 1);
	});
});
