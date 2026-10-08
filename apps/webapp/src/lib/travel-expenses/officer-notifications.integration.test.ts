/**
 * #756: ready-for-reimbursement notifications to expense officers and the
 * coverage-gap warning.
 *
 * Reports are submitted, approved (by a reviewer, or by the owner's
 * self-approval), reimbursed and adjusted through the real actions and
 * Approvals inbox route against a disposable PostgreSQL database. Grants are
 * managed through the Access tab's server actions. The real notification
 * service writes to the database; email is captured instead of sent. Only the
 * session, the decision trigger, the queue and object storage are replaced. */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
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
								activeOrganizationId: "t756-org",
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
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original, [
		"onTravelExpenseReportDecided",
	]),
);
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
);
vi.mock("@/lib/queue", () => ({
	async addJob() {
		return { id: randomUUID() };
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t756-public",
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
		return { bucket: "t756-private", versionId: `v-${key.length}` };
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
const adjustments = await import("@/app/[locale]/(app)/travel-expenses/adjustment-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const officers = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/expense-officer-actions"
);
const { notifyReadyForReimbursement } = await import(
	"@/lib/travel-expenses/ready-for-reimbursement"
);
const { db } = await import("@/db");
const { sendEmail } = await import("@/lib/email/email-service");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	berliner: "e7560000-0000-4000-8000-000000000001",
	muncher: "e7560000-0000-4000-8000-000000000002",
	manager: "e7560000-0000-4000-8000-000000000003",
	owner: "e7560000-0000-4000-8000-000000000004",
	berlinOfficer: "e7560000-0000-4000-8000-000000000005",
	allOfficer: "e7560000-0000-4000-8000-000000000006",
	exporter: "e7560000-0000-4000-8000-000000000007",
	berlin: "e7561000-0000-4000-8000-000000000001",
	munich: "e7561000-0000-4000-8000-000000000002",
} as const;
type Person =
	| "berliner"
	| "muncher"
	| "manager"
	| "owner"
	| "berlinOfficer"
	| "allOfficer"
	| "exporter";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id = 't756-org'");
	await admin.query("delete from travel_expense_receipt_upload where organization_id = 't756-org'");
	await admin.query('delete from "user" where id like $1', ["t756-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ('t756-org','Expenses','t756-org','Europe/Berlin',now())`,
	);
	for (const [team, name] of [
		[ids.berlin, "Berlin"],
		[ids.munich, "Munich"],
	]) {
		await admin.query(
			"insert into team (id, organization_id, name, updated_at) values ($1, 't756-org', $2, now())",
			[team, name],
		);
	}
	const people: Array<[Person, string, string, string | null]> = [
		["berliner", "member", "employee", ids.berlin],
		["muncher", "member", "employee", ids.munich],
		["manager", "member", "manager", null],
		["owner", "owner", "admin", null],
		["berlinOfficer", "member", "employee", null],
		// The all-scope officer is in Berlin too, so the Berlin officer covers their reports.
		["allOfficer", "member", "employee", ids.berlin],
		["exporter", "member", "employee", null],
	];
	for (const [name, memberRole, role, teamId] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t756-${name}`, name, `t756-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,'t756-org',$2,$3,'approved',now())",
			[`t756-member-${name}`, `t756-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,team_id,updated_at) values ($1,$2,'t756-org',$3,$4,now())",
			[ids[name], `t756-${name}`, role, teamId],
		);
	}
	for (const requester of [ids.berliner, ids.muncher, ids.allOfficer]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't756-manager', now(), now())`,
			[requester, ids.manager],
		);
	}
}

function signIn(name: Person) {
	harness.userId = `t756-${name}`;
}

async function loadOwn(reportId: string) {
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	return report.data;
}

async function setAmount(reportId: string, description: string, amount: string) {
	const item = (await loadOwn(reportId)).items[0];
	if (!item) throw new Error("no item");
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: "2026-09-02",
			category: "transport",
			description,
			amount,
			currency: "EUR",
			paidBy: "employee",
			accountingReference: null,
		},
	});
	if (!saved.success) throw new Error("save failed");
}

