/**
 * #811 code review: whom an audit row is about, against a disposable
 * PostgreSQL database. Some writers store the acting employee in
 * `audit_log.employee_id`; rows written by others on the employee's records
 * often carry no `employee_id` at all; and a sick-note audit row may name an
 * HR-only document. The Audit log collector is called the way the export
 * worker calls it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import type { CollectedCategory, PersonalDataExportScope, PersonalDataRow } from "./collector";

const { db } = await import("@/db");
const { auditLogCollector } = await import("./collectors/audit-log");

const ORG = "t811a-org";

const ids = {
	ada: "81100000-0000-4000-8000-000000000001",
	bob: "81100000-0000-4000-8000-000000000002",
	olga: "81100000-0000-4000-8000-000000000003",
	report: "81100000-0000-4000-8000-0000000000a1",
	approvalRequest: "81100000-0000-4000-8000-0000000000a2",
	bobEntry: "81100000-0000-4000-8000-0000000000a3",
	bobPeriod: "81100000-0000-4000-8000-0000000000a4",
	bobAbsence: "81100000-0000-4000-8000-0000000000a5",
	sickCategory: "81100000-0000-4000-8000-0000000000a6",
	hrOnlyNote: "81100000-0000-4000-8000-0000000000b1",
	sharedNote: "81100000-0000-4000-8000-0000000000b2",
	referenceRate: "81100000-0000-4000-8000-0000000000c1",
} as const;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from audit_log where organization_id = $1", [ORG]);
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t811a-%"]);
}

async function seedPerson(name: string, employeeId: string, displayName: string) {
	await admin.query(
		`insert into "user" (id, name, email, created_at, updated_at) values ($1, $2, $3, now(), now())`,
		[`t811a-${name}`, displayName, `t811a-${name}@example.test`],
	);
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, is_active, updated_at)
		 values ($1, $2, $3, 'employee', true, now())`,
		[employeeId, `t811a-${name}`, ORG],
	);
}

async function audit(row: {
	entityType: string;
	entityId: string;
	action: string;
	performedBy: string;
	employeeId?: string | null;
	metadata?: unknown;
	timestamp: string;
}) {
	await admin.query(
		`insert into audit_log (organization_id, entity_type, entity_id, action, performed_by, employee_id, metadata,
			timestamp) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[
			ORG,
			row.entityType,
			row.entityId,
			row.action,
			row.performedBy,
			row.employeeId ?? null,
			row.metadata === undefined ? null : JSON.stringify(row.metadata),
			new Date(row.timestamp),
		],
	);
}

function scopeOf(
	name: string,
	employeeId: string,
	kind: PersonalDataExportScope["kind"],
): PersonalDataExportScope {
	return { organizationId: ORG, employeeId, userId: `t811a-${name}`, kind };
}

function table(category: CollectedCategory, key: string): PersonalDataRow[] {
	const part = category.parts.find((candidate) => candidate.key === key);
	if (part?.kind !== "table") throw new Error(`no table part ${key}`);
	return part.rows;
}

describe("personal data export: whom an audit row is about (#811 review)", () => {
	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values ($1, 'Acme GmbH', $1, 'Europe/Berlin', now())`,
			[ORG],
		);
		await seedPerson("ada", ids.ada, "Ada Reviewer");
		await seedPerson("bob", ids.bob, "Bob Builder");
		await seedPerson("olga", ids.olga, "Olga Owner");

		// Bob's records.
		await admin.query(
			`insert into travel_expense_report (id, organization_id, employee_id, kind, status, reimbursement_currency,
			   trip_purpose, trip_start_date, trip_end_date, trip_time_zone, submission_count, submitted_at, decided_at,
			   created_by)
			 values ($1, $2, $3, 'trip', 'returned', 'EUR', 'Fair', '2026-03-02', '2026-03-03', 'Europe/Berlin', 1,
			   '2026-03-04T08:00:00Z', '2026-03-05T08:00:00Z', 't811a-bob')`,
			[ids.report, ORG, ids.bob],
		);
		await admin.query(
			`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
				timezone_source, hash, created_by, created_at)
			 values ($1, $2, $3, 'clock_in', '2026-03-04T07:00:00Z', 60, 'test', md5(random()::text), 't811a-bob',
				'2026-03-04T07:00:00Z')`,
			[ids.bobEntry, ids.bob, ORG],
		);
		await admin.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, updated_at)
			 values ($1, $2, $3, $4, '2026-03-04 07:00:00', now())`,
			[ids.bobPeriod, ids.bob, ORG, ids.bobEntry],
		);
		await admin.query(
			`insert into absence_category (id, organization_id, type, name, updated_at) values ($1, $2, 'sick', 'Sick', now())`,
			[ids.sickCategory, ORG],
		);
		await admin.query(
			`insert into absence_entry (id, employee_id, category_id, start_date, end_date, status, organization_id,
			   updated_at) values ($1, $2, $3, '2026-03-09', '2026-03-10', 'approved', $4, now())`,
			[ids.bobAbsence, ids.bob, ids.sickCategory, ORG],
		);
		await admin.query(
			`insert into employee_document (id, organization_id, employee_id, category, title, document_date,
			   visibility, storage_provider, storage_key, file_name, mime_type, size_bytes, checksum_sha256) values
			   ($1, $3, $4, 'sick_note', 'HR sick note', '2026-03-09', 'hr_only', 's3-private', 't811a/hr.pdf',
			    'hr.pdf', 'application/pdf', 10, 'sha'),
			   ($2, $3, $4, 'sick_note', 'Shared sick note', '2026-03-09', 'shared', 's3-private', 't811a/shared.pdf',
			    'shared.pdf', 'application/pdf', 10, 'sha')`,
			[ids.hrOnlyNote, ids.sharedNote, ORG, ids.bob],
		);

		// Ada returned and reopened Bob's report: her employee id sits in employee_id.
		await audit({
			entityType: "approval",
			entityId: ids.report,
			action: "travel_expense.returned",
			performedBy: "t811a-ada",
			employeeId: ids.ada,
			metadata: { model: "report", approvalRequestId: ids.approvalRequest, submissionCycle: 1 },
			timestamp: "2026-03-05T08:00:00Z",
		});
		await audit({
			entityType: "approval",
			entityId: ids.report,
			action: "travel_expense.reopened",
			performedBy: "t811a-ada",
			employeeId: ids.ada,
			metadata: { model: "report", submissionCycle: 1 },
			timestamp: "2026-03-06T08:00:00Z",
		});
		// An organization setting Ada changed, her employee id in employee_id.
		await audit({
			entityType: "organization",
			entityId: ids.referenceRate,
			action: "travel_expense.reference_rate_approved",
			performedBy: "t811a-ada",
			employeeId: ids.ada,
			metadata: { rate: "0.30" },
			timestamp: "2026-03-07T08:00:00Z",
		});
		// Olga edited Bob's records without naming him in employee_id.
		await audit({
			entityType: "time_entry",
			entityId: ids.bobEntry,
			action: "time_entry.corrected",
			performedBy: "t811a-olga",
			metadata: { reason: "Forgot to clock in" },
			timestamp: "2026-03-08T08:00:00Z",
		});
		await audit({
			entityType: "work_period",
			entityId: ids.bobPeriod,
			action: "update",
			performedBy: "t811a-olga",
			timestamp: "2026-03-08T09:00:00Z",
		});
		// Sick notes linked to Bob's absence: one HR-only, one shared.
		await audit({
			entityType: "absence_entry",
			entityId: ids.bobAbsence,
			action: "absence.sick_detail_changed",
			performedBy: "t811a-olga",
			employeeId: ids.bob,
			metadata: { documentId: ids.hrOnlyNote, absenceId: ids.bobAbsence },
			timestamp: "2026-03-10T08:00:00Z",
		});
		await audit({
			entityType: "absence_entry",
			entityId: ids.bobAbsence,
			action: "absence.sick_detail_changed",
			performedBy: "t811a-olga",
			employeeId: ids.bob,
			metadata: { documentId: ids.sharedNote, absenceId: ids.bobAbsence },
			timestamp: "2026-03-11T08:00:00Z",
		});
	});

	afterAll(cleanup);

	it("shows a reviewer's return and reopen of a colleague's report only as actions on others", async () => {
		const collected = await auditLogCollector.collect(db, scopeOf("ada", ids.ada, "employee"));
		expect(table(collected, "entries")).toEqual([]);
		expect(
			table(collected, "actions_on_others").map((row) => [
				row.record_kind,
				row.action,
				row.other_person === null ? null : "person",
			]),
		).toEqual([
			["approval", "travel_expense.returned", "person"],
			["approval", "travel_expense.reopened", "person"],
			// An organization setting concerns no person.
			["organization", "travel_expense.reference_rate_approved", null],
		]);
		const text = JSON.stringify(collected);
		for (const leaked of [ids.report, ids.approvalRequest, ids.bob, "Bob"]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("gives the report owner the return and reopen as entries about them", async () => {
		const collected = await auditLogCollector.collect(db, scopeOf("bob", ids.bob, "employee"));
		const entries = table(collected, "entries");
		expect(entries.map((row) => [row.action, row.performed_by])).toEqual([
			["travel_expense.returned", "Ada Reviewer"],
			["travel_expense.reopened", "Ada Reviewer"],
			["time_entry.corrected", "Olga Owner"],
			["update", "Olga Owner"],
			["absence.sick_detail_changed", "Olga Owner"],
			["absence.sick_detail_changed", "Olga Owner"],
		]);
		expect(table(collected, "actions_on_others")).toEqual([]);
	});

	it("never reveals an HR-only document through a sick-note audit row in the employee export", async () => {
		const own = await auditLogCollector.collect(db, scopeOf("bob", ids.bob, "employee"));
		const sickRows = table(own, "entries").filter(
			(row) => row.action === "absence.sick_detail_changed",
		);
		expect(sickRows.map((row) => JSON.parse(row.metadata as string))).toEqual([
			{ absenceId: ids.bobAbsence },
			{ documentId: ids.sharedNote, absenceId: ids.bobAbsence },
		]);
		expect(JSON.stringify(own)).not.toContain(ids.hrOnlyNote);

		// The admin export holds the withheld document reference.
		const byAdmin = await auditLogCollector.collect(db, scopeOf("bob", ids.bob, "admin"));
		expect(JSON.stringify(byAdmin)).toContain(ids.hrOnlyNote);
	});
});
