/**
 * #1979: My Requests lists an employee's expense reports and ArbZG compliance exceptions, read
 * from a disposable PostgreSQL database: drafts stay out, reviewer notes come from the current
 * cycle's return or reopen, a rejection shows only the final decision's reason, a pending
 * exception past its window reads as expired, and nothing crosses employees or organizations.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { getSelfServiceRequests } = await import("./get-self-service-requests");

const admin = integrationAdminPool();
const ORG = "t1979-org";
const OTHER_ORG = "t1979-other";
const NOW = new Date("2026-11-20T12:00:00.000Z");
const ids = {
	requester: "e1979000-0000-4000-8000-000000000001",
	reviewer: "e1979000-0000-4000-8000-000000000002",
	colleague: "e1979000-0000-4000-8000-000000000003",
	foreigner: "e1979000-0000-4000-8000-000000000004",
	draft: "e1979100-0000-4000-8000-000000000001",
	submitted: "e1979100-0000-4000-8000-000000000002",
	returned: "e1979100-0000-4000-8000-000000000003",
	reopened: "e1979100-0000-4000-8000-000000000004",
	rejected: "e1979100-0000-4000-8000-000000000005",
	rejectedSilently: "e1979100-0000-4000-8000-000000000006",
	colleagues: "e1979100-0000-4000-8000-000000000007",
	foreign: "e1979100-0000-4000-8000-000000000008",
	exceptionOpen: "e1979200-0000-4000-8000-000000000001",
	exceptionLapsed: "e1979200-0000-4000-8000-000000000002",
	exceptionRejected: "e1979200-0000-4000-8000-000000000003",
	exceptionUsed: "e1979200-0000-4000-8000-000000000004",
	exceptionColleague: "e1979200-0000-4000-8000-000000000005",
	exceptionForeign: "e1979200-0000-4000-8000-000000000006",
} as const;

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [ORG, OTHER_ORG]);
	await admin.query('delete from "user" where id like $1', ["t1979-%"]);
}

async function report(
	id: string,
	input: {
		status: "draft" | "submitted" | "returned" | "approved" | "rejected";
		submissionCount?: number;
		employeeId?: string;
		organizationId?: string;
	},
) {
	const organizationId = input.organizationId ?? ORG;
	const submitted = input.status !== "draft";
	const decided = submitted && input.status !== "submitted";
	await admin.query(
		`insert into travel_expense_report (id, organization_id, employee_id, kind, status, reimbursement_currency,
		   submission_count, submitted_at, decided_at, created_by)
		 values ($1, $2, $3, 'standalone', $4, 'EUR', $5, $6, $7, 't1979-requester')`,
		[
			id,
			organizationId,
			input.employeeId ?? ids.requester,
			input.status,
			input.submissionCount ?? (submitted ? 1 : 0),
			submitted ? "2026-11-10T09:00:00Z" : null,
			decided ? "2026-11-12T09:00:00Z" : null,
		],
	);
}

/** One cycle's approval request; returning a cycle also leaves it `rejected` with the note. */
async function approvalRequest(
	reportId: string,
	input: { status: "approved" | "rejected"; reason: string | null; createdAt: string },
) {
	const { rows } = await admin.query<{ id: string }>(
		`insert into approval_request (organization_id, entity_type, entity_id, requested_by, approver_id,
		   status, rejection_reason, created_at, updated_at)
		 values ($1, 'travel_expense_report', $2, $3, $4, $5, $6, $7, now())
		 returning id`,
		[ORG, reportId, ids.requester, ids.reviewer, input.status, input.reason, input.createdAt],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("no approval request");
	return id;
}

async function closure(
	reportId: string,
	input: { cycle: number; kind: "returned" | "reopened"; note: string; approvalRequestId: string },
) {
	await admin.query(
		`insert into travel_expense_report_cycle_closure (organization_id, report_id, submission_cycle, kind, note,
		   submitted_revision_id, approval_request_id, decision_evidence_id, actor_employee_id, actor_user_id)
		 values ($1, $2, $3, $4, $5, gen_random_uuid(), $6, gen_random_uuid(), $7, 't1979-reviewer')`,
		[ORG, reportId, input.cycle, input.kind, input.note, input.approvalRequestId, ids.reviewer],
	);
}

async function exception(
	id: string,
	input: {
		status: "pending" | "approved" | "rejected" | "expired" | "used";
		validUntil: string;
		rejectionReason?: string;
		employeeId?: string;
		organizationId?: string;
	},
) {
	await admin.query(
		`insert into compliance_exception (id, organization_id, employee_id, exception_type, status, reason,
		   valid_from, valid_until, approved_at, rejected_at, rejection_reason, created_by, updated_at)
		 values ($1, $2, $3, 'overtime_daily', $4, 'Release night', $5::timestamptz - interval '24 hours', $5,
		   $6, $7, $8, 't1979-requester', now())`,
		[
			id,
			input.organizationId ?? ORG,
			input.employeeId ?? ids.requester,
			input.status,
			input.validUntil,
			input.status === "approved" || input.status === "used" ? "2026-11-19T08:00:00Z" : null,
			input.status === "rejected" ? "2026-11-19T08:00:00Z" : null,
			input.rejectionReason ?? null,
		],
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ($1, 'Requests', $1, 'Europe/Berlin', now()), ($2, 'Other', $2, 'UTC', now())`,
		[ORG, OTHER_ORG],
	);
	for (const [name, organizationId] of [
		["requester", ORG],
		["reviewer", ORG],
		["colleague", ORG],
		["foreigner", OTHER_ORG],
	] as const) {
		await admin.query(
			'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, now(), now())',
			[`t1979-${name}`, `t1979-${name}@example.test`],
		);
		await admin.query(
			"insert into employee (id, user_id, organization_id, role, updated_at) values ($1, $2, $3, 'employee', now())",
			[ids[name], `t1979-${name}`, organizationId],
		);
	}

	await report(ids.draft, { status: "draft" });
	await report(ids.submitted, { status: "submitted" });

	// Returned twice: only the current (second) cycle's note applies.
	await report(ids.returned, { status: "returned", submissionCount: 2 });
	await closure(ids.returned, {
		cycle: 1,
		kind: "returned",
		note: "Earlier return note",
		approvalRequestId: await approvalRequest(ids.returned, {
			status: "rejected",
			reason: "Earlier return note",
			createdAt: "2026-11-10T09:00:00Z",
		}),
	});
	await closure(ids.returned, {
		cycle: 2,
		kind: "returned",
		note: "Add the hotel receipt",
		approvalRequestId: await approvalRequest(ids.returned, {
			status: "rejected",
			reason: "Add the hotel receipt",
			createdAt: "2026-11-11T09:00:00Z",
		}),
	});

	// Approved, then reopened for correction: the report is returned with the reopen reason.
	await report(ids.reopened, { status: "returned" });
	await closure(ids.reopened, {
		cycle: 1,
		kind: "reopened",
		note: "The invoice shows the wrong dates",
		approvalRequestId: await approvalRequest(ids.reopened, {
			status: "approved",
			reason: null,
			createdAt: "2026-11-10T09:00:00Z",
		}),
	});

	// Returned once, then rejected with a reason, and once without one.
	for (const [reportId, finalReason] of [
		[ids.rejected, "Not a business trip"],
		[ids.rejectedSilently, null],
	] as const) {
		await report(reportId, { status: "rejected", submissionCount: 2 });
		await closure(reportId, {
			cycle: 1,
			kind: "returned",
			note: "Split the taxi receipts",
			approvalRequestId: await approvalRequest(reportId, {
				status: "rejected",
				reason: "Split the taxi receipts",
				createdAt: "2026-11-10T09:00:00Z",
			}),
		});
		await approvalRequest(reportId, {
			status: "rejected",
			reason: finalReason,
			createdAt: "2026-11-11T09:00:00Z",
		});
	}

	await report(ids.colleagues, { status: "submitted", employeeId: ids.colleague });
	await admin.query(
		`insert into travel_expense_report (id, organization_id, employee_id, kind, status, reimbursement_currency,
		   submission_count, submitted_at, created_by)
		 values ($1, $2, $3, 'standalone', 'submitted', 'EUR', 1, now(), 't1979-foreigner')`,
		[ids.foreign, OTHER_ORG, ids.foreigner],
	);

	await exception(ids.exceptionOpen, { status: "pending", validUntil: "2026-11-21T06:00:00Z" });
	await exception(ids.exceptionLapsed, { status: "pending", validUntil: "2026-11-20T06:00:00Z" });
	await exception(ids.exceptionRejected, {
		status: "rejected",
		validUntil: "2026-11-21T06:00:00Z",
		rejectionReason: "Team is fully staffed",
	});
	await exception(ids.exceptionUsed, { status: "used", validUntil: "2026-11-20T06:00:00Z" });
	await exception(ids.exceptionColleague, {
		status: "pending",
		validUntil: "2026-11-21T06:00:00Z",
		employeeId: ids.colleague,
	});
	await exception(ids.exceptionForeign, {
		status: "pending",
		validUntil: "2026-11-21T06:00:00Z",
		employeeId: ids.foreigner,
		organizationId: OTHER_ORG,
	});
}

async function requestsOf(employeeId: string, organizationId = ORG) {
	const result = await getSelfServiceRequests({
		employeeId,
		organizationId,
		now: NOW,
		sources: ["travel_expense_report", "compliance_exception"],
	});
	expect(result.sourceErrors).toEqual([]);
	return result.items;
}

describe("My Requests expense reports and compliance exceptions (#1979)", () => {
	beforeEach(seed);
	afterAll(cleanup);

	it("lists submitted reports with the current cycle's reviewer note or final rejection reason", async () => {
		const items = await requestsOf(ids.requester);
		const reports = items.filter((item) => item.sourceType === "travel_expense_report");
		const byId = new Map(reports.map((item) => [item.sourceId, item]));

		expect([...byId.keys()].sort()).toEqual(
			[ids.submitted, ids.returned, ids.reopened, ids.rejected, ids.rejectedSilently].sort(),
		);
		expect(byId.get(ids.submitted)).toMatchObject({ status: "pending", decisionReason: null });
		expect(byId.get(ids.returned)).toMatchObject({
			status: "returned",
			decisionReason: "Add the hotel receipt",
			availableActions: ["fix", "view"],
		});
		expect(byId.get(ids.reopened)).toMatchObject({
			status: "returned",
			decisionReason: "The invoice shows the wrong dates",
			availableActions: ["fix", "view"],
		});
		expect(byId.get(ids.rejected)).toMatchObject({
			status: "rejected",
			decisionReason: "Not a business trip",
			availableActions: ["view"],
		});
		expect(byId.get(ids.rejectedSilently)).toMatchObject({
			status: "rejected",
			decisionReason: null,
		});
	});

	it("names a standalone report by its own expense and gives the organization's zone", async () => {
		await admin.query(
			`insert into travel_expense_report_item (organization_id, report_id, type, position, description, mileage_route)
			 values ($1, $2, 'receipt', 0, 'Hotel Hamburg', null), ($1, $3, 'mileage', 0, null, 'Office – Customer')`,
			[ORG, ids.submitted, ids.returned],
		);

		const result = await getSelfServiceRequests({
			employeeId: ids.requester,
			organizationId: ORG,
			now: NOW,
			sources: ["travel_expense_report"],
		});
		const byId = new Map(result.items.map((item) => [item.sourceId, item]));

		expect(result.timeZone).toBe("Europe/Berlin");
		expect(byId.get(ids.submitted)).toMatchObject({
			title: "Hotel Hamburg",
			subtitle: "",
			details: { kind: "expense_report", reportKind: "standalone", itemType: "receipt" },
		});
		expect(byId.get(ids.returned)).toMatchObject({
			title: "Office – Customer",
			details: { kind: "expense_report", reportKind: "standalone", itemType: "mileage" },
		});
		expect(byId.get(ids.rejected)).toMatchObject({
			title: "",
			details: { kind: "expense_report", reportKind: "standalone", itemType: null },
		});
	});

	it("shows a pending exception past its window as expired and keeps decided ones", async () => {
		const items = await requestsOf(ids.requester);
		const statuses = Object.fromEntries(
			items
				.filter((item) => item.sourceType === "compliance_exception")
				.map((item) => [item.sourceId, item.status]),
		);

		expect(statuses).toEqual({
			[ids.exceptionOpen]: "pending",
			[ids.exceptionLapsed]: "expired",
			[ids.exceptionRejected]: "rejected",
			[ids.exceptionUsed]: "approved",
		});
		expect(items.find((item) => item.sourceId === ids.exceptionRejected)).toMatchObject({
			decisionReason: "Team is fully staffed",
			details: { kind: "compliance_exception", timeZone: "Europe/Berlin" },
		});
	});

	it("never shows another employee's or organization's requests", async () => {
		expect((await requestsOf(ids.colleague)).map((item) => item.sourceId).sort()).toEqual(
			[ids.colleagues, ids.exceptionColleague].sort(),
		);
		expect(await requestsOf(ids.requester, OTHER_ORG)).toEqual([]);
		expect(
			(await requestsOf(ids.foreigner, OTHER_ORG)).map((item) => item.sourceId).sort(),
		).toEqual([ids.foreign, ids.exceptionForeign].sort());
		expect(await requestsOf(ids.foreigner)).toEqual([]);
	});
});
