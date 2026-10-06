/**
 * #604: explained missing-receipt exceptions, permitted per organization and
 * explicitly accepted by the reviewer.
 *
 * The real settings, report and exception actions, submission owner, Approvals
 * inbox routes and decision owner run against a disposable PostgreSQL
 * database. Only the session, notifications and object storage are replaced.
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t604-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
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
	onTravelExpenseReportDecided: async () => {},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t604-public",
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
		return { bucket: "t604-private", versionId: `v-${key.length}` };
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
const exceptionActions = await import(
	"@/app/[locale]/(app)/travel-expenses/receipt-exception-actions"
);
const settingsActions = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/receipt-exception-actions"
);
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { GET: getApprovalDetail } = await import("@/app/api/approvals/inbox/[id]/route");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/approvals/inbox/[id]/reject/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e6040000-0000-4000-8000-000000000001",
	manager: "e6040000-0000-4000-8000-000000000002",
	admin: "e6040000-0000-4000-8000-000000000003",
	foreigner: "e6040000-0000-4000-8000-000000000004",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t604-org', 't604-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't604-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t604-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t604-org','Expenses','t604-org','Europe/Berlin',now()),
		 ('t604-foreign','Foreign','t604-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t604-org", "employee", "member"],
		["manager", "t604-org", "manager", "member"],
		["admin", "t604-org", "admin", "admin"],
		["foreigner", "t604-foreign", "admin", "admin"],
	];
	for (const [name, organizationId, role, memberRole] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t604-${name}`, name, `t604-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t604-member-${name}`, organizationId, `t604-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t604-${name}`, organizationId, role],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't604-manager', now(), now())`,
		[ids.requester, ids.manager],
	);
}

function signIn(name: Person) {
	harness.userId = `t604-${name}`;
	harness.organizationId = name === "foreigner" ? "t604-foreign" : "t604-org";
}

async function setPolicy(allowed: boolean) {
	await admin.query(
		`insert into travel_expense_settings (organization_id, missing_receipt_exceptions_allowed)
		 values ('t604-org', $1)
		 on conflict (organization_id) do update set missing_receipt_exceptions_allowed = $1`,
		[allowed],
	);
}

async function load(reportId: string) {
	signIn("requester");
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

/** A complete standalone dinner expense without a receipt. */
async function dinnerWithoutReceipt() {
	signIn("requester");
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	const [item] = (await load(reportId)).items;
	if (!item) throw new Error("item missing");
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: "2026-09-14",
			category: "meals",
			description: "Customer dinner",
			amount: "64.20",
			currency: "EUR",
			paidBy: "employee",
			accountingReference: null,
		},
	});
	if (!saved.success || saved.data.status !== "saved") throw new Error("save failed");
	return { reportId, itemId: item.id };
}

async function requestException(
	reportId: string,
	itemId: string,
	reason: string | null,
	options: { requested?: boolean; expectedVersion?: number } = {},
) {
	signIn("requester");
	const report = await load(reportId);
	const item = report.items.find((candidate) => candidate.id === itemId);
	return exceptionActions.saveReceiptExceptionAction({
		reportId,
		itemId,
		expectedVersion: options.expectedVersion ?? item?.receiptException.version ?? 0,
		requested: options.requested ?? true,
		reason,
	});
}

async function reviewed(reportId: string) {
	const report = await load(reportId);
	return {
		detailsVersion: null,
		items: report.items.map((item) => ({
			id: item.id,
			version: item.version,
			receiptIds: item.receipts.map((receipt) => receipt.id),
			receiptExceptionVersion: item.receiptException.version,
		})),
	};
}

async function submit(reportId: string, versions?: Awaited<ReturnType<typeof reviewed>>) {
	const reviewedVersions = versions ?? (await reviewed(reportId));
	signIn("requester");
	return actions.submitTravelExpenseReportAction({ reportId, reviewed: reviewedVersions });
}

async function pendingRequestId(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		`select id from approval_request where entity_type = 'travel_expense_report'
		 and entity_id = $1 and status = 'pending'`,
		[reportId],
	);
	if (!rows[0]) throw new Error("no pending request");
	return rows[0].id;
}

async function revisionFacts(reportId: string) {
	const { rows } = await admin.query(
		`select facts, material_fingerprint from approval_submitted_revision
		 where source_type = 'travel_expense_report' and source_id = $1`,
		[reportId],
	);
	expect(rows).toHaveLength(1);
	return rows[0];
}

