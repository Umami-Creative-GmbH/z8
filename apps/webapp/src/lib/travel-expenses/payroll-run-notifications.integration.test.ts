/**
 * #855: with the payroll channel, expense officers are told once per payroll
 * run awaiting their confirmation instead of once per approved report; reports
 * a run leaves out, removes or discards still notify per report, once.
 *
 * Reports are submitted and approved through the real actions and routes,
 * exported through the real export service, against a disposable PostgreSQL
 * database. The real notification service writes to the database; email is
 * captured instead of sent. Only the session, the decision trigger, the queue
 * and object storage are replaced.
 */

import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	tus: new Map<string, Buffer>(),
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
								activeOrganizationId: "t855-org",
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
		"onTravelExpenseReportReturned",
	]),
);
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
);
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/lib/queue", () => ({
	async addJob() {
		return { id: randomUUID() };
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t855-public",
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
	async uploadPrivateObject() {
		return { bucket: "t855-private", versionId: "v-1" };
	},
	async readPrivateObject() {
		throw new Error("NoSuchKey");
	},
	async deletePrivateObject() {},
	async deletePrivateObjectVersions() {},
	async uploadExport() {},
	async getPresignedUrl(_organizationId: string, key: string) {
		return `https://exports.test/${key}`;
	},
}));

const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const { discardPayrollRunAction } = await import(
	"@/app/[locale]/(app)/settings/payroll-export/actions"
);
const { DEFAULT_FINANCE_QUEUE_VIEW } = await import("@/lib/travel-expenses/finance-queue-params");
const { createExportJob, processExportJob } = await import("@/lib/payroll-export/export-service");
const { sendEmail } = await import("@/lib/email/email-service");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { systemClock } = await import("@/lib/datetime/temporal-core");

const ORG = "t855-org";
const ids = {
	requester: "e8550000-0000-4000-8000-000000000001",
	colleague: "e8550000-0000-4000-8000-000000000002",
	manager: "e8550000-0000-4000-8000-000000000003",
	finance: "e8550000-0000-4000-8000-000000000004",
	allOfficer: "e8550000-0000-4000-8000-000000000005",
	berlinOfficer: "e8550000-0000-4000-8000-000000000006",
	exporter: "e8550000-0000-4000-8000-000000000007",
	berlin: "e8551000-0000-4000-8000-000000000001",
	munich: "e8551000-0000-4000-8000-000000000002",
} as const;
type Person =
	| "requester"
	| "colleague"
	| "manager"
	| "finance"
	| "allOfficer"
	| "berlinOfficer"
	| "exporter";
/** People whose expenses the manager approves. */
type Owner = "requester" | "colleague" | "allOfficer";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

