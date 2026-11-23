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
	approved: "e1979100-0000-4000-8000-000000000009",
	adjustment: "e1979100-0000-4000-8000-00000000000a",
	exceptionOpen: "e1979200-0000-4000-8000-000000000001",
	exceptionLapsed: "e1979200-0000-4000-8000-000000000002",
	exceptionRejected: "e1979200-0000-4000-8000-000000000003",
	exceptionUsed: "e1979200-0000-4000-8000-000000000004",
	exceptionColleague: "e1979200-0000-4000-8000-000000000005",
	exceptionForeign: "e1979200-0000-4000-8000-000000000006",
	exceptionExpired: "e1979200-0000-4000-8000-000000000007",
	trip: "e1979100-0000-4000-8000-00000000000b",
	tripOneDay: "e1979100-0000-4000-8000-00000000000c",
	unlistedOriginal: "e1979100-0000-4000-8000-00000000000d",
	adjustmentOfUnlisted: "e1979100-0000-4000-8000-00000000000e",
	adjustmentOfColleagues: "e1979100-0000-4000-8000-00000000000f",
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
		/** A trip report with this purpose and these stored travel days; standalone without it. */
		trip?: { purpose: string; start: string | null; end: string | null };
	},
) {
	const organizationId = input.organizationId ?? ORG;
	const submitted = input.status !== "draft";
	const decided = submitted && input.status !== "submitted";
	await admin.query(
		`insert into travel_expense_report (id, organization_id, employee_id, kind, status, reimbursement_currency,
		   submission_count, submitted_at, decided_at, created_by, trip_purpose, trip_start_date, trip_end_date,
		   trip_time_zone)
		 values ($1, $2, $3, $4, $5, 'EUR', $6, $7, $8, 't1979-requester', $9, $10, $11, $12)`,
		[
			id,
			organizationId,
			input.employeeId ?? ids.requester,
			input.trip ? "trip" : "standalone",
			input.status,
			input.submissionCount ?? (submitted ? 1 : 0),
			submitted ? "2026-11-10T09:00:00Z" : null,
			decided ? "2026-11-12T09:00:00Z" : null,
			input.trip?.purpose ?? null,
			input.trip?.start ?? null,
			input.trip?.end ?? null,
			input.trip ? "Europe/Berlin" : null,
		],
	);
}