async function submit(reportId: string) {
	const report = await loadOwn(reportId);
	const submitted = await actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: {
			detailsVersion: report.trip?.version ?? null,
			items: report.items.map((entry) => ({
				id: entry.id,
				version: entry.version,
				receiptIds: entry.receipts.map((receipt) => receipt.id),
			})),
		},
	});
	if (!submitted.success) throw new Error(submitted.error);
	return submitted.data;
}

async function approve(reportId: string) {
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
}

/** A submitted standalone EUR receipt of the person, approved by the manager or self-approved. */
async function approvedReceipt(person: Person, description: string, amount = "12.50") {
	signIn(person);
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	await setAmount(reportId, description, amount);
	const item = (await loadOwn(reportId)).items[0];
	if (!item) throw new Error("no item");
	const tusFileKey = createOwnedTusFileKey(`t756-${person}`);
	harness.tus.set(tusFileKey, pdfBytes);
	const uploaded = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId: item.id, fileName: "taxi.pdf" }),
		}) as unknown as NextRequest,
	);
	expect(uploaded.status).toBe(200);
	const submitted = await submit(reportId);
	if (submitted.status === "submitted") await approve(reportId);
	const { rows } = await admin.query<{ status: string }>(
		"select status from travel_expense_report where id = $1",
		[reportId],
	);
	expect(rows[0]?.status).toBe("approved");
	return { reportId, submitted };
}