const today = systemClock.nowInstant().toZonedDateTimeISO("Europe/Berlin").toPlainDate();
const day = (offset: number) => today.add({ days: offset }).toString();
interface Period {
	start: string;
	end: string;
}
/** The period every report approved today falls in. */
const current: Period = { start: day(-20), end: day(20) };
/** Another period that also covers today. */
const overlapping: Period = { start: day(-10), end: day(30) };

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query("delete from travel_expense_receipt_upload where organization_id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t855-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ($1,'Expenses',$1,'Europe/Berlin',now())`,
		[ORG],
	);
	for (const [team, name] of [
		[ids.berlin, "Berlin"],
		[ids.munich, "Munich"],
	]) {
		await admin.query(
			"insert into team (id, organization_id, name, updated_at) values ($1, $2, $3, now())",
			[team, ORG, name],
		);
	}
	const people: Array<[Person, string, string, string | null, string | null]> = [
		["requester", "member", "employee", ids.berlin, "P-REQ"],
		["colleague", "member", "employee", ids.munich, "P-COL"],
		["manager", "member", "manager", null, null],
		["finance", "admin", "employee", null, null],
		// The all-scope officer is in Berlin too, so the Berlin officer covers their reports.
		["allOfficer", "member", "employee", ids.berlin, "P-OFF"],
		["berlinOfficer", "member", "employee", null, null],
		["exporter", "member", "employee", null, null],
	];
	for (const [name, memberRole, role, teamId, employeeNumber] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t855-${name}`, name, `t855-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t855-member-${name}`, ORG, `t855-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,team_id,employee_number,updated_at) values ($1,$2,$3,$4,$5,$6,now())",
			[ids[name], `t855-${name}`, ORG, role, teamId, employeeNumber],
		);
	}
	for (const requester of [ids.requester, ids.colleague, ids.allOfficer]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't855-manager', now(), now())`,
			[requester, ids.manager],
		);
	}
	await grant("allOfficer", { scope: "all", canRecordReimbursements: true });
	const berlinGrant = await grant("berlinOfficer", {
		scope: "specific",
		canRecordReimbursements: true,
	});
	await admin.query(
		`insert into expense_officer_team (organization_id, grant_id, team_id, created_by)
		 values ($1, $2, $3, 't855-finance')`,
		[ORG, berlinGrant, ids.berlin],
	);
	// Exports, never records: told of nothing.
	await grant("exporter", { scope: "all", canExport: true });
	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at) values
		 ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()),
		 ('lexware_lohn', 'Lexware lohn+gehalt', '2024.1', now())
		 on conflict (id) do nothing`,
	);
	for (const [formatId, config] of Object.entries({
		datev_lohn: {
			mandantennummer: "12345",
			beraternummer: "1234567",
			personnelNumberType: "employeeNumber",
			includeZeroHours: false,
		},
		lexware_lohn: {
			personnelNumberType: "employeeNumber",
			includeZeroHours: false,
			includeStunden: true,
			includeStundensatz: false,
		},
	})) {
		await admin.query(
			`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
			 values ($1, $2, $3::jsonb, 't855-finance', now())`,
			[ORG, formatId, JSON.stringify(config)],
		);
	}
	// Only hotels are mapped: a taxi receipt is left out of every run.
	await admin.query(
		`insert into payroll_expense_wage_type_mapping
		 (organization_id, payroll_line_kind, datev_wage_type_code, lexware_wage_type_code)
		 values ($1, 'receipt_accommodation', '9100', 'LX9100')`,
		[ORG],
	);
	await setChannel("payroll_run");
	await admin.query(
		"insert into travel_expense_payroll_run_preview_control (organization_id, mode) values ($1, 'active')",
		[ORG],
	);
}

async function grant(
	officer: Person,
	values: { scope: "all" | "specific"; canExport?: boolean; canRecordReimbursements?: boolean },
): Promise<string> {
	const { rows } = await admin.query<{ id: string }>(
		`insert into expense_officer_grant
		 (organization_id, officer_employee_id, scope, can_export, can_record_reimbursements, created_by)
		 values ($1, $2, $3, $4, $5, 't855-finance') returning id`,
		[
			ORG,
			ids[officer],
			values.scope,
			values.canExport ?? false,
			values.canRecordReimbursements ?? false,
		],
	);
	return rows[0]?.id ?? "";
}

async function setChannel(channel: "bank_transfer" | "payroll_run") {
	await admin.query(
		`insert into travel_expense_settings (organization_id, reimbursement_channel) values ($1, $2)
		 on conflict (organization_id) do update set reimbursement_channel = excluded.reimbursement_channel`,
		[ORG, channel],
	);
}

function signIn(name: Person) {
	harness.userId = `t855-${name}`;
}

async function loadOwn(owner: Owner, reportId: string) {
	signIn(owner);
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	return report.data;
}