/** Marks `reportId` as an adjustment (#615) of `originalReportId`, filed by the requester. */
async function adjustment(reportId: string, originalReportId: string) {
	await admin.query(
		`insert into travel_expense_report_adjustment (organization_id, report_id, original_report_id,
		   source_report_id, source_revision_id, reason, idempotency_key, created_by_employee_id, created_by_user_id)
		 values ($1, $2, $3, $3, gen_random_uuid(), 'Hotel was cheaper', $4, $5, 't1979-requester')`,
		[ORG, reportId, originalReportId, `t1979-${reportId}`, ids.requester],
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

/** The viewer's own zone, unlike the organization's (Europe/Berlin): windows are read in it. */
const VIEWER_TIME_ZONE = "America/New_York";

async function requestsOf(employeeId: string, organizationId = ORG) {
	const result = await getSelfServiceRequests({
		employeeId,
		organizationId,
		now: NOW,
		sources: ["travel_expense_report", "compliance_exception"],
		timeZone: VIEWER_TIME_ZONE,
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

	it("names a standalone report by its own expense and gives the viewer's zone", async () => {
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
			timeZone: VIEWER_TIME_ZONE,
		});
		const byId = new Map(result.items.map((item) => [item.sourceId, item]));

		expect(result.timeZone).toBe(VIEWER_TIME_ZONE);
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

	it("names a trip report by its purpose with its travel days, or the one day it has", async () => {
		await report(ids.trip, {
			status: "submitted",
			trip: { purpose: "Customer workshop", start: "2026-11-02", end: "2026-11-04" },
		});
		await report(ids.tripOneDay, {
			status: "submitted",
			trip: { purpose: "Trade fair", start: "2026-11-06", end: null },
		});

		const byId = new Map((await requestsOf(ids.requester)).map((item) => [item.sourceId, item]));

		expect(byId.get(ids.trip)).toMatchObject({
			title: "Customer workshop",
			subtitle: "2026-11-02 to 2026-11-04",
			details: { kind: "expense_report", reportKind: "trip", itemType: null },
		});
		expect(byId.get(ids.tripOneDay)).toMatchObject({ title: "Trade fair", subtitle: "2026-11-06" });
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
			details: { kind: "compliance_exception", timeZone: VIEWER_TIME_ZONE },
		});
	});

	it("lists a plain approved report and marks an adjustment with the report it adjusts", async () => {
		await report(ids.approved, { status: "approved" });
		// An adjustment copies its original's expense, so both carry the same name.
		await report(ids.adjustment, { status: "submitted" });
		await admin.query(
			`insert into travel_expense_report_item (organization_id, report_id, type, position, description)
			 values ($1, $2, 'receipt', 0, 'Hotel Hamburg'), ($1, $3, 'receipt', 0, 'Hotel Hamburg')`,
			[ORG, ids.approved, ids.adjustment],
		);
		await admin.query(
			`insert into travel_expense_report_adjustment (organization_id, report_id, original_report_id,
			   source_report_id, source_revision_id, reason, idempotency_key, created_by_employee_id, created_by_user_id)
			 values ($1, $2, $3, $3, gen_random_uuid(), 'Hotel was cheaper', 't1979-adjustment', $4, 't1979-requester')`,
			[ORG, ids.adjustment, ids.approved, ids.requester],
		);

		const byId = new Map((await requestsOf(ids.requester)).map((item) => [item.sourceId, item]));

		expect(byId.get(ids.approved)).toMatchObject({
			status: "approved",
			resolvedAt: new Date("2026-11-12T09:00:00Z"),
			decisionReason: null,
			availableActions: ["view"],
			title: "Hotel Hamburg",
		});
		expect(byId.get(ids.approved)?.details).not.toHaveProperty("adjustmentOf");
		expect(byId.get(ids.adjustment)).toMatchObject({
			status: "pending",
			title: "Hotel Hamburg",
			details: {
				kind: "expense_report",
				adjustmentOf: { reportId: ids.approved, title: "Hotel Hamburg" },
			},
		});
	});

	it("names an adjusted report that is not listed by reading it by id", async () => {
		// The original went back to draft, so it is not among the listed reports.
		await report(ids.unlistedOriginal, { status: "draft" });
		await report(ids.adjustmentOfUnlisted, { status: "submitted" });
		await admin.query(
			`insert into travel_expense_report_item (organization_id, report_id, type, position, description)
			 values ($1, $2, 'receipt', 0, 'Train to Berlin'), ($1, $3, 'receipt', 0, 'Train to Berlin')`,
			[ORG, ids.unlistedOriginal, ids.adjustmentOfUnlisted],
		);
		await adjustment(ids.adjustmentOfUnlisted, ids.unlistedOriginal);

		const items = await requestsOf(ids.requester);

		expect(items.map((item) => item.sourceId)).not.toContain(ids.unlistedOriginal);
		expect(items.find((item) => item.sourceId === ids.adjustmentOfUnlisted)?.details).toEqual({
			kind: "expense_report",
			reportKind: "standalone",
			itemType: "receipt",
			adjustmentOf: { reportId: ids.unlistedOriginal, title: "Train to Berlin" },
		});
	});

	it("never names another employee's report that an adjustment points at", async () => {
		await admin.query(
			`insert into travel_expense_report_item (organization_id, report_id, type, position, description)
			 values ($1, $2, 'receipt', 0, 'Colleague hotel')`,
			[ORG, ids.colleagues],
		);
		await report(ids.adjustmentOfColleagues, {
			status: "submitted",
			trip: { purpose: "Customer workshop", start: "2026-11-02", end: "2026-11-02" },
		});
		await adjustment(ids.adjustmentOfColleagues, ids.colleagues);

		const items = await requestsOf(ids.requester);
		const item = items.find((candidate) => candidate.sourceId === ids.adjustmentOfColleagues);

		expect(item?.details).toMatchObject({
			adjustmentOf: { reportId: ids.colleagues, title: null },
		});
		expect(JSON.stringify(items)).not.toContain("Colleague hotel");
	});

	it("counts what is in review, needs a fix, was decided in the last 30 days, and in total", async () => {
		const result = await getSelfServiceRequests({
			employeeId: ids.requester,
			organizationId: ORG,
			now: NOW,
			sources: ["travel_expense_report", "compliance_exception"],
			timeZone: VIEWER_TIME_ZONE,
		});

		// In review: the submitted report and the open exception. Fixes: the returned and the
		// reopened report. Decided: both rejected reports, the rejected and the used exception;
		// the expired exception is none of these.
		expect(result.counts).toEqual({
			pending: 2,
			requiredFixes: 2,
			recentDecisions: 4,
			total: 9,
		});
	});

	it("shows a persisted expired exception as expired, undecided", async () => {
		await exception(ids.exceptionExpired, {
			status: "expired",
			validUntil: "2026-11-19T06:00:00Z",
		});

		const item = (await requestsOf(ids.requester)).find(
			(candidate) => candidate.sourceId === ids.exceptionExpired,
		);

		expect(item).toMatchObject({ status: "expired", resolvedAt: null, decisionReason: null });
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
