/**
 * #747: expense officer grants and scoped finance access.
 *
 * Reports are submitted and approved through the real report actions and
 * Approvals inbox route against a disposable PostgreSQL database, so each
 * approved report records its employee's teams (#746). Grants are managed
 * through the Access tab's server actions. The session, notifications, the job
 * queue and object storage are replaced; the export worker is simulated.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	jobs: [] as Array<{ organizationId: string; batchId: string; attempt: number }>,
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
								activeOrganizationId: "t747-org",
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
vi.mock("@/lib/travel-expenses/settlement-notifications", () => ({
	notifySettlementRecorded: async () => {},
}));
vi.mock("@/lib/queue", () => ({
	async addJob(_name: string, data: { organizationId: string; batchId: string; attempt: number }) {
		harness.jobs.push(data);
		return { id: randomUUID() };
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t747-public",
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
		return { bucket: "t747-private", versionId: `v-${key.length}` };
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
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const { DEFAULT_FINANCE_QUEUE_VIEW } = await import("@/lib/travel-expenses/finance-queue-params");
const exportActions = await import("@/app/[locale]/(app)/travel-expenses/finance-export-actions");
const officers = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/expense-officer-actions"
);
const { loadAuthorizedTravelExpenseReport } = await import("@/lib/travel-expenses/report-read");
const { processTravelExpenseExportBatch } = await import("@/lib/travel-expenses/export-processor");
const { db } = await import("@/db");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { GET: downloadExport } = await import("@/app/api/travel-expenses/exports/[batchId]/route");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	berliner: "e7470000-0000-4000-8000-000000000001",
	muncher: "e7470000-0000-4000-8000-000000000002",
	manager: "e7470000-0000-4000-8000-000000000003",
	owner: "e7470000-0000-4000-8000-000000000004",
	exporter: "e7470000-0000-4000-8000-000000000005",
	reimburser: "e7470000-0000-4000-8000-000000000006",
	auditor: "e7470000-0000-4000-8000-000000000007",
	leaver: "e7470000-0000-4000-8000-000000000008",
	berlin: "e7471000-0000-4000-8000-000000000001",
	munich: "e7471000-0000-4000-8000-000000000002",
} as const;
type Person =
	| "berliner"
	| "muncher"
	| "manager"
	| "owner"
	| "exporter"
	| "reimburser"
	| "auditor"
	| "leaver";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id = 't747-org'");
	await admin.query("delete from travel_expense_receipt_upload where organization_id = 't747-org'");
	await admin.query('delete from "user" where id like $1', ["t747-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ('t747-org','Expenses','t747-org','Europe/Berlin',now())`,
	);
	for (const [team, name] of [
		[ids.berlin, "Berlin"],
		[ids.munich, "Munich"],
	]) {
		await admin.query(
			"insert into team (id, organization_id, name, updated_at) values ($1, 't747-org', $2, now())",
			[team, name],
		);
	}
	const people: Array<[Person, string, string, string | null]> = [
		["berliner", "member", "employee", ids.berlin],
		["muncher", "member", "employee", ids.munich],
		["leaver", "member", "employee", ids.berlin],
		["manager", "member", "manager", null],
		["owner", "owner", "admin", null],
		["exporter", "member", "employee", null],
		["reimburser", "member", "employee", null],
		["auditor", "member", "employee", null],
	];
	for (const [name, memberRole, role, teamId] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t747-${name}`, name, `t747-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,'t747-org',$2,$3,'approved',now())",
			[`t747-member-${name}`, `t747-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,team_id,updated_at) values ($1,$2,'t747-org',$3,$4,now())",
			[ids[name], `t747-${name}`, role, teamId],
		);
	}
	for (const requester of [ids.berliner, ids.muncher, ids.leaver]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't747-manager', now(), now())`,
			[requester, ids.manager],
		);
	}
}

function signIn(name: Person) {
	harness.userId = `t747-${name}`;
}

/** A submitted and approved standalone EUR 12.50 receipt of the person. */
async function approvedReceipt(person: Person) {
	signIn(person);
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	const item = loaded.data.items[0];
	if (!item) throw new Error("no item");
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: "2026-09-02",
			category: "transport",
			description: `Taxi of ${person}`,
			amount: "12.50",
			currency: "EUR",
			paidBy: "employee",
			accountingReference: null,
		},
	});
	if (!saved.success) throw new Error("save failed");
	const tusFileKey = createOwnedTusFileKey(`t747-${person}`);
	harness.tus.set(tusFileKey, pdfBytes);
	const uploaded = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId: item.id, fileName: "taxi.pdf" }),
		}) as unknown as NextRequest,
	);
	expect(uploaded.status).toBe(200);
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	const submitted = await actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: {
			detailsVersion: report.data.trip?.version ?? null,
			items: report.data.items.map((entry) => ({
				id: entry.id,
				version: entry.version,
				receiptIds: entry.receipts.map((receipt) => receipt.id),
			})),
		},
	});
	expect(submitted).toEqual({ success: true, data: { status: "submitted" } });
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
		[reportId],
	);
	const requestId = rows[0]?.id;
	if (!requestId) throw new Error("no pending request");
	signIn("manager");
	const response = await approveRoute(
		new Request(`http://localhost/api/approvals/inbox/${requestId}/approve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: requestId }) },
	);
	expect(response.status).toBe(200);
	const revision = await admin.query<{ id: string }>(
		`select r.id from approval_submitted_revision r join travel_expense_report t on t.id = r.source_id
		 where r.source_type = 'travel_expense_report' and r.source_id = $1
		   and r.request_cycle_key = 'travel_expense_report:' || t.id || ':submission:' || t.submission_count`,
		[reportId],
	);
	const revisionId = revision.rows[0]?.id;
	if (!revisionId) throw new Error("no revision");
	return { reportId, revisionId };
}

async function grant(
	officer: Person,
	values: {
		scope: "all" | "specific";
		teamIds?: string[];
		employeeIds?: string[];
		canExport?: boolean;
		canRecordReimbursements?: boolean;
	},
) {
	signIn("owner");
	const saved = await officers.saveExpenseOfficerGrantAction({
		officerEmployeeId: ids[officer],
		teamIds: [],
		employeeIds: [],
		canExport: false,
		canRecordReimbursements: false,
		...values,
	});
	if (!saved.success) throw new Error(saved.error);
	return saved.data.grantId;
}

async function queueIds(person: Person) {
	signIn(person);
	const queue = await finance.getTravelExpenseFinanceQueue({
		...DEFAULT_FINANCE_QUEUE_VIEW,
		status: "all",
	});
	return queue.success ? queue.data.accounts.map((account) => account.source.id).toSorted() : null;
}

function reimburse(person: Person, reportId: string, idempotencyKey = randomUUID()) {
	signIn(person);
	return finance.recordTravelExpenseReimbursementAction({
		source: { type: "report", id: reportId },
		idempotencyKey,
		amount: "12.50",
		occurredOn: "2026-10-01",
		reference: "Bank transfer",
		note: null,
		expectedBalance: { currency: "EUR", amount: "12.50" },
	});
}

async function download(person: Person, batchId: string) {
	signIn(person);
	return downloadExport(
		new Request(
			`http://localhost/api/travel-expenses/exports/${batchId}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ batchId }) },
	);
}