async function decisionResults(reportId: string) {
	const { rows } = await admin.query<{ result: Record<string, unknown> }>(
		`select d.result from approval_decision_evidence d
		 join approval_submitted_revision s on s.id = d.submitted_revision_id
		 where s.source_id = $1`,
		[reportId],
	);
	return rows.map((row) => row.result);
}

async function reportStatus(reportId: string) {
	const { rows } = await admin.query<{ status: string }>(
		"select status from travel_expense_report where id = $1",
		[reportId],
	);
	return rows[0]?.status;
}

function decide(kind: "approve" | "reject", requestId: string, body: Record<string, unknown> = {}) {
	signIn("manager");
	const route = kind === "approve" ? approveRoute : rejectRoute;
	return route(
		new Request(`http://localhost/api/approvals/inbox/${requestId}/${kind}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: requestId }) },
	);
}

describe("missing-receipt exceptions (#604)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
	});
	afterAll(cleanup);

	it("lets only expense administrators allow exceptions, and keeps receipts required by default", async () => {
		signIn("requester");
		expect(await settingsActions.getReceiptExceptionSettings()).toMatchObject({ success: false });
		expect(
			await settingsActions.saveReceiptExceptionSettings({ missingReceiptExceptionsAllowed: true }),
		).toMatchObject({ success: false });

		signIn("admin");
		expect(await settingsActions.getReceiptExceptionSettings()).toEqual({
			success: true,
			data: { missingReceiptExceptionsAllowed: false },
		});
		const { reportId, itemId } = await dinnerWithoutReceipt();
		// Disabled: an exception cannot even be requested, and the receipt stays required.
		expect(await requestException(reportId, itemId, "The printer was broken")).toEqual({
			success: true,
			data: { status: "not_allowed" },
		});
		expect(await submit(reportId)).toEqual({
			success: true,
			data: {
				status: "incomplete",
				missing: { trip: [], items: [{ id: itemId, missing: ["receipt"] }] },
			},
		});

		signIn("admin");
		expect(
			await settingsActions.saveReceiptExceptionSettings({ missingReceiptExceptionsAllowed: true }),
		).toEqual({ success: true, data: { missingReceiptExceptionsAllowed: true } });
		// Only this organization: the foreign admin sees its own default.
		signIn("foreigner");
		expect(await settingsActions.getReceiptExceptionSettings()).toEqual({
			success: true,
			data: { missingReceiptExceptionsAllowed: false },
		});
		expect((await load(reportId)).receiptExceptionsAllowed).toBe(true);
	});

	it("requires an explanation and never stores the exception as a receipt", async () => {
		await setPolicy(true);
		const { reportId, itemId } = await dinnerWithoutReceipt();

		expect(await requestException(reportId, itemId, "   ")).toEqual({
			success: true,
			data: { status: "invalid", error: "reason_required" },
		});
		expect((await load(reportId)).items[0]?.receiptException).toEqual({
			reason: null,
			version: 0,
		});

		expect(await requestException(reportId, itemId, " The printer was broken ")).toEqual({
			success: true,
			data: {
				status: "saved",
				receiptException: { reason: "The printer was broken", version: 1 },
			},
		});
		// A stale version is refused instead of overwriting the newer explanation.
		expect(await requestException(reportId, itemId, "Other", { expectedVersion: 0 })).toEqual({
			success: true,
			data: {
				status: "conflict",
				receiptException: { reason: "The printer was broken", version: 1 },
			},
		});
		const { rows: receipts } = await admin.query(
			"select id from travel_expense_report_receipt where report_id = $1",
			[reportId],
		);
		expect(receipts).toEqual([]);

		// Another employee cannot touch it.
		signIn("manager");
		expect(
			await exceptionActions.saveReceiptExceptionAction({
				reportId,
				itemId,
				expectedVersion: 1,
				requested: true,
				reason: "Mine now",
			}),
		).toEqual({ success: false, error: "Expense not found" });
	});

	it("freezes the explained exception, shows it to the reviewer and needs explicit acceptance to approve", async () => {
		await setPolicy(true);
		const { reportId, itemId } = await dinnerWithoutReceipt();
		await requestException(reportId, itemId, "The printer was broken");

		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		const revision = await revisionFacts(reportId);
		expect(revision.material_fingerprint).toMatch(/^travel_expense_report:v3:/);
		expect(revision.facts.items).toEqual([
			expect.objectContaining({
				itemId,
				receipts: [],
				receiptException: { reason: "The printer was broken" },
			}),
		]);
		expect(revision.facts.totals).toMatchObject({ reimbursable: "64.20" });
		const requestId = await pendingRequestId(reportId);

		signIn("manager");
		const detail = await (
			await getApprovalDetail({} as NextRequest, { params: Promise.resolve({ id: requestId }) })
		).json();
		expect(detail.actions).toMatchObject({ canApprove: true });
		expect(detail.sections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "receipt_exception_acceptance",
					items: [{ itemId, label: "1. Customer dinner", reason: "The printer was broken" }],
				}),
			]),
		);

		// Without acceptance, and with an expense that has no exception, nothing is decided.
		const unaccepted = await decide("approve", requestId);
		expect(unaccepted.status).toBe(400);
		expect(await unaccepted.json()).toEqual({
			error: "Accept every missing-receipt exception of this report before approving it",
		});
		const foreign = await decide("approve", requestId, {
			acceptedReceiptExceptionItemIds: [itemId, "e6049999-0000-4000-8000-000000000001"],
		});
		expect(foreign.status).toBe(400);
		expect(
			(await decide("approve", requestId, { acceptedReceiptExceptionItemIds: ["x"] })).status,
		).toBe(400);
		expect(await reportStatus(reportId)).toBe("submitted");
		expect(await decisionResults(reportId)).toEqual([]);

		const accepted = await decide("approve", requestId, {
			acceptedReceiptExceptionItemIds: [itemId],
		});
		expect(accepted.status).toBe(200);
		expect(await reportStatus(reportId)).toBe("approved");
		expect(await decisionResults(reportId)).toEqual([
			expect.objectContaining({
				reportStatus: "approved",
				acceptedReceiptExceptionItemIds: [itemId],
			}),
		]);

		// The employee's frozen view shows the exception, not a receipt.
		signIn("requester");
		const submitted = await actions.getTravelExpenseReportSubmission(reportId);
		if (!submitted.success) throw new Error(submitted.error);
		expect(submitted.data.facts.items[0]).toMatchObject({
			receipts: [],
			receiptException: { reason: "The printer was broken" },
		});
	});

	it("rejects a report with an exception without accepting it", async () => {
		await setPolicy(true);
		const { reportId, itemId } = await dinnerWithoutReceipt();
		await requestException(reportId, itemId, "Lost on the train");
		expect((await submit(reportId)).success).toBe(true);
		const requestId = await pendingRequestId(reportId);

		expect((await decide("reject", requestId, { reason: "Please find the receipt" })).status).toBe(
			200,
		);
		expect(await reportStatus(reportId)).toBe("rejected");
		expect(await decisionResults(reportId)).toEqual([
			expect.not.objectContaining({ acceptedReceiptExceptionItemIds: expect.anything() }),
		]);
	});

	it("refuses a draft's exception once the organization disables exceptions, until the receipt is attached", async () => {
		await setPolicy(true);
		const { reportId, itemId } = await dinnerWithoutReceipt();
		await requestException(reportId, itemId, "Lost on the train");
		await setPolicy(false);

		expect(await submit(reportId)).toEqual({
			success: true,
			data: {
				status: "incomplete",
				missing: { trip: [], items: [{ id: itemId, missing: ["receipt_exception_not_allowed"] }] },
			},
		});
		// Withdrawing stays possible while exceptions are disabled.
		expect(await requestException(reportId, itemId, null, { requested: false })).toMatchObject({
			success: true,
			data: { status: "saved", receiptException: { reason: null } },
		});

		signIn("requester");
		const tusFileKey = createOwnedTusFileKey("t604-requester");
		harness.tus.set(tusFileKey, pdfBytes);
		const uploaded = await processReceipt(
			new Request("http://localhost/api/upload/travel-expense/report-receipt", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tusFileKey, reportId, itemId, fileName: "receipt.pdf" }),
			}) as unknown as NextRequest,
		);
		expect(uploaded.status).toBe(200);
		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		const revision = await revisionFacts(reportId);
		expect(Object.hasOwn(revision.facts.items[0], "receiptException")).toBe(false);
	});

	it("refuses to submit an exception that changed after the employee reviewed the report", async () => {
		await setPolicy(true);
		const { reportId, itemId } = await dinnerWithoutReceipt();
		await requestException(reportId, itemId, "Lost on the train");
		const versions = await reviewed(reportId);
		await requestException(reportId, itemId, "Actually, the restaurant kept it");

		expect(await submit(reportId, versions)).toEqual({
			success: true,
			data: { status: "changed_since_review" },
		});
	});
});
