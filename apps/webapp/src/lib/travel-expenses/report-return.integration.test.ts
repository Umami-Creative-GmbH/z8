/**
 * #603: return, withdraw and resubmit travel expense reports without losing history.
 *
 * The real report actions, receipt upload route, Approvals inbox routes and
 * decision owners run against a disposable PostgreSQL database. Only the
 * session, notifications and object storage are replaced.
 */

import { Effect } from "effect";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t603-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	notifications: [] as Array<{ action: string; reportId: string; reason?: string }>,
	/** Who each decision notification names as the decider (#1016). */
	deciders: [] as string[],
}));
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
vi.mock("@/env", async (original) => ({
	env: {
		...(await original<typeof import("@/env")>()).env,
		TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES: "1024",
	},
}));
vi.mock("@/lib/notifications/triggers", async (original) => ({
	...(await original<typeof import("@/lib/notifications/triggers")>()),
	onTravelExpenseReportDecided: async (params: {
		action: string;
		reportId: string;
		approverName: string;
		rejectionReason?: string;
	}) => {
		harness.deciders.push(params.approverName);
		harness.notifications.push({
			action: params.action,
			reportId: params.reportId,
			...(params.rejectionReason ? { reason: params.rejectionReason } : {}),
		});
	},
	onTravelExpenseReportReturned: async (params: { reportId: string; note: string }) => {
		harness.notifications.push({
			action: "return",
			reportId: params.reportId,
			reason: params.note,
		});
	},
}));
// An unawaited delivery pass would outlive its test and deadlock the next cleanup.
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t603-public",
	s3Client: {
		async send(command: { input: { Key: string } }) {
			if (command.constructor.name === "DeleteObjectCommand") {
				harness.tus.delete(command.input.Key);
				return {};
			}
			const bytes = harness.tus.get(command.input.Key);
			if (!bytes) throw new Error("NoSuchKey");
			return {
				ContentLength: bytes.length,
				Body: { transformToByteArray: async () => new Uint8Array(bytes) },
			};
		},
	},
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject(_organizationId: string, key: string, data: Buffer) {
		harness.objects.set(key, Buffer.from(data));
		return { bucket: "t603-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		harness.objects.delete(input.key);
	},
}));

const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { GET: getReceipt } = await import(
	"@/app/api/travel-expenses/reports/[reportId]/receipts/[receiptId]/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/approvals/inbox/[id]/reject/route");
const { TravelExpenseReportHandler } = await import(
	"@/lib/approvals/handlers/travel-expense-report.handler"
);
const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e6030000-0000-4000-8000-000000000001",
	manager: "e6030000-0000-4000-8000-000000000002",
	lead: "e6030000-0000-4000-8000-000000000003",
	finance: "e6030000-0000-4000-8000-000000000004",
	colleague: "e6030000-0000-4000-8000-000000000005",
	foreigner: "e6030000-0000-4000-8000-000000000006",
	team: "e6031000-0000-4000-8000-000000000001",
	policy: "e6032000-0000-4000-8000-000000000001",
	firstStage: "e6032000-0000-4000-8000-000000000002",
	secondStage: "e6032000-0000-4000-8000-000000000003",
} as const;
type Person = "requester" | "manager" | "lead" | "finance" | "colleague" | "foreigner";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t603-org', 't603-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't603-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t603-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t603-org','Expenses','t603-org','Europe/Berlin',now()),
		 ('t603-foreign','Foreign','t603-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", ids.requester, "t603-org", "employee"],
		["manager", ids.manager, "t603-org", "manager"],
		["lead", ids.lead, "t603-org", "manager"],
		["finance", ids.finance, "t603-org", "manager"],
		["colleague", ids.colleague, "t603-org", "employee"],
		["foreigner", ids.foreigner, "t603-foreign", "admin"],
	];
	for (const [name, employeeId, organizationId, role] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t603-${name}`, name, `t603-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'member','approved',now())",
			[`t603-member-${name}`, organizationId, `t603-${name}`],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[employeeId, `t603-${name}`, organizationId, role],
		);
	}
	await linkManager(ids.manager);
}

