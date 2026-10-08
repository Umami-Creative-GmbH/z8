/**
 * #753: finance queue filters, pagination and the awaiting-reimbursement count.
 *
 * Reports are submitted and approved through the real report actions and
 * Approvals inbox route against a disposable PostgreSQL database, so each
 * approved report records its employee's teams (#746). Legacy claims are
 * inserted directly, which makes hundreds of approved accounts cheap. The
 * session, notifications, the job queue and object storage are replaced.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
								activeOrganizationId: "t753-org",
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
	addJob: async () => ({ id: randomUUID() }),
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t753-public",
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
	async uploadPrivateObject(_organizationId: string, key: string) {
		return { bucket: "t753-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject() {
		throw new Error("NoSuchKey");
	},
	async deletePrivateObject() {},
}));

const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const exportActions = await import("@/app/[locale]/(app)/travel-expenses/finance-export-actions");
const officers = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/expense-officer-actions"
);
const { loadFinanceActor } = await import("@/lib/travel-expenses/finance-access");
const { DEFAULT_FINANCE_QUEUE_VIEW } = await import("@/lib/travel-expenses/finance-queue-params");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	berliner: "e7530000-0000-4000-8000-000000000001",
	muncher: "e7530000-0000-4000-8000-000000000002",
	manager: "e7530000-0000-4000-8000-000000000003",
	owner: "e7530000-0000-4000-8000-000000000004",
	officer: "e7530000-0000-4000-8000-000000000005",
	berlin: "e7531000-0000-4000-8000-000000000001",
	munich: "e7531000-0000-4000-8000-000000000002",
	berlinClaim: "e7532000-0000-4000-8000-000000000001",
	munichClaim: "e7532000-0000-4000-8000-000000000002",
} as const;
type Person = "berliner" | "muncher" | "manager" | "owner" | "officer";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id = 't753-org'");
	await admin.query("delete from travel_expense_receipt_upload where organization_id = 't753-org'");
	await admin.query('delete from "user" where id like $1', ["t753-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ('t753-org','Expenses','t753-org','Europe/Berlin',now())`,
	);
	for (const [team, name] of [
		[ids.berlin, "Berlin"],
		[ids.munich, "Munich"],
	]) {
		await admin.query(
			"insert into team (id, organization_id, name, updated_at) values ($1, 't753-org', $2, now())",
			[team, name],
		);
	}
	const people: Array<[Person, string, string, string | null]> = [
		["berliner", "member", "employee", ids.berlin],
		["muncher", "member", "employee", ids.munich],
		["manager", "member", "manager", null],
		["owner", "owner", "admin", null],
		["officer", "member", "employee", null],
	];
	for (const [name, memberRole, role, teamId] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t753-${name}`, name, `t753-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,'t753-org',$2,$3,'approved',now())",
			[`t753-member-${name}`, `t753-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,team_id,updated_at) values ($1,$2,'t753-org',$3,$4,now())",
			[ids[name], `t753-${name}`, role, teamId],
		);
	}
	for (const requester of [ids.berliner, ids.muncher]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't753-manager', now(), now())`,
			[requester, ids.manager],
		);
	}
	// Approved legacy claims, decided before every report: Berlin in CHF, Munich in EUR.
	for (const [claimId, employeeId, teamId, currency] of [
		[ids.berlinClaim, ids.berliner, ids.berlin, "CHF"],
		[ids.munichClaim, ids.muncher, ids.munich, "EUR"],
	]) {
		await insertClaims({
			count: 1,
			employeeId,
			teamId,
			currency,
			firstId: claimId,
			decidedBefore: "2026-08-02",
		});
	}
}

/** Approved legacy claims of 10.00 each, decided one minute apart before decidedBefore. */
async function insertClaims(input: {
	count: number;
	employeeId: string;
	teamId: string;
	currency: string;
	firstId?: string;
	decidedBefore?: string;
}): Promise<string[]> {
	const { rows } = await admin.query<{ id: string }>(
		`insert into travel_expense_claim (id, organization_id, employee_id, type, status, trip_start, trip_end,
		   original_currency, original_amount, calculated_currency, calculated_amount,
		   submitted_at, decided_at, created_by, updated_at, approval_team_ids)
		 select case when n = 1 and $5::uuid is not null then $5::uuid else gen_random_uuid() end,
		   't753-org', $1, 'mileage', 'approved', '2026-07-01', '2026-07-01',
		   $3, '10.00', $3, '10.00', '2026-07-02', $6::timestamp - n * interval '1 minute',
		   't753-owner', now(), array[$2::uuid]
		 from generate_series(1, $4::int) as n
		 returning id`,
		[
			input.employeeId,
			input.teamId,
			input.currency,
			input.count,
			input.firstId ?? null,
			input.decidedBefore ?? "2026-08-01",
		],
	);
	return rows.map((row) => row.id);
}

