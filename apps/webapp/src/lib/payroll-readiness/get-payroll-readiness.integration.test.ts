/**
 * #603/#617 review: the payroll readiness travel expense warning against a
 * disposable PostgreSQL database. Converted legacy drafts (#616) stay `draft`
 * forever and must not warn; submitted reports in the period must.
 */

import { DateTime } from "luxon";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { getPayrollReadiness } = await import("./get-payroll-readiness");

const admin = integrationAdminPool();
const ORG = "tpr-org";
const OTHER_ORG = "tpr-other";
const ids = {
	employee: "e7000000-0000-4000-8000-000000000001",
	foreigner: "e7000000-0000-4000-8000-000000000002",
	convertedClaim: "e7001000-0000-4000-8000-000000000001",
	openClaim: "e7001000-0000-4000-8000-000000000002",
	conversionReport: "e7002000-0000-4000-8000-000000000001",
	standaloneInPeriod: "e7002000-0000-4000-8000-000000000002",
	tripOverlapping: "e7002000-0000-4000-8000-000000000003",
	standaloneOutside: "e7002000-0000-4000-8000-000000000004",
	draftInPeriod: "e7002000-0000-4000-8000-000000000005",
	approvedInPeriod: "e7002000-0000-4000-8000-000000000006",
	foreignSubmitted: "e7002000-0000-4000-8000-000000000007",
} as const;

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [ORG, OTHER_ORG]);
	await admin.query('delete from "user" where id like $1', ["tpr-%"]);
}

async function report(
	id: string,
	input: {
		organizationId?: string;
		employeeId?: string;
		kind: "standalone" | "trip";
		status: "draft" | "submitted" | "approved";
		trip?: [string, string];
		expenseDate?: string;
	},
) {
	const organizationId = input.organizationId ?? ORG;
	const submitted = input.status !== "draft";
	await admin.query(
		`insert into travel_expense_report (id, organization_id, employee_id, kind, status, reimbursement_currency,
		   trip_start_date, trip_end_date, trip_time_zone, submission_count, submitted_at, decided_at, created_by)
		 values ($1, $2, $3, $4, $5, 'EUR', $6, $7, $8, $9, $10, $11, $12)`,
		[
			id,
			organizationId,
			input.employeeId ?? ids.employee,
			input.kind,
			input.status,
			input.trip?.[0] ?? null,
			input.trip?.[1] ?? null,
			input.kind === "trip" ? "Europe/Berlin" : null,
			submitted ? 1 : 0,
			submitted ? "2026-04-20T10:00:00Z" : null,
			input.status === "approved" ? "2026-04-21T10:00:00Z" : null,
			organizationId === ORG ? "tpr-user" : "tpr-foreigner",
		],
	);
	if (input.expenseDate) {
		await admin.query(
			`insert into travel_expense_report_item (organization_id, report_id, type, position, expense_date,
			   category, description, original_amount, original_currency, paid_by)
			 values ($1, $2, 'receipt', 1, $3, 'transport', 'Taxi', '12.50', 'EUR', 'employee')`,
			[organizationId, id, input.expenseDate],
		);
	}
}