async function linkManager(managerId: string | null) {
	await admin.query("delete from employee_managers where employee_id = $1", [ids.requester]);
	if (managerId) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't603-manager', now(), now())`,
			[ids.requester, managerId],
		);
	}
}

function signIn(name: Person) {
	harness.userId = `t603-${name}`;
	harness.organizationId = name === "foreigner" ? "t603-foreign" : "t603-org";
}

async function load(reportId: string) {
	signIn("requester");
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function upload(reportId: string, itemId: string, bytes: Buffer = pdfBytes) {
	signIn("requester");
	const tusFileKey = createOwnedTusFileKey("t603-requester");
	harness.tus.set(tusFileKey, bytes);
	return processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId, fileName: "receipt.pdf" }),
		}) as unknown as NextRequest,
	);
}

async function saveItem(
	reportId: string,
	item: { id: string; version: number },
	overrides: Record<string, string | null> = {},
) {
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: "2026-09-14",
			category: "transport",
			description: "Train to Hamburg",
			amount: "89.90",
			currency: "EUR",
			paidBy: "employee",
			accountingReference: null,
			...overrides,
		},
	});
	if (!saved.success || saved.data.status !== "saved") throw new Error("save failed");
}

/** A complete trip: an employee-paid train ticket and a company-paid hotel. */
async function completeTrip(options: { companyPaidOnly?: boolean } = {}) {
	signIn("requester");
	const created = await actions.createTripReportAction();
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	const report = await load(reportId);
	const details = await actions.saveTripDetailsDraftAction({
		reportId,
		expectedVersion: report.trip?.version ?? 1,
		values: {
			purpose: "Customer workshop",
			startDate: "2026-09-14",
			endDate: "2026-09-16",
			timeZone: "Europe/Berlin",
			destinations: [{ place: "Hamburg", countryCode: "DE" }],
		},
	});
	if (!details.success) throw new Error("details failed");
	for (const values of [
		{ paidBy: options.companyPaidOnly ? "company" : "employee" },
		{
			category: "accommodation",
			description: "Hotel, two nights",
			amount: "240.00",
			paidBy: "company",
		},
	]) {
		const added = await actions.addTripReportItemAction({ reportId });
		if (!added.success) throw new Error("add failed");
		await saveItem(reportId, added.data.item, values);
		expect((await upload(reportId, added.data.item.id)).status).toBe(200);
	}
	return reportId;
}

async function reviewed(reportId: string) {
	const report = await load(reportId);
	return {
		detailsVersion: report.kind === "trip" ? (report.trip?.version ?? null) : null,
		items: report.items.map((item) => ({
			id: item.id,
			version: item.version,
			receiptIds: item.receipts.map((receipt) => receipt.id),
		})),
	};
}

async function submit(reportId: string, versions?: Awaited<ReturnType<typeof reviewed>>) {
	const reviewedVersions = versions ?? (await reviewed(reportId));
	signIn("requester");
	return actions.submitTravelExpenseReportAction({ reportId, reviewed: reviewedVersions });
}

async function reportState(reportId: string) {
	const { rows } = await admin.query<{
		status: string;
		submission_count: number;
		requests: Array<{
			id: string;
			status: string;
			approver_id: string;
			rejection_reason: string | null;
		}>;
		revisions: number;
		decisions: number;
	}>(
		`select r.status, r.submission_count,
		   coalesce((select json_agg(json_build_object('id', a.id, 'status', a.status,
		       'approver_id', a.approver_id, 'rejection_reason', a.rejection_reason) order by a.created_at)
		     from approval_request a where a.organization_id = r.organization_id
		       and a.entity_type = 'travel_expense_report' and a.entity_id = r.id), '[]') as requests,
		   (select count(*)::int from approval_submitted_revision s
		     where s.organization_id = r.organization_id and s.source_id = r.id) as revisions,
		   (select count(*)::int from approval_decision_evidence d
		     join approval_submitted_revision s on s.id = d.submitted_revision_id
		     where s.source_id = r.id) as decisions
		 from travel_expense_report r where r.id = $1`,
		[reportId],
	);
	const row = rows[0];
	if (!row) throw new Error("report missing");
	return row;
}

async function revisionOf(reportId: string) {
	const { rows } = await admin.query(
		"select * from approval_submitted_revision where source_type = 'travel_expense_report' and source_id = $1",
		[reportId],
	);
	expect(rows).toHaveLength(1);
	return rows[0];
}

async function pendingRequestId(reportId: string) {
	const state = await reportState(reportId);
	const pending = state.requests.find((request) => request.status === "pending");
	if (!pending) throw new Error("no pending request");
	return pending.id;
}

function decide(kind: "approve" | "reject", requestId: string, reason?: string) {
	const route = kind === "approve" ? approveRoute : rejectRoute;
	return route(
		new Request(`http://localhost/api/approvals/inbox/${requestId}/${kind}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(reason === undefined ? {} : { reason }),
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: requestId }) },
	);
}

async function waitForLockWaiters(count: number) {
	for (let attempt = 0; attempt < 400; attempt += 1) {
		const { rows } = await admin.query<{ waiters: number }>(
			`select count(*)::int as waiters from pg_stat_activity
			 where datname = current_database() and wait_event_type = 'Lock'`,
		);
		if ((rows[0]?.waiters ?? 0) >= count) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Expected ${count} blocked sessions`);
}

const reviewActions = await import("@/app/[locale]/(app)/travel-expenses/report-review-actions");

function returnReport(
	approvalId: string,
	note: string,
	itemComments: Array<{ itemId: string; body: string }> = [],
) {
	return reviewActions.returnTravelExpenseReportAction({ approvalId, note, itemComments });
}

function withdraw(reportId: string, submissionCycle: number) {
	signIn("requester");
	return reviewActions.withdrawTravelExpenseReportAction({ reportId, submissionCycle });
}

async function revisionsOf(reportId: string) {
	const { rows } = await admin.query(
		`select * from approval_submitted_revision
		 where source_type = 'travel_expense_report' and source_id = $1 order by submitted_at`,
		[reportId],
	);
	return rows;
}

async function closuresOf(reportId: string) {
	const { rows } = await admin.query<{
		id: string;
		submission_cycle: number;
		kind: string;
		note: string | null;
		approval_request_id: string;
		notes: Array<{ item_id: string; body: string }>;
	}>(
		`select c.id, c.submission_cycle, c.kind, c.note, c.approval_request_id,
		   coalesce((select json_agg(json_build_object('item_id', n.item_id, 'body', n.body))
		     from travel_expense_report_review_note n where n.closure_id = c.id), '[]') as notes
		 from travel_expense_report_cycle_closure c where c.report_id = $1 order by c.submission_cycle`,
		[reportId],
	);
	return rows;
}

function getReceiptResponse(reportId: string, receiptId: string, query = "") {
	return getReceipt(
		new Request(
			`http://localhost/api/travel-expenses/reports/${reportId}/receipts/${receiptId}${query}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ reportId, receiptId }) },
	);
}