async function grant(
	officer: Person,
	values: {
		scope: "all" | "specific";
		teamIds?: string[];
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
}

interface NotificationRow {
	user_id: string;
	message: string;
	entity_id: string;
	action_url: string;
	metadata: string;
}

async function officerNotifications(): Promise<NotificationRow[]> {
	const { rows } = await admin.query<NotificationRow>(
		`select user_id, message, entity_id::text, action_url, metadata from notification
		 where organization_id = 't756-org' and type = 'travel_expense_ready_for_reimbursement'
		 order by created_at, user_id`,
	);
	return rows;
}

/** The recipients of the officer notifications about one report, sorted. */
async function recipientsFor(reportId: string) {
	return (await officerNotifications())
		.filter((row) => row.entity_id === reportId)
		.map((row) => row.user_id)
		.toSorted();
}

async function coverageGap(person: Person) {
	signIn(person);
	return finance.getExpenseOfficerCoverageGap();
}

describe("expense officer notifications and coverage gap (#756)", () => {
	let munichReport: string;
	let berlinReport: string;
	let trainReport: string;

	beforeAll(async () => {
		await seed();
	}, 60_000);
	afterAll(cleanup);

	it("notifies nobody and warns nobody in an organization without expense officers", async () => {
		({ reportId: munichReport } = await approvedReceipt("muncher", "Taxi Munich"));
		expect(await officerNotifications()).toEqual([]);
		expect(await coverageGap("owner")).toEqual({ success: true, data: null });
	});

	it("notifies the covering officer who can reimburse, and counts what nobody covers", async () => {
		await grant("berlinOfficer", {
			scope: "specific",
			teamIds: [ids.berlin],
			canRecordReimbursements: true,
		});
		await grant("exporter", { scope: "all", canExport: true });
		({ reportId: berlinReport } = await approvedReceipt("berliner", "Taxi Berlin"));

		// Not the export-only officer, the owner or the manager.
		expect(await recipientsFor(berlinReport)).toEqual(["t756-berlinOfficer"]);
		const [notification] = await officerNotifications();
		expect(notification).toMatchObject({
			message:
				"berliner's expense report Taxi Berlin is approved. Awaiting reimbursement: 12.50 EUR.",
			action_url: `/travel-expenses/reports/${berlinReport}`,
		});
		// In-app only until the officer turns on another channel.
		expect(vi.mocked(sendEmail).mock.calls.map(([email]) => email.to)).not.toContain(
			"t756-berlinOfficer@example.test",
		);

		// The Munich report awaits reimbursement and no officer can record it.
		expect(await coverageGap("owner")).toEqual({
			success: true,
			data: { uncovered: 1, truncated: false },
		});
		signIn("owner");
		const queue = await finance.getTravelExpenseFinanceQueue("open", "uncovered");
		expect(queue.success && queue.data.accounts.map((account) => account.source.id)).toEqual([
			munichReport,
		]);
	});

	it("shows the warning and the uncovered queue to owners and admins only", async () => {
		expect(await coverageGap("berlinOfficer")).toEqual({ success: true, data: null });
		signIn("berlinOfficer");
		expect(await finance.getTravelExpenseFinanceQueue("open", "uncovered")).toEqual({
			success: false,
			error: "Unauthorized",
		});
	});

	it("clears the warning once a covering grant exists, and notifies every covering officer", async () => {
		await grant("allOfficer", { scope: "all", canRecordReimbursements: true });
		expect(await coverageGap("owner")).toEqual({
			success: true,
			data: { uncovered: 0, truncated: false },
		});

		({ reportId: trainReport } = await approvedReceipt("berliner", "Train Berlin"));
		expect(await recipientsFor(trainReport)).toEqual(["t756-allOfficer", "t756-berlinOfficer"]);
		const { reportId: munich } = await approvedReceipt("muncher", "Train Munich");
		expect(await recipientsFor(munich)).toEqual(["t756-allOfficer"]);
	});

	it("never notifies an officer of their own report", async () => {
		const { reportId } = await approvedReceipt("allOfficer", "Taxi of the officer");
		expect(await recipientsFor(reportId)).toEqual(["t756-berlinOfficer"]);
	});

	it("notifies the officers of an owner's self-approved report", async () => {
		const { reportId, submitted } = await approvedReceipt("owner", "Taxi of the owner");
		expect(submitted.status).toBe("self_approved");
		expect(await recipientsFor(reportId)).toEqual(["t756-allOfficer"]);
	});

	it("notifies once per approved revision", async () => {
		const before = await officerNotifications();
		await notifyReadyForReimbursement(db, { organizationId: "t756-org", reportId: trainReport });
		expect(await officerNotifications()).toEqual(before);
	});

	it("notifies again when an approved adjustment raises the amount owed, never when it lowers it", async () => {
		signIn("berlinOfficer");
		const paid = await finance.recordTravelExpenseReimbursementAction({
			source: { type: "report", id: berlinReport },
			idempotencyKey: randomUUID(),
			amount: "12.50",
			occurredOn: "2026-10-01",
			reference: "Bank transfer",
			note: null,
			expectedBalance: { currency: "EUR", amount: "12.50" },
		});
		expect(paid.success && paid.data.status).toBe("recorded");

		const adjust = async (amount: string) => {
			signIn("berliner");
			const created = await adjustments.createTravelExpenseAdjustmentAction({
				originalReportId: berlinReport,
				reason: "The taxi receipt was wrong",
				idempotencyKey: randomUUID(),
			});
			if (!created.success || created.data.status !== "created") throw new Error("no adjustment");
			await setAmount(created.data.reportId, "Taxi Berlin", amount);
			expect(await submit(created.data.reportId)).toEqual({ status: "submitted" });
			await approve(created.data.reportId);
		};

		const before = (await recipientsFor(berlinReport)).length;
		await adjust("20.00");
		const raised = (await officerNotifications()).filter((row) => row.entity_id === berlinReport);
		expect(
			raised
				.slice(before)
				.map((row) => row.user_id)
				.toSorted(),
		).toEqual(["t756-allOfficer", "t756-berlinOfficer"]);
		expect(raised.at(-1)?.message).toBe(
			"An approved adjustment raised what is owed on berliner's expense report Taxi Berlin. Awaiting reimbursement: 7.50 EUR.",
		);

		await adjust("15.00");
		expect(await recipientsFor(berlinReport)).toHaveLength(raised.length);
	});
});
