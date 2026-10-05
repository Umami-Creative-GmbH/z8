/**
 * #602: frozen report submissions through the existing approval authority.
 *
 * The real report actions, receipt upload route, Approvals inbox routes and
 * decision owners run against a disposable PostgreSQL database. Only the
 * session, notifications and object storage are replaced.
 */

import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t602-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	notifications: [] as Array<{ action: string; reportId: string; reason?: string }>,
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
		rejectionReason?: string;
	}) => {
		harness.notifications.push({
			action: params.action,
			reportId: params.reportId,
			...(params.rejectionReason ? { reason: params.rejectionReason } : {}),
		});
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t602-public",
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
		return { bucket: "t602-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
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
const { GET: getApprovalDetail } = await import("@/app/api/approvals/inbox/[id]/route");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/approvals/inbox/[id]/reject/route");
const { TravelExpenseReportHandler } = await import(
	"@/lib/approvals/handlers/travel-expense-report.handler"
);
const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e6020000-0000-4000-8000-000000000001",
	manager: "e6020000-0000-4000-8000-000000000002",
	lead: "e6020000-0000-4000-8000-000000000003",
	finance: "e6020000-0000-4000-8000-000000000004",
	colleague: "e6020000-0000-4000-8000-000000000005",
	foreigner: "e6020000-0000-4000-8000-000000000006",
	team: "e6021000-0000-4000-8000-000000000001",
	policy: "e6022000-0000-4000-8000-000000000001",
	firstStage: "e6022000-0000-4000-8000-000000000002",
	secondStage: "e6022000-0000-4000-8000-000000000003",
} as const;
type Person = "requester" | "manager" | "lead" | "finance" | "colleague" | "foreigner";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t602-org', 't602-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't602-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t602-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t602-org','Expenses','t602-org','Europe/Berlin',now()),
		 ('t602-foreign','Foreign','t602-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", ids.requester, "t602-org", "employee"],
		["manager", ids.manager, "t602-org", "manager"],
		["lead", ids.lead, "t602-org", "manager"],
		["finance", ids.finance, "t602-org", "manager"],
		["colleague", ids.colleague, "t602-org", "employee"],
		["foreigner", ids.foreigner, "t602-foreign", "admin"],
	];
	for (const [name, employeeId, organizationId, role] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t602-${name}`, name, `t602-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'member','approved',now())",
			[`t602-member-${name}`, organizationId, `t602-${name}`],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[employeeId, `t602-${name}`, organizationId, role],
		);
	}
	await linkManager(ids.manager);
}