async function runJobs() {
	for (const job of harness.jobs.splice(0)) {
		await processTravelExpenseExportBatch(db, job);
	}
}

describe("expense officer access (#747)", () => {
	let berlinReport: { reportId: string; revisionId: string };
	let munichReport: { reportId: string; revisionId: string };
	let leaverReport: { reportId: string; revisionId: string };

	beforeAll(async () => {
		await seed();
		berlinReport = await approvedReceipt("berliner");
		munichReport = await approvedReceipt("muncher");
		leaverReport = await approvedReceipt("leaver");
	}, 60_000);
	afterAll(cleanup);

	it("gives no finance access without a grant, and everything to owners", async () => {
		expect(await queueIds("exporter")).toBeNull();
		expect(await queueIds("owner")).toEqual(
			[berlinReport.reportId, munichReport.reportId, leaverReport.reportId].toSorted(),
		);
	});

	it("audits grant changes and lets an unchanged grant naming a departed employee be saved again", async () => {
		const grantId = await grant("auditor", { scope: "specific", employeeIds: [ids.leaver] });
		await admin.query("update employee set is_active = false where id = $1", [ids.leaver]);
		// Unchanged: nothing to write, and the departed employee does not fail it.
		expect(await grant("auditor", { scope: "specific", employeeIds: [ids.leaver] })).toBe(grantId);
		await grant("auditor", {
			scope: "specific",
			employeeIds: [ids.leaver],
			teamIds: [ids.munich],
		});
		const audits = await admin.query<{ action: string; changes: string }>(
			"select action, changes from audit_log where entity_type = 'expense_officer_grant' and entity_id = $1 order by timestamp, id",
			[grantId],
		);
		expect(audits.rows.map((row) => row.action)).toEqual([
			"expense_officer.grant_created",
			"expense_officer.grant_changed",
		]);
		expect(JSON.parse(audits.rows[1]?.changes ?? "{}")).toEqual({
			from: {
				scope: "specific",
				teamIds: [],
				employeeIds: [ids.leaver],
				canExport: false,
				canRecordReimbursements: false,
			},
			to: {
				scope: "specific",
				teamIds: [ids.munich],
				employeeIds: [ids.leaver],
				canExport: false,
				canRecordReimbursements: false,
			},
		});
		// A read-only officer reads the departed employee's report and Munich's, nothing else.
		expect(await queueIds("auditor")).toEqual(
			[munichReport.reportId, leaverReport.reportId].toSorted(),
		);
		await admin.query("update employee set is_active = true where id = $1", [ids.leaver]);
	});

	it("keeps a report with the Berlin officer after its employee moves to Munich", async () => {
		await grant("reimburser", {
			scope: "specific",
			teamIds: [ids.berlin],
			canRecordReimbursements: true,
		});
		await admin.query("update employee set team_id = $1 where id = $2", [ids.munich, ids.berliner]);
		try {
			expect(await queueIds("reimburser")).toEqual(
				[berlinReport.reportId, leaverReport.reportId].toSorted(),
			);
		} finally {
			await admin.query("update employee set team_id = $1 where id = $2", [
				ids.berlin,
				ids.berliner,
			]);
		}
	});

	it("refuses out-of-scope report pages, receipts and settlement panels", async () => {
		signIn("reimburser");
		expect((await loadAuthorizedTravelExpenseReport(berlinReport.reportId)).status).toBe("found");
		expect((await loadAuthorizedTravelExpenseReport(munichReport.reportId)).status).toBe(
			"not_found",
		);
		const inScope = await finance.getTravelExpenseSettlement({
			type: "report",
			id: berlinReport.reportId,
		});
		expect(inScope.success && inScope.data?.canSettle).toBe(true);
		expect(
			await finance.getTravelExpenseSettlement({ type: "report", id: munichReport.reportId }),
		).toEqual({ success: false, error: "Not found" });
	});

	it("records reimbursements only in scope, and never for an export-only officer", async () => {
		expect(await reimburse("reimburser", munichReport.reportId)).toEqual({
			success: false,
			error: "Not found",
		});
		await grant("exporter", { scope: "specific", teamIds: [ids.berlin], canExport: true });
		expect(await reimburse("exporter", berlinReport.reportId)).toEqual({
			success: false,
			error: "Unauthorized",
		});
		signIn("exporter");
		const settlement = await finance.getTravelExpenseSettlement({
			type: "report",
			id: berlinReport.reportId,
		});
		expect(settlement.success && settlement.data?.canSettle).toBe(false);
		const recorded = await reimburse("reimburser", berlinReport.reportId);
		expect(recorded.success && recorded.data.status).toBe("recorded");
	});

	it("lets a reimburse-only officer not export", async () => {
		signIn("reimburser");
		expect(await exportActions.getTravelExpenseExports()).toEqual({
			success: false,
			error: "Unauthorized",
		});
	});

	it("exports in-scope reports only and shows only the batches the officer may see", async () => {
		signIn("exporter");
		const view = await exportActions.getTravelExpenseExports();
		if (!view.success) throw new Error(view.error);
		expect(view.data.exportable.map((row) => row.reportId).toSorted()).toEqual(
			[berlinReport.reportId, leaverReport.reportId].toSorted(),
		);
		expect(
			await exportActions.createTravelExpenseExportAction({
				idempotencyKey: randomUUID(),
				selection: [munichReport],
			}),
		).toEqual({
			success: true,
			data: { status: "stale_selection", reportIds: [munichReport.reportId] },
		});

		// The owner exports Berlin and Munich together: not every report is in the officer's scope.
		signIn("owner");
		const mixed = await exportActions.createTravelExpenseExportAction({
			idempotencyKey: randomUUID(),
			selection: [berlinReport, munichReport],
		});
		if (!mixed.success || mixed.data.status !== "created") throw new Error("mixed export failed");
		// The officer exports the departed-team-member's Berlin report themselves.
		signIn("exporter");
		const own = await exportActions.createTravelExpenseExportAction({
			idempotencyKey: randomUUID(),
			selection: [leaverReport],
		});
		if (!own.success || own.data.status !== "created") throw new Error("own export failed");
		await runJobs();

		const listed = await exportActions.getTravelExpenseExports();
		if (!listed.success) throw new Error(listed.error);
		expect(listed.data.batches.map((batch) => batch.id)).toEqual([own.data.batchId]);
		expect((await download("exporter", own.data.batchId)).status).toBe(200);
		expect((await download("exporter", mixed.data.batchId)).status).toBe(404);
		signIn("exporter");
		expect(await exportActions.cancelTravelExpenseExportAction(mixed.data.batchId)).toEqual({
			success: false,
			error: "Not found",
		});
		expect((await download("owner", mixed.data.batchId)).status).toBe(200);
	});

	it("never puts a report without recorded teams in a team scope, nor its batch", async () => {
		const unrecorded = await approvedReceipt("berliner");
		await admin.query("update travel_expense_report set approval_team_ids = null where id = $1", [
			unrecorded.reportId,
		]);
		expect(await queueIds("exporter")).not.toContain(unrecorded.reportId);
		signIn("owner");
		const batch = await exportActions.createTravelExpenseExportAction({
			idempotencyKey: randomUUID(),
			selection: [unrecorded],
		});
		if (!batch.success || batch.data.status !== "created") throw new Error("export failed");
		await runJobs();
		signIn("exporter");
		const listed = await exportActions.getTravelExpenseExports();
		if (!listed.success) throw new Error(listed.error);
		expect(listed.data.batches.map((entry) => entry.id)).not.toContain(batch.data.batchId);
		expect((await download("exporter", batch.data.batchId)).status).toBe(404);
	});

	it("shows an all-scope officer every batch", async () => {
		await grant("exporter", { scope: "all", canExport: true });
		signIn("exporter");
		const listed = await exportActions.getTravelExpenseExports();
		if (!listed.success) throw new Error(listed.error);
		expect(listed.data.batches).toHaveLength(3);
	});

	it("ends access immediately when the grant is revoked, and audits the revocation", async () => {
		signIn("owner");
		const data = await officers.getExpenseOfficerAdminData();
		if (!data.success) throw new Error(data.error);
		const reimburserGrant = data.data.grants.find(
			(entry) => entry.officerEmployeeId === ids.reimburser,
		);
		if (!reimburserGrant) throw new Error("no grant");
		expect(await officers.revokeExpenseOfficerGrantAction({ grantId: reimburserGrant.id })).toEqual(
			{ success: true, data: { grantId: reimburserGrant.id } },
		);
		expect(await queueIds("reimburser")).toBeNull();
		signIn("reimburser");
		expect((await loadAuthorizedTravelExpenseReport(berlinReport.reportId)).status).toBe(
			"not_found",
		);
		const revoked = await admin.query<{ changes: string }>(
			"select changes from audit_log where entity_id = $1 and action = 'expense_officer.grant_revoked'",
			[reimburserGrant.id],
		);
		expect(JSON.parse(revoked.rows[0]?.changes ?? "{}")).toMatchObject({
			from: { scope: "specific", teamIds: [ids.berlin], canRecordReimbursements: true },
			to: null,
		});
	});

	it("refuses grant management to non-administrators and grants in other organizations' terms", async () => {
		signIn("exporter");
		expect((await officers.getExpenseOfficerAdminData()).success).toBe(false);
		signIn("owner");
		const foreignTeam = await officers.saveExpenseOfficerGrantAction({
			officerEmployeeId: ids.auditor,
			scope: "specific",
			teamIds: [randomUUID()],
			employeeIds: [],
			canExport: false,
			canRecordReimbursements: false,
		});
		expect(foreignTeam).toEqual({
			success: false,
			error: "All teams must belong to the active organization",
		});
	});
});