/** An approved standalone EUR receipt of `owner`, approved by the manager now. */
async function approvedReceipt(
	owner: Owner,
	amount: string,
	category: "accommodation" | "transport" = "accommodation",
) {
	signIn(owner);
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	const item = (await loadOwn(owner, reportId)).items[0];
	if (!item) throw new Error("no item");
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: day(-3),
			category,
			description: category === "accommodation" ? "Hotel Hamburg" : "Taxi Hamburg",
			amount,
			currency: "EUR",
			paidBy: "employee",
			accountingReference: null,
		},
	});
	if (!saved.success) throw new Error(saved.error);
	const tusFileKey = createOwnedTusFileKey(`t855-${owner}`);
	harness.tus.set(tusFileKey, pdfBytes);
	const uploaded = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId: item.id, fileName: "receipt.pdf" }),
		}) as unknown as NextRequest,
	);
	if (uploaded.status !== 200) throw new Error(`upload ${uploaded.status}`);
	const report = await loadOwn(owner, reportId);
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
	expect(submitted).toEqual({ success: true, data: { status: "submitted" } });
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
		[reportId],
	);
	signIn("manager");
	const approved = await approveRoute(
		new Request(`http://localhost/api/approvals/inbox/${rows[0]?.id}/approve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: rows[0]?.id ?? "" }) },
	);
	expect(approved.status).toBe(200);
	return reportId;
}

/** A payroll file export of the period, as the settings page starts it. */
async function exportPayroll(formatId: "datev_lohn" | "lexware_lohn", period: Period) {
	const { jobId } = await createExportJob({
		organizationId: ORG,
		formatId,
		requestedById: ids.finance,
		filters: {
			dateRange: {
				start: DateTime.fromISO(period.start, { zone: "utc" }),
				end: DateTime.fromISO(period.end, { zone: "utc" }),
			},
		},
	});
	await processExportJob({ jobId, organizationId: ORG });
	return jobId;
}

interface NotificationRow {
	user_id: string;
	message: string;
	entity_id: string;
	action_url: string;
}

async function notifications(
	type:
		| "travel_expense_ready_for_reimbursement"
		| "travel_expense_payroll_run_awaiting_confirmation",
): Promise<NotificationRow[]> {
	const { rows } = await admin.query<NotificationRow>(
		`select user_id, message, entity_id::text, action_url from notification
		 where organization_id = $1 and type = $2
		 order by user_id, created_at`,
		[ORG, type],
	);
	return rows;
}

const readyNotifications = () => notifications("travel_expense_ready_for_reimbursement");
const runNotifications = () => notifications("travel_expense_payroll_run_awaiting_confirmation");

/** Who was told about one report needing reimbursement, sorted. */
async function readyRecipients(reportId: string) {
	return (await readyNotifications())
		.filter((row) => row.entity_id === reportId)
		.map((row) => row.user_id)
		.toSorted();
}

const runMessage = (period: Period, format: string, count: number) =>
	`Payroll run ${period.start} – ${period.end} (${format}) is waiting for your confirmation. Reports in your scope: ${count}.`;

describe("payroll run notifications for expense officers (#855)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		vi.mocked(sendEmail).mockClear();
	});
	afterAll(cleanup);

	it("holds back the per-report notification at approval and tells each covering officer once per run", async () => {
		await approvedReceipt("requester", "100.00");
		await approvedReceipt("requester", "20.50");
		await approvedReceipt("colleague", "8.05");
		await approvedReceipt("allOfficer", "30.00");
		expect(await readyNotifications()).toEqual([]);

		const jobId = await exportPayroll("datev_lohn", current);

		// Never their own report; the export-only officer, owners and admins are not told.
		const notified = await runNotifications();
		expect(notified.map(({ user_id, message }) => ({ user_id, message }))).toEqual([
			{
				user_id: "t855-allOfficer",
				message: runMessage(current, "DATEV Lohn & Gehalt", 3),
			},
			{
				user_id: "t855-berlinOfficer",
				message: runMessage(current, "DATEV Lohn & Gehalt", 3),
			},
		]);
		expect(notified[0]).toMatchObject({
			entity_id: jobId,
			action_url: `/travel-expenses/finance?confirmRun=${jobId}#payroll-runs`,
		});
		// In-app only until the officer turns on another channel.
		expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();

		// A retried export of the same job does not tell them again.
		await processExportJob({ jobId, organizationId: ORG });
		expect(await runNotifications()).toHaveLength(2);
		expect(await readyNotifications()).toEqual([]);
	});

	it("counts for each officer exactly the reports they can confirm", async () => {
		await approvedReceipt("requester", "100.00");
		await approvedReceipt("colleague", "8.05");
		await approvedReceipt("allOfficer", "30.00");
		const jobId = await exportPayroll("datev_lohn", current);

		// Everyone but themselves for the all-scope officer; the Berlin reports for the Berlin officer.
		for (const [officer, count] of [
			["allOfficer", 2],
			["berlinOfficer", 2],
		] as const) {
			signIn(officer);
			const listed = await finance.getPayrollRunsToConfirmAction();
			expect(listed).toEqual({
				success: true,
				data: [expect.objectContaining({ jobId, confirmableReports: count })],
			});
			expect(
				(await runNotifications()).find((row) => row.user_id === `t855-${officer}`)?.message,
			).toBe(runMessage(current, "DATEV Lohn & Gehalt", count));
		}
	});

	it("tells the covering officers once about a report the run leaves out", async () => {
		const hotel = await approvedReceipt("requester", "100.00");
		const taxi = await approvedReceipt("requester", "12.00", "transport");
		expect(await readyNotifications()).toEqual([]);

		await exportPayroll("datev_lohn", current);

		expect(await readyRecipients(taxi)).toEqual(["t855-allOfficer", "t855-berlinOfficer"]);
		expect(await readyRecipients(hotel)).toEqual([]);
		expect((await readyNotifications())[0]?.message).toBe(
			"requester's expense report Taxi Hamburg is not paid with a payroll run. Awaiting reimbursement: 12.00 EUR.",
		);
		expect((await runNotifications()).map((row) => row.message)).toEqual([
			runMessage(current, "DATEV Lohn & Gehalt", 1),
			runMessage(current, "DATEV Lohn & Gehalt", 1),
		]);

		// Exporting again leaves it out again, without telling anyone twice.
		await exportPayroll("lexware_lohn", current);
		expect(await readyRecipients(taxi)).toEqual(["t855-allOfficer", "t855-berlinOfficer"]);
	});

	it("keeps the per-report notification and sends no run notification with the bank-transfer channel", async () => {
		await setChannel("bank_transfer");
		const hotel = await approvedReceipt("requester", "100.00");

		expect(await readyRecipients(hotel)).toEqual(["t855-allOfficer", "t855-berlinOfficer"]);
		expect((await readyNotifications())[0]?.message).toBe(
			"requester's expense report Hotel Hamburg is approved. Awaiting reimbursement: 100.00 EUR.",
		);
		await exportPayroll("datev_lohn", current);
		expect(await runNotifications()).toEqual([]);
		expect(await readyNotifications()).toHaveLength(2);
	});

	it("tells the covering officers about a report removed from a run or freed by a discard", async () => {
		const removed = await approvedReceipt("requester", "100.00");
		const discarded = await approvedReceipt("requester", "20.50");
		const jobId = await exportPayroll("datev_lohn", current);
		expect(await readyNotifications()).toEqual([]);

		signIn("berlinOfficer");
		expect(await finance.removeTravelExpenseFromPayrollRunAction({ reportId: removed })).toEqual({
			success: true,
			data: { status: "removed", jobId },
		});
		// Not the officer who removed it: they know.
		expect(await readyRecipients(removed)).toEqual(["t855-allOfficer"]);

		signIn("finance");
		const result = await discardPayrollRunAction(ORG, jobId);
		expect(result).toEqual({
			success: true,
			data: { status: "discarded", reportIds: [discarded] },
		});
		expect(await readyRecipients(discarded)).toEqual(["t855-allOfficer", "t855-berlinOfficer"]);
		expect(await readyRecipients(removed)).toEqual(["t855-allOfficer"]);

		// Taken by the next run, then left out of none: nobody is told twice.
		await exportPayroll("datev_lohn", overlapping);
		expect(await readyNotifications()).toHaveLength(3);
		expect((await runNotifications()).map((row) => row.message)).toContain(
			runMessage(overlapping, "DATEV Lohn & Gehalt", 2),
		);
	});

	it("counts reports a run includes that no officer who confirms covers in the coverage gap", async () => {
		await admin.query(
			"update expense_officer_grant set is_active = false where officer_employee_id = $1",
			[ids.allOfficer],
		);
		const munich = await approvedReceipt("colleague", "8.05");
		await approvedReceipt("requester", "100.00");
		await exportPayroll("datev_lohn", current);

		expect(
			(await runNotifications()).map(({ user_id, message }) => ({ user_id, message })),
		).toEqual([
			{ user_id: "t855-berlinOfficer", message: runMessage(current, "DATEV Lohn & Gehalt", 1) },
		]);
		signIn("finance");
		expect(await finance.getExpenseOfficerCoverageGap()).toEqual({
			success: true,
			data: { uncovered: 1 },
		});
		const queue = await finance.getTravelExpenseFinanceQueue(
			DEFAULT_FINANCE_QUEUE_VIEW,
			"uncovered",
		);
		expect(queue.success && queue.data.accounts.map((account) => account.source.id)).toEqual([
			munich,
		]);
	});
});