async function linkManager(managerId: string | null) {
	await admin.query("delete from employee_managers where employee_id = $1", [ids.requester]);
	if (managerId) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't602-manager', now(), now())`,
			[ids.requester, managerId],
		);
	}
}

function signIn(name: Person) {
	harness.userId = `t602-${name}`;
	harness.organizationId = name === "foreigner" ? "t602-foreign" : "t602-org";
}

async function load(reportId: string) {
	signIn("requester");
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function upload(reportId: string, itemId: string, bytes: Buffer = pdfBytes) {
	signIn("requester");
	const tusFileKey = createOwnedTusFileKey("t602-requester");
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

async function holdReportLock(reportId: string): Promise<PoolClient> {
	const holder = await admin.connect();
	await holder.query("begin");
	await holder.query("select id from travel_expense_report where id = $1 for update", [reportId]);
	return holder;
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

describe("report submission through approval authority (#602)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.notifications = [];
	});
	afterAll(cleanup);

	it("freezes the complete saved report with its exact receipts and routes it to the direct manager", async () => {
		const reportId = await completeTrip();
		const report = await load(reportId);

		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });

		const state = await reportState(reportId);
		expect(state).toMatchObject({ status: "submitted", submission_count: 1, revisions: 1 });
		expect(state.requests).toEqual([
			expect.objectContaining({ status: "pending", approver_id: ids.manager }),
		]);
		const revision = await revisionOf(reportId);
		expect(revision).toMatchObject({
			authority: "legacy",
			workflow_type: "travel_expense",
			legacy_approval_request_id: state.requests[0]?.id,
			request_cycle_key: `travel_expense_report:${reportId}:submission:1`,
			subject_employee_id: ids.requester,
			submitter_employee_id: ids.requester,
		});
		expect(revision.material_fingerprint).toMatch(/^travel_expense_report:v1:[0-9a-f]{64}$/);
		expect(revision.facts.trip).toEqual({
			purpose: "Customer workshop",
			startDate: "2026-09-14",
			endDate: "2026-09-16",
			timeZone: "Europe/Berlin",
			destinations: [{ place: "Hamburg", countryCode: "DE" }],
		});
		// The server calculated the totals; company-paid costs are never owed.
		expect(revision.facts.totals).toEqual({
			currency: "EUR",
			reimbursable: "89.90",
			companyPaid: "240.00",
		});
		const frozenReceipts = revision.facts.items.flatMap(
			(item: { receipts: Array<{ receiptId: string; checksumSha256: string }> }) => item.receipts,
		);
		expect(
			frozenReceipts.map((receipt: { receiptId: string }) => receipt.receiptId).sort(),
		).toEqual(report.items.flatMap((item) => item.receipts.map((receipt) => receipt.id)).sort());
		expect(frozenReceipts[0]?.checksumSha256).toBe(
			createHash("sha256").update(pdfBytes).digest("hex"),
		);
		expect(harness.notifications).toEqual([]);
	});

	it("never changes a submitted revision: draft edits, item changes and late uploads are refused", async () => {
		const reportId = await completeTrip();
		const report = await load(reportId);
		expect((await submit(reportId)).success).toBe(true);
		const before = await revisionOf(reportId);
		const [first] = report.items;
		if (!first) throw new Error("item missing");

		signIn("requester");
		const edit = await actions.saveReceiptItemDraftAction({
			reportId,
			itemId: first.id,
			expectedVersion: first.version,
			values: {
				expenseDate: "2026-09-14",
				category: "transport",
				description: "Changed",
				amount: "1.00",
				currency: "EUR",
				paidBy: "employee",
				accountingReference: null,
			},
		});
		expect(edit).toEqual({ success: false, error: "This expense can no longer be edited" });
		expect(await actions.addTripReportItemAction({ reportId })).toEqual({
			success: false,
			error: "This expense can no longer be edited",
		});
		const receiptId = first.receipts[0]?.id ?? "";
		expect(
			await actions.removeReportReceiptAction({ reportId, itemId: first.id, receiptId }),
		).toEqual({ success: false, error: "This expense can no longer be edited" });
		const receiptRows = async () =>
			(
				await admin.query("select id from travel_expense_report_receipt where report_id = $1", [
					reportId,
				])
			).rows.length;
		const attached = await receiptRows();
		const late = await upload(reportId, first.id);
		expect(late.status).not.toBe(200);
		expect(await receiptRows()).toBe(attached);
		// Nothing is left staged as if it could still attach.
		const { rows: pending } = await admin.query(
			"select id from travel_expense_receipt_upload where report_id = $1 and status = 'pending'",
			[reportId],
		);
		expect(pending).toEqual([]);
		expect((await revisionOf(reportId)).material_fingerprint).toBe(before.material_fingerprint);
		// A second submission of the same report is refused, never a second cycle.
		expect(await submit(reportId)).toEqual({
			success: false,
			error: "This expense report was already submitted",
		});
	});

	it("keeps incomplete or changed reports in draft with actionable results", async () => {
		const reportId = await completeTrip();
		const report = await load(reportId);
		const versions = await reviewed(reportId);
		const [first] = report.items;
		if (!first) throw new Error("item missing");

		// Saved after the review step: the employee must review again.
		await saveItem(reportId, first, { description: "Train to Hamburg and back" });
		expect(await submit(reportId, versions)).toEqual({
			success: true,
			data: { status: "changed_since_review" },
		});

		signIn("requester");
		const added = await actions.addTripReportItemAction({ reportId });
		if (!added.success) throw new Error("add failed");
		expect(await submit(reportId)).toEqual({
			success: true,
			data: {
				status: "incomplete",
				missing: {
					trip: [],
					items: [
						{
							id: added.data.item.id,
							missing: [
								"expense_date",
								"category",
								"description",
								"amount",
								"payment_ownership",
								"receipt",
							],
						},
					],
				},
			},
		});
		expect(await reportState(reportId)).toMatchObject({
			status: "draft",
			submission_count: 0,
			requests: [],
			revisions: 0,
		});
	});

	it("routes through team manager and expense approver, never to the requester, and explains missing setup", async () => {
		// The requester is a manager who is their own direct manager.
		await admin.query("update employee set role = 'manager' where id = $1", [ids.requester]);
		await linkManager(ids.requester);
		await admin.query(
			"insert into team (id, organization_id, name, primary_manager_id, updated_at) values ($1, 't602-org', 'Field', $2, now())",
			[ids.team, ids.lead],
		);
		await admin.query("update employee set team_id = $1 where id = $2", [ids.team, ids.requester]);
		const toLead = await completeTrip();
		expect((await submit(toLead)).success).toBe(true);
		expect((await reportState(toLead)).requests[0]?.approver_id).toBe(ids.lead);

		await admin.query("update team set primary_manager_id = $1 where id = $2", [
			ids.requester,
			ids.team,
		]);
		const unrouted = await completeTrip();
		expect(await submit(unrouted)).toEqual({
			success: true,
			data: { status: "no_reviewer", reason: "no_eligible_reviewer" },
		});
		expect(await reportState(unrouted)).toMatchObject({ status: "draft", requests: [] });

		await admin.query(
			"insert into travel_expense_settings (organization_id, expense_approver_employee_id) values ('t602-org', $1)",
			[ids.finance],
		);
		expect((await submit(unrouted)).success).toBe(true);
		expect((await reportState(unrouted)).requests[0]?.approver_id).toBe(ids.finance);

		await admin.query(
			"update travel_expense_settings set expense_approver_employee_id = $1 where organization_id = 't602-org'",
			[ids.requester],
		);
		const selfOnly = await completeTrip();
		expect(await submit(selfOnly)).toEqual({
			success: true,
			data: { status: "no_reviewer", reason: "no_eligible_reviewer" },
		});
	});

	it("requires review of a company-paid-only report and never self-approves through a policy", async () => {
		const zero = await completeTrip({ companyPaidOnly: true });
		expect(await submit(zero)).toEqual({ success: true, data: { status: "submitted" } });
		expect(await reportState(zero)).toMatchObject({
			status: "submitted",
			requests: [expect.objectContaining({ status: "pending", approver_id: ids.manager })],
		});
		expect((await revisionOf(zero)).facts.totals.reimbursable).toBe("0.00");

		// A policy stage that resolves to the requester would approve their own report.
		await admin.query(
			`insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, 't602-org', 'T602 self', true, 1, 't602-manager', now())`,
			[ids.policy],
		);
		await admin.query(
			`insert into approval_policy_stage (id, organization_id, policy_id, step_order, label, approver_type,
			   approver_employee_id, fallback_behavior, updated_at)
			 values ($1, 't602-org', $2, 1, 'Self', 'specific_employee', $3, 'fail', now())`,
			[ids.firstStage, ids.policy, ids.requester],
		);
		const selfRouted = await completeTrip();
		expect(await submit(selfRouted)).toEqual({
			success: true,
			data: { status: "self_approval_route" },
		});
		expect(await reportState(selfRouted)).toMatchObject({ status: "draft", requests: [] });
	});

	it("serializes receipt finalization and submission on the report row in both orders", async () => {
		const reportId = await completeTrip();
		const report = await load(reportId);
		const [first] = report.items;
		if (!first) throw new Error("item missing");

		// Upload queued behind a held lock, then submission: the upload attaches first and
		// the report changed after review, so nothing is frozen without it.
		const holder = await holdReportLock(reportId);
		const versions = await reviewed(reportId);
		const lateUpload = upload(reportId, first.id, Buffer.from("%PDF-1.4\n% second\n%%EOF"));
		await waitForLockWaiters(1);
		const submission = submit(reportId, versions);
		await waitForLockWaiters(2);
		await holder.query("commit");
		holder.release();
		const [uploaded, submitted] = await Promise.all([lateUpload, submission]);

		const state = await reportState(reportId);
		const { rows: receipts } = await admin.query(
			"select id from travel_expense_report_receipt where report_id = $1",
			[reportId],
		);
		if (state.status === "submitted") {
			// Submission won the lock: the late upload was refused and is cleaned up.
			expect(uploaded.status).not.toBe(200);
			const frozen = (await revisionOf(reportId)).facts.items.flatMap(
				(item: { receipts: Array<{ receiptId: string }> }) => item.receipts,
			);
			expect(frozen).toHaveLength(receipts.length);
		} else {
			// The upload won: the receipt is attached and the submission saw a changed report.
			expect(uploaded.status).toBe(200);
			expect(submitted).toEqual({ success: true, data: { status: "changed_since_review" } });
			expect(state.revisions).toBe(0);
		}
	});

	it("submits a report once under concurrent double submission", async () => {
		const reportId = await completeTrip();
		const versions = await reviewed(reportId);
		const results = await Promise.all([submit(reportId, versions), submit(reportId, versions)]);
		expect(results).toContainEqual({ success: true, data: { status: "submitted" } });
		expect(results).toContainEqual({
			success: false,
			error: "This expense report was already submitted",
		});
		expect(await reportState(reportId)).toMatchObject({
			submission_count: 1,
			requests: [expect.objectContaining({ status: "pending" })],
			revisions: 1,
		});
	});

	it("shows the reviewer the frozen report in the inbox and approves the whole report exactly once", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);

		signIn("manager");
		const detailResponse = await getApprovalDetail({} as NextRequest, {
			params: Promise.resolve({ id: requestId }),
		});
		expect(detailResponse.status).toBe(200);
		const detail = await detailResponse.json();
		expect(detail.item).toMatchObject({ type: "travel_expense_report", entityId: reportId });
		expect(detail.actions).toMatchObject({ canApprove: true, canReject: true });
		const text = JSON.stringify(detail.sections);
		expect(text).toContain("Customer workshop");
		expect(text).toContain("1. Train to Hamburg");
		expect(text).toContain("2. Hotel, two nights");
		expect(text).toContain("89.90 EUR");

		// The reviewer can open the frozen receipts, and only those.
		const submittedView = await actions.getTravelExpenseReportSubmission(reportId);
		if (!submittedView.success) throw new Error(submittedView.error);
		expect(submittedView.data.access).toBe("reviewer");
		const receiptId = submittedView.data.facts.items[0]?.receipts[0]?.receiptId ?? "";
		const receipt = await getReceipt(
			new Request(
				`http://localhost/api/travel-expenses/reports/${reportId}/receipts/${receiptId}`,
			) as unknown as NextRequest,
			{ params: Promise.resolve({ reportId, receiptId }) },
		);
		expect(receipt.status).toBe(200);

		expect((await decide("approve", requestId)).status).toBe(200);
		expect(await reportState(reportId)).toMatchObject({
			status: "approved",
			requests: [expect.objectContaining({ status: "approved" })],
			decisions: 1,
		});
		expect(harness.notifications).toEqual([{ action: "approve", reportId }]);

		// A second decision is stale; an exact authenticated retry replays without effects.
		expect((await decide("reject", requestId, "Too late")).status).toBe(409);
		const replay = await Effect.runPromise(
			TravelExpenseReportHandler.approve(reportId, ids.manager, {
				approvalRequestId: requestId,
			}).pipe(Effect.provide(DatabaseServiceLive), Effect.either),
		);
		expect(replay._tag).toBe("Right");
		expect(await reportState(reportId)).toMatchObject({ status: "approved", decisions: 1 });
		expect(harness.notifications).toHaveLength(1);

		signIn("requester");
		const ownView = await actions.getTravelExpenseReportSubmission(reportId);
		expect(ownView.success && ownView.data.decision).toMatchObject({
			outcome: "approved",
			deciderName: "manager",
		});
	});

	it("rejects the whole report only with a recorded reason", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);

		signIn("manager");
		expect((await decide("reject", requestId, "  ")).status).toBe(400);
		expect((await reportState(reportId)).status).toBe("submitted");
		expect((await decide("reject", requestId, "Hotel exceeds the policy")).status).toBe(200);

		const state = await reportState(reportId);
		expect(state).toMatchObject({
			status: "rejected",
			requests: [
				expect.objectContaining({
					status: "rejected",
					rejection_reason: "Hotel exceeds the policy",
				}),
			],
			decisions: 1,
		});
		expect(harness.notifications).toEqual([
			{ action: "reject", reportId, reason: "Hotel exceeds the policy" },
		]);
		signIn("requester");
		const ownView = await actions.getTravelExpenseReportSubmission(reportId);
		expect(ownView.success && ownView.data.decision).toMatchObject({
			outcome: "rejected",
			reason: "Hotel exceeds the policy",
		});
	});

	it("holds a decision when live rows no longer match the frozen revision", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);
		// Out-of-band mutation of a submitted item (never possible through the app).
		await admin.query(
			"update travel_expense_report_item set original_amount = '1.00' where report_id = $1 and position = 0",
			[reportId],
		);

		signIn("manager");
		const detail = await (
			await getApprovalDetail({} as NextRequest, { params: Promise.resolve({ id: requestId }) })
		).json();
		expect(detail.actions).toMatchObject({ canApprove: false, canReject: false });
		expect((await decide("approve", requestId)).status).toBe(409);
		expect(await reportState(reportId)).toMatchObject({ status: "submitted", decisions: 0 });
	});

	it("advances a policy chain stage by stage and decides the report only at the end", async () => {
		await admin.query(
			`insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, 't602-org', 'T602 two stages', true, 1, 't602-manager', now())`,
			[ids.policy],
		);
		await admin.query(
			`insert into approval_policy_stage (id, organization_id, policy_id, step_order, label, approver_type,
			   approver_employee_id, fallback_behavior, updated_at) values
			 ($1, 't602-org', $3, 1, 'Manager', 'direct_manager', null, 'fail', now()),
			 ($2, 't602-org', $3, 2, 'Finance', 'specific_employee', $4, 'fail', now())`,
			[ids.firstStage, ids.secondStage, ids.policy, ids.finance],
		);
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);

		signIn("manager");
		expect((await decide("approve", await pendingRequestId(reportId))).status).toBe(200);
		const intermediate = await reportState(reportId);
		expect(intermediate.status).toBe("submitted");
		expect(intermediate.requests.at(-1)).toMatchObject({
			status: "pending",
			approver_id: ids.finance,
		});
		expect(harness.notifications).toEqual([]);

		signIn("finance");
		expect((await decide("approve", await pendingRequestId(reportId))).status).toBe(200);
		expect(await reportState(reportId)).toMatchObject({ status: "approved", decisions: 2 });
	});

	it("refuses self-decisions and keeps reports and receipts invisible to others", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);
		const receiptId = (await load(reportId)).items[0]?.receipts[0]?.id ?? "missing-receipt-id";

		// Even an organization admin never decides their own report.
		await admin.query("update employee set role = 'admin' where id = $1", [ids.requester]);
		const self = await Effect.runPromise(
			TravelExpenseReportHandler.approve(reportId, ids.requester, {
				approvalRequestId: requestId,
				allowOrganizationWideApprover: true,
			}).pipe(Effect.provide(DatabaseServiceLive), Effect.either),
		);
		expect(self._tag).toBe("Left");
		expect((await reportState(reportId)).status).toBe("submitted");

		for (const outsider of ["colleague", "foreigner"] as const) {
			signIn(outsider);
			expect(await actions.getTravelExpenseReportSubmission(reportId)).toEqual({
				success: false,
				error: "Expense report not found",
			});
			const receipt = await getReceipt(
				new Request("http://localhost/receipt") as unknown as NextRequest,
				{ params: Promise.resolve({ reportId, receiptId }) },
			);
			expect(receipt.status).toBe(404);
		}
		signIn("foreigner");
		const foreignDetail = await getApprovalDetail({} as NextRequest, {
			params: Promise.resolve({ id: requestId }),
		});
		expect(foreignDetail.status).not.toBe(200);
	});

	it.each([
		["shadow", "submitted"],
		["ready", "submitted"],
		["canonical", "authority_unsupported"],
		["complete", "authority_unsupported"],
	] as const)(
		"submits under %s lifecycle mode only while legacy authority decides",
		async (mode, expected) => {
			const reportId = await completeTrip();
			await admin.query(
				`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ('t602-org', 'travel_expense', $1, $2, now(), now())`,
				[mode, mode === "canonical" || mode === "complete" ? "canonical" : "legacy"],
			);
			expect(await submit(reportId)).toEqual({ success: true, data: { status: expected } });
		},
	);

	it("refuses a decision once the organization moved to canonical authority", async () => {
		const reportId = await completeTrip();
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);
		await admin.query(
			`update approval_workflow_rollout set lifecycle_mode = 'canonical', side_effect_mode = 'canonical'
			 where organization_id = 't602-org' and workflow_type = 'travel_expense'`,
		);
		signIn("manager");
		expect((await decide("approve", requestId)).status).toBe(409);
		expect((await reportState(reportId)).status).toBe("submitted");
	});
});