async function holdRequestLock(requestId: string): Promise<PoolClient> {
	const holder = await admin.connect();
	await holder.query("begin");
	await holder.query("select id from approval_request where id = $1 for update", [requestId]);
	return holder;
}

/** Queues `first`, then `second` behind a held request row lock, then releases it. */
async function raceOnRequestLock<A, B>(
	requestId: string,
	first: () => Promise<A>,
	second: () => Promise<B>,
): Promise<[A, B]> {
	const holder = await holdRequestLock(requestId);
	const firstDone = first();
	await waitForLockWaiters(1);
	const secondDone = second();
	await waitForLockWaiters(2);
	await holder.query("commit");
	holder.release();
	return Promise.all([firstDone, secondDone]);
}

async function addPolicyChain() {
	await admin.query(
		`insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at)
		 values ($1, 't603-org', 'T603 two stages', true, 1, 't603-manager', now())`,
		[ids.policy],
	);
	await admin.query(
		`insert into approval_policy_stage (id, organization_id, policy_id, step_order, label, approver_type,
		   approver_employee_id, fallback_behavior, updated_at) values
		 ($1, 't603-org', $3, 1, 'Manager', 'direct_manager', null, 'fail', now()),
		 ($2, 't603-org', $3, 2, 'Finance', 'specific_employee', $4, 'fail', now())`,
		[ids.firstStage, ids.secondStage, ids.policy, ids.finance],
	);
}