function signIn(name: Person) {
	harness.userId = `t753-${name}`;
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
	const tusFileKey = createOwnedTusFileKey(`t753-${person}`);
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

async function grantOfficer(values: { teamIds?: string[]; employeeIds?: string[] }) {
	signIn("owner");
	const saved = await officers.saveExpenseOfficerGrantAction({
		officerEmployeeId: ids.officer,
		scope: "specific",
		teamIds: [],
		employeeIds: [],
		canExport: false,
		canRecordReimbursements: true,
		...values,
	});
	if (!saved.success) throw new Error(saved.error);
	return saved.data.grantId;
}

type View = Partial<typeof DEFAULT_FINANCE_QUEUE_VIEW>;

async function queue(person: Person, view: View = {}) {
	signIn(person);
	const result = await finance.getTravelExpenseFinanceQueue({
		...DEFAULT_FINANCE_QUEUE_VIEW,
		status: "all",
		...view,
	});
	if (!result.success) throw new Error(result.error);
	return result.data;
}

async function queueIds(person: Person, view: View = {}) {
	return (await queue(person, view)).accounts.map((account) => account.source.id).toSorted();
}

async function awaitingCount(person: Person) {
	signIn(person);
	return finance.getTravelExpenseFinanceAwaitingCount();
}

describe("finance queue filters and pages (#753)", () => {
	let berlinReport: { reportId: string; revisionId: string };
	let munichReport: { reportId: string; revisionId: string };

	beforeAll(async () => {
		await seed();
		berlinReport = await approvedReceipt("berliner");
		munichReport = await approvedReceipt("muncher");
		await grantOfficer({ teamIds: [ids.berlin] });
	}, 60_000);
	afterAll(cleanup);

	it("combines every filter with the officer's scope", async () => {
		const berlin = [berlinReport.reportId, ids.berlinClaim].toSorted();
		expect(await queueIds("officer")).toEqual(berlin);
		expect(await queueIds("officer", { teamId: ids.berlin })).toEqual(berlin);
		// Filters never widen the scope.
		expect(await queueIds("officer", { teamId: ids.munich })).toEqual([]);
		expect(await queueIds("officer", { employeeId: ids.muncher })).toEqual([]);
		expect(await queueIds("officer", { employeeId: ids.berliner })).toEqual(berlin);
		expect(await queueIds("officer", { currency: "CHF" })).toEqual([ids.berlinClaim]);
		expect(await queueIds("officer", { currency: "EUR" })).toEqual([berlinReport.reportId]);
		expect(await queueIds("owner", { currency: "EUR", employeeId: ids.muncher })).toEqual(
			[munichReport.reportId, ids.munichClaim].toSorted(),
		);
	});

	it("matches the team recorded at approval, not the employee's current team", async () => {
		await admin.query("update employee set team_id = $1 where id = $2", [ids.munich, ids.berliner]);
		try {
			expect(await queueIds("owner", { teamId: ids.berlin })).toEqual(
				[berlinReport.reportId, ids.berlinClaim].toSorted(),
			);
			expect(await queueIds("owner", { teamId: ids.munich })).toEqual(
				[munichReport.reportId, ids.munichClaim].toSorted(),
			);
		} finally {
			await admin.query("update employee set team_id = $1 where id = $2", [
				ids.berlin,
				ids.berliner,
			]);
		}
	});

	it("leaves out reports in an export batch that is not cancelled, until the batch is cancelled", async () => {
		// Legacy claims are never exported, so they are not waiting for an export either.
		expect(await queueIds("owner", { notExported: true })).toEqual(
			[berlinReport.reportId, munichReport.reportId].toSorted(),
		);
		signIn("owner");
		const batch = await exportActions.createTravelExpenseExportAction({
			idempotencyKey: randomUUID(),
			selection: [berlinReport],
		});
		if (!batch.success || batch.data.status !== "created") throw new Error("export failed");
		expect(await queueIds("owner", { notExported: true })).toEqual([munichReport.reportId]);
		expect(await queueIds("officer", { notExported: true })).toEqual([]);
		signIn("owner");
		const cancelled = await exportActions.cancelTravelExpenseExportAction(batch.data.batchId);
		expect(cancelled.success).toBe(true);
		expect(await queueIds("officer", { notExported: true })).toEqual([berlinReport.reportId]);
	});

	it("offers the employees, recorded teams and currencies of the officer's scope as filters", async () => {
		signIn("officer");
		expect(await finance.getTravelExpenseFinanceQueueFilterOptions()).toEqual({
			success: true,
			data: {
				employees: [{ id: ids.berliner, name: "berliner" }],
				teams: [{ id: ids.berlin, name: "Berlin" }],
				currencies: ["CHF", "EUR"],
			},
		});
		signIn("owner");
		const all = await finance.getTravelExpenseFinanceQueueFilterOptions();
		expect(all.success && all.data.teams.map((team) => team.name)).toEqual(["Berlin", "Munich"]);
	});

	it("pages beyond 500 accounts, in scope, newest decision first", async () => {
		const older = await insertClaims({
			count: 520,
			employeeId: ids.berliner,
			teamId: ids.berlin,
			currency: "EUR",
		});
		try {
			const seen: string[] = [];
			let page = 1;
			let hasMore = true;
			while (hasMore) {
				const data = await queue("officer", { page });
				expect(data.page).toBe(page);
				expect(data.accounts.length).toBeLessThanOrEqual(50);
				seen.push(...data.accounts.map((account) => account.source.id));
				hasMore = data.hasMore;
				page++;
			}
			// The report, the seeded claim and 520 older claims: 11 pages, no gaps, no repeats.
			expect(page - 1).toBe(11);
			expect(seen).toHaveLength(522);
			expect(new Set(seen).size).toBe(522);
			expect(seen.slice(0, 2)).toEqual([berlinReport.reportId, ids.berlinClaim]);
			// The inserted claims follow, newest decision first.
			expect(seen.slice(2, 4)).toEqual([older[0], older[1]]);
			expect(seen).not.toContain(munichReport.reportId);
			// Past the last page: nothing, and nothing more.
			const beyond = await queue("officer", { page: 12 });
			expect(beyond).toMatchObject({ accounts: [], hasMore: false });
		} finally {
			await admin.query("delete from travel_expense_claim where id = any($1::uuid[])", [older]);
		}
	});

	it("pages the open list past settled accounts", async () => {
		const settled = await insertClaims({
			count: 60,
			employeeId: ids.berliner,
			teamId: ids.berlin,
			currency: "EUR",
		});
		await admin.query(
			`insert into travel_expense_settlement_entry (organization_id, source_type, legacy_claim_id, kind, amount,
			   currency, occurred_on, reference, balance_before, idempotency_key, command_fingerprint, recorded_by_user_id)
			 select 't753-org', 'legacy_claim', id, 'reimbursement', '10.00', 'EUR', '2026-09-01', 'SEPA',
			   '10.00', gen_random_uuid()::text, 'fingerprint', 't753-owner'
			 from unnest($1::uuid[]) as id`,
			[settled],
		);
		try {
			expect(await queueIds("officer", { status: "open" })).toEqual(
				[berlinReport.reportId, ids.berlinClaim].toSorted(),
			);
			const reimbursed = await queue("officer", { status: "reimbursed" });
			expect(reimbursed.accounts).toHaveLength(50);
			expect(reimbursed.hasMore).toBe(true);
			const second = await queue("officer", { status: "reimbursed", page: 2 });
			expect(second.accounts).toHaveLength(10);
			expect(second.hasMore).toBe(false);
		} finally {
			await admin.query(
				"delete from travel_expense_settlement_entry where legacy_claim_id = any($1::uuid[])",
				[settled],
			);
			await admin.query("delete from travel_expense_claim where id = any($1::uuid[])", [settled]);
		}
	});

	it("counts the in-scope accounts awaiting reimbursement for the sidebar, and stops when the grant is revoked", async () => {
		expect(await awaitingCount("officer")).toEqual({ success: true, data: { count: 2 } });
		expect(await awaitingCount("owner")).toEqual({ success: true, data: { count: 4 } });
		signIn("officer");
		const recorded = await finance.recordTravelExpenseReimbursementAction({
			source: { type: "report", id: berlinReport.reportId },
			idempotencyKey: randomUUID(),
			amount: "12.50",
			occurredOn: "2026-10-01",
			reference: "Bank transfer",
			note: null,
			expectedBalance: { currency: "EUR", amount: "12.50" },
		});
		expect(recorded.success && recorded.data.status).toBe("recorded");
		expect(await awaitingCount("officer")).toEqual({ success: true, data: { count: 1 } });
		// An employee without a grant has no Finance item and no count.
		expect(await awaitingCount("berliner")).toEqual({ success: false, error: "Unauthorized" });

		signIn("officer");
		expect((await loadFinanceActor())?.canRead).toBe(true);
		signIn("owner");
		const data = await officers.getExpenseOfficerAdminData();
		if (!data.success) throw new Error(data.error);
		const grant = data.data.grants.find((entry) => entry.officerEmployeeId === ids.officer);
		if (!grant) throw new Error("no grant");
		await officers.revokeExpenseOfficerGrantAction({ grantId: grant.id });
		signIn("officer");
		expect((await loadFinanceActor())?.canRead).toBe(false);
		expect(await awaitingCount("officer")).toEqual({ success: false, error: "Unauthorized" });
	});
});