async function draftClaim(id: string) {
	await admin.query(
		`insert into travel_expense_claim (id, organization_id, employee_id, type, status, trip_start, trip_end,
		   original_currency, original_amount, calculated_currency, calculated_amount, created_by, updated_at)
		 values ($1, $2, $3, 'receipt', 'draft', '2026-04-10', '2026-04-10',
		   'EUR', '20.00', 'EUR', '20.00', 'tpr-user', now())`,
		[id, ORG, ids.employee],
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ($1, 'Readiness', $1, 'Europe/Berlin', now()), ($2, 'Other', $2, 'UTC', now())`,
		[ORG, OTHER_ORG],
	);
	for (const [userId, employeeId, organizationId] of [
		["tpr-user", ids.employee, ORG],
		["tpr-foreigner", ids.foreigner, OTHER_ORG],
	] as const) {
		await admin.query(
			'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, now(), now())',
			[userId, `${userId}@example.test`],
		);
		await admin.query(
			"insert into employee (id, user_id, organization_id, role, updated_at) values ($1, $2, $3, 'employee', now())",
			[employeeId, userId, organizationId],
		);
	}

	// A legacy draft continued as a report: the claim stays `draft` forever.
	await draftClaim(ids.convertedClaim);
	await report(ids.conversionReport, { kind: "standalone", status: "draft" });
	await admin.query(
		`insert into travel_expense_legacy_draft_conversion (organization_id, employee_id, claim_id, report_id,
		   item_id, legacy_facts, converted_by_user_id, converted_at)
		 values ($1, $2, $3, $4, gen_random_uuid(), '{}'::jsonb, 'tpr-user', now())`,
		[ORG, ids.employee, ids.convertedClaim, ids.conversionReport],
	);
	// A legacy draft nobody converted still warns.
	await draftClaim(ids.openClaim);

	await report(ids.standaloneInPeriod, {
		kind: "standalone",
		status: "submitted",
		expenseDate: "2026-04-30",
	});
	await report(ids.tripOverlapping, {
		kind: "trip",
		status: "submitted",
		trip: ["2026-03-30", "2026-04-01"],
	});
	await report(ids.standaloneOutside, {
		kind: "standalone",
		status: "submitted",
		expenseDate: "2026-05-01",
	});
	await report(ids.draftInPeriod, {
		kind: "standalone",
		status: "draft",
		expenseDate: "2026-04-15",
	});
	await report(ids.approvedInPeriod, {
		kind: "standalone",
		status: "approved",
		expenseDate: "2026-04-15",
	});
	await report(ids.foreignSubmitted, {
		organizationId: OTHER_ORG,
		employeeId: ids.foreigner,
		kind: "standalone",
		status: "submitted",
		expenseDate: "2026-04-15",
	});
}

describe("payroll readiness travel expense warning", () => {
	beforeEach(seed);
	afterAll(cleanup);

	it("skips converted legacy drafts and counts submitted reports of the period in the organization", async () => {
		const result = await getPayrollReadiness({
			organizationId: ORG,
			period: {
				start: DateTime.fromISO("2026-04-01T00:00:00", { zone: "Europe/Berlin" }),
				end: DateTime.fromISO("2026-04-30T00:00:00", { zone: "Europe/Berlin" }),
			},
			now: DateTime.fromISO("2026-05-02T12:00:00Z"),
		});
		const check = result.groups
			.flatMap((group) => group.checks)
			.find((candidate) => candidate.id === "travel-expense-warnings");
		// The open legacy claim plus the two submitted reports dated in the period.
		expect(check).toMatchObject({
			status: "warning",
			count: 3,
			actionHref: "/approvals/inbox?types=travel_expense_report,travel_expense_claim",
		});
		expect(check?.affectedEmployees.map((employee) => employee.id)).toEqual([ids.employee]);

		// Once the open draft is converted too, only the pending reports remain.
		await report("e7002000-0000-4000-8000-000000000008", { kind: "standalone", status: "draft" });
		await admin.query(
			`insert into travel_expense_legacy_draft_conversion (organization_id, employee_id, claim_id, report_id,
			   item_id, legacy_facts, converted_by_user_id, converted_at)
			 values ($1, $2, $3, 'e7002000-0000-4000-8000-000000000008', gen_random_uuid(), '{}'::jsonb, 'tpr-user', now())`,
			[ORG, ids.employee, ids.openClaim],
		);
		const later = await getPayrollReadiness({
			organizationId: ORG,
			period: {
				start: DateTime.fromISO("2026-04-01T00:00:00", { zone: "Europe/Berlin" }),
				end: DateTime.fromISO("2026-04-30T00:00:00", { zone: "Europe/Berlin" }),
			},
			now: DateTime.fromISO("2026-05-02T12:00:00Z"),
		});
		expect(
			later.groups
				.flatMap((group) => group.checks)
				.find((candidate) => candidate.id === "travel-expense-warnings")?.count,
		).toBe(2);
	});
});