describe("return, withdraw and resubmit reports (#603)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.notifications = [];
		harness.deciders = [];
	});
	afterAll(cleanup);

	it("refuses to resubmit a returned report while an expense is future-dated (#685)", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		signIn("manager");
		expect(await returnReport(await pendingRequestId(reportId), "Check the dates")).toEqual({
			success: true,
			data: { status: "returned" },
		});
		const [train] = (await load(reportId)).items;
		if (!train) throw new Error("item missing");
		await saveItem(reportId, train, { expenseDate: "2099-01-15" });

		expect(await submit(reportId)).toEqual({
			success: true,
			data: {
				status: "incomplete",
				missing: { trip: [], items: [{ id: train.id, missing: ["future_date"] }] },
			},
		});
		expect(await reportState(reportId)).toMatchObject({
			status: "returned",
			submission_count: 1,
			revisions: 1,
		});
	});

	it("returns a report with a required note and item comments, then resubmits the correction as a new cycle", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const firstRequestId = await pendingRequestId(reportId);
		const [train, hotel] = (await load(reportId)).items;
		if (!train || !hotel) throw new Error("items missing");

		signIn("manager");
		expect(await returnReport(firstRequestId, "   ")).toMatchObject({ success: false });
		expect((await reportState(reportId)).status).toBe("submitted");
		expect(
			await returnReport(firstRequestId, "Please fix", [{ itemId: ids.policy, body: "?" }]),
		).toMatchObject({ success: false });
		expect(
			await returnReport(firstRequestId, " The hotel invoice is not itemized. ", [
				{ itemId: hotel.id, body: "Upload the itemized invoice" },
				{ itemId: train.id, body: "  " },
			]),
		).toEqual({ success: true, data: { status: "returned" } });

		const returned = await reportState(reportId);
		expect(returned).toMatchObject({
			status: "returned",
			submission_count: 1,
			revisions: 1,
			decisions: 1,
			requests: [
				expect.objectContaining({
					id: firstRequestId,
					status: "rejected",
					rejection_reason: "The hotel invoice is not itemized.",
				}),
			],
		});
		expect(await closuresOf(reportId)).toEqual([
			expect.objectContaining({
				submission_cycle: 1,
				kind: "returned",
				note: "The hotel invoice is not itemized.",
				approval_request_id: firstRequestId,
				notes: [{ item_id: hotel.id, body: "Upload the itemized invoice" }],
			}),
		]);
		expect(harness.notifications).toEqual([
			{ action: "return", reportId, reason: "The hotel invoice is not itemized." },
		]);
		// An exact retry replays; a second return or a decision of the closed cycle is refused.
		expect(
			await returnReport(firstRequestId, "The hotel invoice is not itemized.", [
				{ itemId: hotel.id, body: "Upload the itemized invoice" },
			]),
		).toEqual({ success: true, data: { status: "returned" } });
		expect(await returnReport(firstRequestId, "Something else")).toMatchObject({ success: false });
		expect((await decide("approve", firstRequestId)).status).not.toBe(200);
		expect((await decide("reject", firstRequestId, "No")).status).not.toBe(200);
		expect(await reportState(reportId)).toMatchObject({ status: "returned", decisions: 1 });

		// The employee sees the note and comments and corrects the returned report.
		signIn("requester");
		const ownView = await actions.getTravelExpenseReportSubmission(reportId);
		if (!ownView.success) throw new Error(ownView.error);
		expect(ownView.data).toMatchObject({
			submissionCycle: 1,
			cycleOutcome: "returned",
			returned: {
				note: "The hotel invoice is not itemized.",
				reviewerName: "manager",
				itemComments: [
					{
						itemId: hotel.id,
						number: 2,
						description: "Hotel, two nights",
						body: "Upload the itemized invoice",
					},
				],
			},
		});
		expect(ownView.data.history.map((event) => event.label)).toEqual(["submitted", "returned"]);

		const frozenReceiptId = hotel.receipts[0]?.id ?? "";
		const frozenKey = (await revisionOf(reportId)).facts.items[1].receipts[0].object.key;
		await saveItem(reportId, hotel, {
			category: "accommodation",
			description: "Hotel, two nights (itemized)",
			amount: "240.00",
			paidBy: "company",
		});
		expect(
			await actions.removeReportReceiptAction({
				reportId,
				itemId: hotel.id,
				receiptId: frozenReceiptId,
			}),
		).toEqual({ success: true, data: { receiptId: frozenReceiptId } });
		expect(
			(await upload(reportId, hotel.id, Buffer.from("%PDF-1.4\n% itemized\n%%EOF"))).status,
		).toBe(200);
		// The removed receipt is still the evidence of the first submission: kept.
		const { rows: cleanups } = await admin.query(
			"select id from travel_expense_receipt_upload where id = $1",
			[frozenReceiptId],
		);
		expect(cleanups).toEqual([]);
		expect(harness.objects.has(frozenKey)).toBe(true);
		signIn("requester");
		expect((await getReceiptResponse(reportId, frozenReceiptId)).status).toBe(404);
		expect((await getReceiptResponse(reportId, frozenReceiptId, "?cycle=1")).status).toBe(200);

		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		const resubmitted = await reportState(reportId);
		expect(resubmitted).toMatchObject({ status: "submitted", submission_count: 2, revisions: 2 });
		expect(resubmitted.requests.map((request) => request.status)).toEqual(["rejected", "pending"]);
		const [first, second] = await revisionsOf(reportId);
		expect(first.request_cycle_key).toBe(`travel_expense_report:${reportId}:submission:1`);
		expect(second.request_cycle_key).toBe(`travel_expense_report:${reportId}:submission:2`);
		expect(first.facts.items[1].description).toBe("Hotel, two nights");
		expect(second.facts.items[1].description).toBe("Hotel, two nights (itemized)");
		const secondRequestId = await pendingRequestId(reportId);
		expect(secondRequestId).not.toBe(firstRequestId);

		// The superseded request of cycle 1 can neither decide nor return cycle 2.
		signIn("manager");
		expect((await decide("approve", firstRequestId)).status).not.toBe(200);
		expect(await returnReport(firstRequestId, "Again")).toMatchObject({ success: false });
		expect((await reportState(reportId)).status).toBe("submitted");

		// The reviewer reads both cycles, including the first cycle's frozen receipt.
		const reviewerFirst = await actions.getTravelExpenseReportSubmission(reportId, 1);
		if (!reviewerFirst.success) throw new Error(reviewerFirst.error);
		expect(reviewerFirst.data).toMatchObject({
			access: "reviewer",
			submissionCycle: 1,
			latestCycle: 2,
			cycleOutcome: "returned",
		});
		expect(reviewerFirst.data.facts.items[1]?.description).toBe("Hotel, two nights");
		expect((await getReceiptResponse(reportId, frozenReceiptId, "?cycle=1")).status).toBe(200);
		expect((await getReceiptResponse(reportId, frozenReceiptId)).status).toBe(404);

		expect((await decide("approve", secondRequestId)).status).toBe(200);
		signIn("requester");
		const finalView = await actions.getTravelExpenseReportSubmission(reportId);
		if (!finalView.success) throw new Error(finalView.error);
		expect(finalView.data).toMatchObject({
			submissionCycle: 2,
			cycleOutcome: "approved",
			returned: null,
			decision: { outcome: "approved" },
			cycles: [
				{ cycle: 1, outcome: "returned" },
				{ cycle: 2, outcome: "approved" },
			],
		});
		expect(finalView.data.history.map((event) => [event.cycle, event.label] as const)).toEqual([
			[1, "submitted"],
			[1, "returned"],
			[2, "submitted"],
			[2, "approved"],
		]);
	});

	it("withdraws a pending report back to draft, retires its review actions and keeps the submission", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);

		signIn("manager");
		expect(
			await reviewActions.withdrawTravelExpenseReportAction({ reportId, submissionCycle: 1 }),
		).toEqual({ success: false, error: "Expense report not found" });
		expect(await withdraw(reportId, 2)).toEqual({ success: true, data: { status: "not_pending" } });
		expect(await withdraw(reportId, 1)).toEqual({ success: true, data: { status: "withdrawn" } });
		const state = await reportState(reportId);
		expect(state).toMatchObject({
			status: "draft",
			submission_count: 1,
			revisions: 1,
			decisions: 0,
			requests: [
				expect.objectContaining({ id: requestId, status: "rejected", rejection_reason: null }),
			],
		});
		expect(await closuresOf(reportId)).toEqual([
			expect.objectContaining({ submission_cycle: 1, kind: "withdrawn", note: null, notes: [] }),
		]);
		// A retry is answered from the committed withdrawal.
		expect(await withdraw(reportId, 1)).toEqual({ success: true, data: { status: "withdrawn" } });

		// The withdrawn cycle's review actions are gone.
		signIn("manager");
		expect((await decide("approve", requestId)).status).not.toBe(200);
		expect(await returnReport(requestId, "Too late")).toMatchObject({ success: false });
		const replay = await Effect.runPromise(
			TravelExpenseReportHandler.approve(reportId, ids.manager, {
				approvalRequestId: requestId,
			}).pipe(Effect.provide(DatabaseServiceLive), Effect.result),
		);
		expect(replay._tag).toBe("Failure");
		expect(await reportState(reportId)).toMatchObject({ status: "draft", decisions: 0 });

		// The draft is editable and its earlier submission stays in its history.
		const [train] = (await load(reportId)).items;
		if (!train) throw new Error("item missing");
		await saveItem(reportId, train, { description: "Train to Hamburg, first class" });
		signIn("requester");
		const history = await actions.getTravelExpenseReportSubmission(reportId);
		expect(history.success && history.data).toMatchObject({
			submissionCycle: 1,
			cycleOutcome: "withdrawn",
			history: [
				expect.objectContaining({ label: "submitted" }),
				expect.objectContaining({ label: "withdrawn", actorName: "requester" }),
			],
		});

		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		expect(await reportState(reportId)).toMatchObject({ submission_count: 2, revisions: 2 });
		// A withdrawal naming the superseded cycle is stale.
		expect(await withdraw(reportId, 1)).toEqual({ success: true, data: { status: "not_pending" } });
		expect((await reportState(reportId)).status).toBe("submitted");
	});

	it("cancels the pending chain of a withdrawn multi-stage report", async () => {
		await addPolicyChain();
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		signIn("manager");
		expect((await decide("approve", await pendingRequestId(reportId))).status).toBe(200);
		const secondStageRequest = await pendingRequestId(reportId);

		expect(await withdraw(reportId, 1)).toEqual({ success: true, data: { status: "withdrawn" } });
		const { rows: chains } = await admin.query(
			`select c.status, json_agg(s.status order by s.step_order) as stages
			 from approval_chain_instance c join approval_chain_stage_instance s on s.chain_instance_id = c.id
			 where c.entity_id = $1 group by c.id`,
			[reportId],
		);
		expect(chains).toEqual([{ status: "cancelled", stages: ["approved", "cancelled"] }]);
		signIn("finance");
		expect((await decide("approve", secondStageRequest)).status).not.toBe(200);
		expect(await reportState(reportId)).toMatchObject({ status: "draft", decisions: 1 });
	});

	it("keeps rejected reports terminal", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);
		signIn("manager");
		expect((await decide("reject", requestId, "Not a business trip")).status).toBe(200);

		const [train] = (await load(reportId)).items;
		if (!train) throw new Error("item missing");
		signIn("requester");
		expect(
			await actions.saveReceiptItemDraftAction({
				reportId,
				itemId: train.id,
				expectedVersion: train.version,
				values: {
					expenseDate: "2026-09-14",
					category: "transport",
					description: "Changed",
					amount: "1.00",
					currency: "EUR",
					paidBy: "employee",
					accountingReference: null,
				},
			}),
		).toEqual({ success: false, error: "This expense can no longer be edited" });
		expect(await submit(reportId)).toEqual({
			success: false,
			error: "This expense report was already submitted",
		});
		expect(await withdraw(reportId, 1)).toEqual({ success: true, data: { status: "not_pending" } });
		signIn("manager");
		expect(await returnReport(requestId, "Reopen")).toMatchObject({ success: false });
		expect(await reportState(reportId)).toMatchObject({ status: "rejected", decisions: 1 });
	});

	it("decides a cycle once when a return races a double return or an approval", async () => {
		const doubled = await completeTrip();
		expect((await submit(doubled)).success).toBe(true);
		const doubledRequest = await pendingRequestId(doubled);
		signIn("manager");
		const [firstReturn, secondReturn] = await raceOnRequestLock(
			doubledRequest,
			() => returnReport(doubledRequest, "Missing invoice"),
			() => returnReport(doubledRequest, "Wrong dates"),
		);
		expect(firstReturn).toEqual({ success: true, data: { status: "returned" } });
		expect(secondReturn).toMatchObject({ success: false });
		expect(await reportState(doubled)).toMatchObject({ status: "returned", decisions: 1 });
		expect(await closuresOf(doubled)).toEqual([
			expect.objectContaining({ kind: "returned", note: "Missing invoice" }),
		]);

		const approvedFirst = await completeTrip();
		expect((await submit(approvedFirst)).success).toBe(true);
		const approvedRequest = await pendingRequestId(approvedFirst);
		signIn("manager");
		const [approved, lateReturn] = await raceOnRequestLock(
			approvedRequest,
			() => decide("approve", approvedRequest),
			() => returnReport(approvedRequest, "Too late"),
		);
		expect(approved.status).toBe(200);
		expect(lateReturn).toMatchObject({ success: false });
		expect(await reportState(approvedFirst)).toMatchObject({ status: "approved", decisions: 1 });
		expect(await closuresOf(approvedFirst)).toEqual([]);

		const returnedFirst = await completeTrip();
		expect((await submit(returnedFirst)).success).toBe(true);
		const returnedRequest = await pendingRequestId(returnedFirst);
		signIn("manager");
		const [returnedResult, lateApproval] = await raceOnRequestLock(
			returnedRequest,
			() => returnReport(returnedRequest, "Needs receipts"),
			() => decide("approve", returnedRequest),
		);
		expect(returnedResult).toEqual({ success: true, data: { status: "returned" } });
		expect(lateApproval.status).not.toBe(200);
		expect(await reportState(returnedFirst)).toMatchObject({ status: "returned", decisions: 1 });
	});

	it("serializes a withdrawal with a competing approval on the request", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);
		signIn("manager");
		const [approved, withdrawn] = await raceOnRequestLock(
			requestId,
			() => decide("approve", requestId),
			() => withdraw(reportId, 1),
		);
		expect(approved.status).toBe(200);
		expect(withdrawn).toEqual({ success: true, data: { status: "not_pending" } });
		expect(await reportState(reportId)).toMatchObject({ status: "approved", decisions: 1 });
		expect(await closuresOf(reportId)).toEqual([]);
	});

	it("follows a chain stage decided while the withdrawal waits, and keeps inconsistent cycles an error", async () => {
		await addPolicyChain();
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const firstStage = await pendingRequestId(reportId);
		signIn("manager");
		const [approved, withdrawn] = await raceOnRequestLock(
			firstStage,
			() => decide("approve", firstStage),
			() => withdraw(reportId, 1),
		);
		// The first stage was approved; the withdrawal retired the second stage instead.
		expect(approved.status).toBe(200);
		expect(withdrawn).toEqual({ success: true, data: { status: "withdrawn" } });
		expect(await reportState(reportId)).toMatchObject({ status: "draft" });
		expect(await closuresOf(reportId)).toEqual([
			expect.objectContaining({ submission_cycle: 1, kind: "withdrawn" }),
		]);

		// A submitted cycle without any pending request is not a race: it stays an integrity error.
		const broken = await completeTrip();
		expect((await submit(broken)).success).toBe(true);
		await admin.query("update approval_request set status = 'approved' where id = $1", [
			await pendingRequestId(broken),
		]);
		expect(await withdraw(broken, 1)).toEqual({
			success: false,
			error: "Failed to withdraw expense report",
		});
		expect((await reportState(broken)).status).toBe("submitted");
		expect(await closuresOf(broken)).toEqual([]);
	});

	it("only lets reviewers authorized for the report return it", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);
		for (const outsider of ["requester", "colleague", "foreigner"] as const) {
			signIn(outsider);
			expect(await returnReport(requestId, "Not mine")).toMatchObject({ success: false });
		}
		expect(await reportState(reportId)).toMatchObject({ status: "submitted", decisions: 0 });
	});

	it("retires the sent cards of a returned or withdrawn cycle through a cycle-keyed intent", async () => {
		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
			 values ('t603-org', 'travel_expense', 'telegram', now())`,
		);
		const intents = async (reportId: string) =>
			(
				await admin.query<{ event: string; legacy_cycle_id: string }>(
					`select event, legacy_cycle_id from approval_delivery_intent
					 where source_id = $1 order by created_at, id`,
					[reportId],
				)
			).rows;

		const returned = await completeTrip();
		expect((await submit(returned)).success).toBe(true);
		const returnedRequest = await pendingRequestId(returned);
		signIn("manager");
		expect((await returnReport(returnedRequest, "Fix it")).success).toBe(true);
		expect(await intents(returned)).toEqual([
			{ event: "submitted", legacy_cycle_id: returnedRequest },
			{ event: "withdrawn", legacy_cycle_id: returnedRequest },
		]);
		// The resubmission is its own cycle with its own key.
		expect((await submit(returned)).success).toBe(true);
		const resubmittedRequest = await pendingRequestId(returned);
		expect((await intents(returned)).at(-1)).toEqual({
			event: "submitted",
			legacy_cycle_id: resubmittedRequest,
		});

		const withdrawn = await completeTrip();
		expect((await submit(withdrawn)).success).toBe(true);
		const withdrawnRequest = await pendingRequestId(withdrawn);
		expect((await withdraw(withdrawn, 1)).success).toBe(true);
		expect(await intents(withdrawn)).toEqual([
			{ event: "submitted", legacy_cycle_id: withdrawnRequest },
			{ event: "withdrawn", legacy_cycle_id: withdrawnRequest },
		]);
	});

	it("still cleans up the receipts of a deleted report", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		signIn("manager");
		expect((await returnReport(await pendingRequestId(reportId), "Fix it")).success).toBe(true);
		const receipts = (await load(reportId)).items.flatMap((item) => item.receipts.map((r) => r.id));
		await admin.query("delete from travel_expense_report where id = $1", [reportId]);
		const { rows } = await admin.query<{ id: string }>(
			"select id from travel_expense_receipt_upload where report_id = $1 and status = 'cleanup_required'",
			[reportId],
		);
		expect(rows.map((row) => row.id).sort()).toEqual(receipts.sort());
	});

	it("queues receipts only frozen submissions named for cleanup when the report is deleted", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		signIn("manager");
		expect((await returnReport(await pendingRequestId(reportId), "Fix it")).success).toBe(true);
		const [, hotel] = (await load(reportId)).items;
		const frozenReceipt = hotel?.receipts[0];
		if (!hotel || !frozenReceipt) throw new Error("receipt missing");
		expect(
			await actions.removeReportReceiptAction({
				reportId,
				itemId: hotel.id,
				receiptId: frozenReceipt.id,
			}),
		).toMatchObject({ success: true });
		// Still named by the frozen first submission: kept while the report exists.
		const queued = () =>
			admin.query<{ id: string; storage_key: string }>(
				"select id, storage_key from travel_expense_receipt_upload where report_id = $1 and status = 'cleanup_required'",
				[reportId],
			);
		expect((await queued()).rows).toEqual([]);
		const liveReceipts = (await load(reportId)).items.flatMap((item) =>
			item.receipts.map((receipt) => receipt.id),
		);

		await admin.query("delete from travel_expense_report where id = $1", [reportId]);
		expect((await queued()).rows.map((row) => row.id).sort()).toEqual(
			[...liveReceipts, frozenReceipt.id].sort(),
		);
	});

	it("lets a reviewer read only the cycles routed to them", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		signIn("manager");
		expect((await returnReport(await pendingRequestId(reportId), "Fix it")).success).toBe(true);
		// The resubmission is routed to another manager.
		await linkManager(ids.lead);
		expect((await submit(reportId)).success).toBe(true);
		const receiptId = (await load(reportId)).items[0]?.receipts[0]?.id ?? "";

		signIn("manager");
		const own = await actions.getTravelExpenseReportSubmission(reportId);
		expect(own.success && own.data).toMatchObject({ access: "reviewer", submissionCycle: 1 });
		expect(await actions.getTravelExpenseReportSubmission(reportId, 2)).toMatchObject({
			success: false,
		});
		expect((await getReceiptResponse(reportId, receiptId, "?cycle=2")).status).toBe(404);
		expect((await getReceiptResponse(reportId, receiptId)).status).toBe(404);
		expect((await getReceiptResponse(reportId, receiptId, "?cycle=1")).status).toBe(200);

		signIn("lead");
		const current = await actions.getTravelExpenseReportSubmission(reportId);
		expect(current.success && current.data).toMatchObject({ submissionCycle: 2 });
		expect(await actions.getTravelExpenseReportSubmission(reportId, 1)).toMatchObject({
			success: false,
		});
	});

	it("purges a deleted reviewer's closed cycles without blocking the deletion", async () => {
		const { deleteEmployeeApprovalLifecycles } = await import("@/lib/approvals/maintenance");
		const { db } = await import("@/db");
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		signIn("manager");
		expect((await returnReport(await pendingRequestId(reportId), "Fix it")).success).toBe(true);
		expect(await closuresOf(reportId)).toHaveLength(1);

		const purged = await db.transaction((transaction) =>
			deleteEmployeeApprovalLifecycles(transaction, {
				organizationId: "t603-org",
				employeeIds: [ids.manager],
			}),
		);
		expect(purged.lifecycles.flatMap((lifecycle) => lifecycle.travelExpenseReportClosures ?? []))
			.toHaveLength(1);
		expect(await closuresOf(reportId)).toEqual([]);
		await admin.query("delete from employee_managers where manager_id = $1", [ids.manager]);
		await admin.query("update audit_log set employee_id = null where employee_id = $1", [
			ids.manager,
		]);
		await admin.query("delete from employee where id = $1", [ids.manager]);
		expect((await reportState(reportId)).status).toBe("returned");
	});

	it("never shows a returned or withdrawn cycle as a rejection and keeps each cycle's own facts", async () => {
		const { prepareTravelExpenseReportReviewEvidence } = await import(
			"@/lib/approvals/presentation/travel-expense-report-review"
		);
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const returnedRequest = await pendingRequestId(reportId);
		const [, hotel] = (await load(reportId)).items;
		if (!hotel) throw new Error("item missing");
		signIn("manager");
		expect(
			(
				await returnReport(returnedRequest, "Hotel needs an itemized invoice", [
					{ itemId: hotel.id, body: "Itemize it" },
				])
			).success,
		).toBe(true);
		await saveItem(reportId, (await load(reportId)).items[1] ?? hotel, {
			category: "accommodation",
			description: "Hotel, two nights (itemized)",
			amount: "250.00",
			paidBy: "company",
		});
		expect((await submit(reportId)).success).toBe(true);
		const rejectedRequest = await pendingRequestId(reportId);
		signIn("manager");
		expect((await decide("reject", rejectedRequest, "Not a business trip")).status).toBe(200);

		const withdrawnReport = await completeTrip();
		expect((await submit(withdrawnReport)).success).toBe(true);
		const withdrawnRequest = await pendingRequestId(withdrawnReport);
		expect((await withdraw(withdrawnReport, 1)).success).toBe(true);

		const run = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
			Effect.runPromise(
				effect.pipe(Effect.provide(DatabaseServiceLive)) as Effect.Effect<A, unknown, never>,
			);
		// Only the real rejection is listed as rejected.
		const rejected = await run(
			TravelExpenseReportHandler.getApprovals({
				approverId: ids.manager,
				organizationId: "t603-org",
				status: "rejected",
				limit: 50,
			}),
		);
		expect(rejected.map((item) => item.id)).toEqual([rejectedRequest]);

		// The returned cycle's detail is a return, with the facts its reviewer saw.
		const returnedDetail = await run(
			TravelExpenseReportHandler.getDetail(reportId, "t603-org", { approvalId: returnedRequest }),
		);
		expect(returnedDetail.approval).toMatchObject({ status: "rejected", closedAs: "returned" });
		expect(returnedDetail.timeline.map((event) => event.type)).toEqual(["created", "returned"]);
		expect(returnedDetail.timeline[1]?.message).toContain("returned for changes");
		expect(returnedDetail.approval.display.summary).toContain("company-paid EUR 240.00");
		const rejectedDetail = await run(
			TravelExpenseReportHandler.getDetail(reportId, "t603-org", { approvalId: rejectedRequest }),
		);
		expect(rejectedDetail.approval.closedAs).toBeUndefined();
		expect(rejectedDetail.timeline.map((event) => event.type)).toEqual(["created", "rejected"]);
		expect(rejectedDetail.approval.display.summary).toContain("company-paid EUR 250.00");
		const withdrawnDetail = await run(
			TravelExpenseReportHandler.getDetail(withdrawnReport, "t603-org", {
				approvalId: withdrawnRequest,
			}),
		);
		expect(withdrawnDetail.approval).toMatchObject({ closedAs: "withdrawn" });
		expect(withdrawnDetail.timeline.map((event) => event.type)).toEqual(["created", "withdrawn"]);

		// The review evidence of each request is its own cycle, with earlier return notes.
		const cycleOne = await prepareTravelExpenseReportReviewEvidence({
			organizationId: "t603-org",
			reportId,
			approvalRequestId: returnedRequest,
		});
		expect(cycleOne).toMatchObject({
			status: "evidenced",
			latestCycle: false,
			revision: { submissionCycle: 1 },
			comparison: { kind: "current" },
		});
		const cycleTwo = await prepareTravelExpenseReportReviewEvidence({
			organizationId: "t603-org",
			reportId,
			approvalRequestId: rejectedRequest,
		});
		expect(cycleTwo).toMatchObject({
			status: "evidenced",
			latestCycle: true,
			revision: { submissionCycle: 2 },
			earlierCycles: [
				{
					submissionCycle: 1,
					kind: "returned",
					note: "Hotel needs an itemized invoice",
					actorName: "manager",
					itemComments: [
						{
							itemId: hotel.id,
							// Numbered as the returned cycle froze it (#688).
							itemLabel: {
								key: "approvals:approvals.evidence.reportItemTitle",
								params: expect.objectContaining({ description: "Hotel, two nights" }),
							},
							body: "Itemize it",
						},
					],
				},
			],
		});

		// The audit log records the return as a return.
		const { rows: audit } = await admin.query<{ action: string }>(
			"select action from audit_log where entity_id = $1 order by timestamp",
			[returnedRequest],
		);
		expect(audit.map((row) => row.action)).toEqual(["return"]);
	});

	it("lets the absent manager's covering deputy approve a legacy report for them (#1016)", async () => {
		// The manager is away around today and names the lead as deputy.
		const { rows: categories } = await admin.query<{ id: string }>(
			`insert into absence_category
			 (organization_id, type, name, requires_approval, requires_work_time, counts_against_vacation,
			  is_active, updated_at)
			 values ('t603-org', 'vacation', 'Away', true, false, false, true, now()) returning id`,
		);
		const { rows: absences } = await admin.query<{ id: string }>(
			`insert into absence_entry
			 (employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id,
			  updated_at)
			 values ($1, $2, current_date - 2, current_date + 2, 'approved', 't603-org', $3, now())
			 returning id`,
			[ids.manager, categories[0]?.id, ids.lead],
		);
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);

		signIn("lead");
		expect((await decide("approve", requestId)).status).toBe(200);

		expect((await reportState(reportId)).requests).toEqual([
			expect.objectContaining({ id: requestId, status: "approved", approver_id: ids.manager }),
		]);
		const { rows } = await admin.query(
			`select deputy_employee_id, acting_for_employee_id, absence_id, authority, entity_type
			 from approval_deputy_decision where organization_id = 't603-org' and entity_id = $1`,
			[reportId],
		);
		expect(rows).toEqual([
			{
				deputy_employee_id: ids.lead,
				acting_for_employee_id: ids.manager,
				absence_id: absences[0]?.id,
				authority: "legacy",
				entity_type: "travel_expense_report",
			},
		]);
		// The requester hears who decided, for whom.
		expect(harness.deciders).toEqual(["lead (deputy for manager)"]);
	});
});