/**
 * #607: foreign-currency expenses converted by an evidenced card charge or an
 * authorized documented rate, against a disposable PostgreSQL database.
 *
 * The real report, conversion and settings actions, the receipt upload route
 * and the submission owner run; only the session, notifications and object
 * storage are replaced.
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t607-org",
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
	S3_PUBLIC_BUCKET: "t607-public",
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
		return { bucket: "t607-private", versionId: `v-${key.length}` };
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
const conversions = await import("@/app/[locale]/(app)/travel-expenses/conversion-actions");
const settings = await import("@/app/[locale]/(app)/settings/travel-expenses/conversion-actions");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e6070000-0000-4000-8000-000000000001",
	manager: "e6070000-0000-4000-8000-000000000002",
	admin: "e6070000-0000-4000-8000-000000000003",
	foreigner: "e6070000-0000-4000-8000-000000000004",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t607-org', 't607-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't607-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t607-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t607-org','Expenses','t607-org','Europe/Berlin',now()),
		 ('t607-foreign','Foreign','t607-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t607-org", "employee", "member"],
		["manager", "t607-org", "manager", "member"],
		["admin", "t607-org", "admin", "admin"],
		["foreigner", "t607-foreign", "admin", "admin"],
	];
	for (const [name, organizationId, role, memberRole] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t607-${name}`, `${name[0]?.toUpperCase()}${name.slice(1)}`, `t607-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t607-member-${name}`, organizationId, `t607-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t607-${name}`, organizationId, role],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't607-manager', now(), now())`,
		[ids.requester, ids.manager],
	);
}

function signIn(name: Person) {
	harness.userId = `t607-${name}`;
	harness.organizationId = name === "foreigner" ? "t607-foreign" : "t607-org";
}

async function load(reportId: string) {
	signIn("requester");
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function item(reportId: string, index = 0) {
	const found = (await load(reportId)).items[index];
	if (!found) throw new Error("item missing");
	return found;
}

async function upload(reportId: string, itemId: string, fileName: string) {
	signIn("requester");
	const tusFileKey = createOwnedTusFileKey("t607-requester");
	harness.tus.set(tusFileKey, pdfBytes);
	const response = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId, fileName }),
		}) as unknown as NextRequest,
	);
	expect(response.status).toBe(200);
	const uploaded = (await item(reportId)).receipts.find((receipt) => receipt.fileName === fileName);
	if (!uploaded) throw new Error("upload missing");
	return uploaded.id;
}

/** A standalone USD taxi receipt with its receipt and the card statement attached. */
async function foreignReceipt(values: Record<string, string> = {}) {
	signIn("requester");
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	const current = await item(reportId);
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: current.id,
		expectedVersion: current.version,
		values: {
			expenseDate: "2026-09-14",
			category: "transport",
			description: "Taxi to the customer in New York",
			amount: "100.00",
			currency: "USD",
			paidBy: "employee",
			accountingReference: null,
			...values,
		},
	});
	if (!saved.success || saved.data.status !== "saved") throw new Error("save failed");
	const receiptId = await upload(reportId, current.id, "taxi.pdf");
	const statementId = await upload(reportId, current.id, "card-statement.pdf");
	return { reportId, itemId: current.id, receiptId, statementId };
}

async function reviewed(reportId: string) {
	const report = await load(reportId);
	return {
		detailsVersion: null,
		items: report.items.map((entry) => ({
			id: entry.id,
			version: entry.version,
			receiptIds: entry.receipts.map((receipt) => receipt.id),
		})),
	};
}

async function submit(reportId: string, versions?: Awaited<ReturnType<typeof reviewed>>) {
	const reviewedVersions = versions ?? (await reviewed(reportId));
	signIn("requester");
	return actions.submitTravelExpenseReportAction({ reportId, reviewed: reviewedVersions });
}

async function frozenFacts(reportId: string) {
	const { rows } = await admin.query(
		"select facts, material_fingerprint from approval_submitted_revision where source_type = 'travel_expense_report' and source_id = $1",
		[reportId],
	);
	expect(rows).toHaveLength(1);
	return rows[0];
}

async function recordCardCharge(
	target: { reportId: string; itemId: string },
	chargedAmount: string,
	evidenceReceiptId: string,
) {
	signIn("requester");
	const current = await item(target.reportId);
	return conversions.saveCardChargeConversionAction({
		...target,
		expectedVersion: current.version,
		chargedAmount,
		evidenceReceiptId,
	});
}

async function authorizeRate(
	who: Person,
	target: { reportId: string; itemId: string },
	rate: { base: string; quote: string; rate: string },
	expectedVersion?: number,
) {
	const version = expectedVersion ?? (await item(target.reportId)).version;
	signIn(who);
	return settings.authorizeManualConversionRateAction({
		...target,
		expectedVersion: version,
		rate: {
			...rate,
			rateDate: "2026-09-13",
			reason: "Rate of the bank statement of the travel card",
		},
	});
}

describe("foreign-currency conversion (#607)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
	});
	afterAll(cleanup);

	it("keeps a foreign receipt in draft until a conversion exists; nothing is guessed", async () => {
		const target = await foreignReceipt();
		expect(await submit(target.reportId)).toEqual({
			success: true,
			data: {
				status: "incomplete",
				missing: { trip: [], items: [{ id: target.itemId, missing: ["conversion_missing"] }] },
			},
		});
	});

	it("freezes an evidenced card charge with the original money, its evidence and the totals", async () => {
		const target = await foreignReceipt();
		const before = await item(target.reportId);

		const saved = await recordCardCharge(target, "92.17", target.statementId);
		expect(saved).toMatchObject({ success: true, data: { kind: "saved" } });
		const after = await item(target.reportId);
		// The conversion is part of what the employee reviews before submitting.
		expect(after.version).toBe(before.version + 1);
		expect(after.conversion).toEqual({
			basis: "card_charge",
			sourceCurrency: "USD",
			targetCurrency: "EUR",
			chargedAmount: "92.17",
			evidenceReceiptId: target.statementId,
		});
		expect(await submit(target.reportId, await reviewed(target.reportId))).toEqual({
			success: true,
			data: { status: "submitted" },
		});

		const revision = await frozenFacts(target.reportId);
		expect(revision.material_fingerprint).toMatch(
			/^travel_expense_report:v([3-9]|\d{2,}):[0-9a-f]{64}$/,
		);
		const [frozen] = revision.facts.items;
		expect(frozen.original).toEqual({ amount: "100.00", currency: "USD" });
		expect(frozen.conversion).toEqual({
			basis: "card_charge",
			evidenceReceiptId: target.statementId,
			reimbursement: { amount: "92.17", currency: "EUR" },
		});
		// The evidence is in the frozen receipt manifest, so reviewers can open it.
		expect(frozen.receipts.map((receipt: { receiptId: string }) => receipt.receiptId)).toContain(
			target.statementId,
		);
		expect(revision.facts.totals).toEqual({
			currency: "EUR",
			reimbursable: "92.17",
			companyPaid: "0.00",
		});
	});

	it("refuses a card charge evidenced by another expense's, report's or organization's file", async () => {
		const target = await foreignReceipt();
		const other = await foreignReceipt();
		signIn("foreigner");
		const foreign = await actions.createStandaloneReceiptReportAction();
		if (!foreign.success) throw new Error(foreign.error);

		for (const evidenceReceiptId of [other.statementId, crypto.randomUUID()]) {
			expect(await recordCardCharge(target, "92.17", evidenceReceiptId)).toEqual({
				success: true,
				data: { kind: "invalid", errors: { evidenceReceiptId: "invalid" } },
			});
		}
		// Another organization's report is never found from this session.
		signIn("requester");
		expect(
			await conversions.saveCardChargeConversionAction({
				reportId: foreign.data.reportId,
				itemId: target.itemId,
				expectedVersion: 1,
				chargedAmount: "92.17",
				evidenceReceiptId: target.statementId,
			}),
		).toEqual({ success: true, data: { kind: "not_found" } });
		expect(await recordCardCharge(target, "92.171", target.statementId)).toEqual({
			success: true,
			data: { kind: "invalid", errors: { chargedAmount: "invalid" } },
		});
		expect((await item(target.reportId)).conversion).toBeNull();
	});

	it("asks for the evidence again once the evidencing file is removed", async () => {
		const target = await foreignReceipt();
		await recordCardCharge(target, "92.17", target.statementId);
		signIn("requester");
		const removed = await actions.removeReportReceiptAction({
			reportId: target.reportId,
			itemId: target.itemId,
			receiptId: target.statementId,
		});
		expect(removed.success).toBe(true);
		expect((await item(target.reportId)).conversion).toMatchObject({ evidenceReceiptId: null });
		expect(await submit(target.reportId)).toMatchObject({
			data: {
				status: "incomplete",
				missing: { items: [{ id: target.itemId, missing: ["conversion_evidence"] }] },
			},
		});
	});

	it("lets only an expense administrator of the organization authorize a documented rate", async () => {
		const target = await foreignReceipt();

		for (const who of ["requester", "manager"] as const) {
			expect(
				await authorizeRate(who, target, { base: "EUR", quote: "USD", rate: "1.085" }),
			).toEqual({ success: false, error: "Unauthorized: Admin access required" });
		}
		// An administrator of another organization never finds the report.
		expect(
			await authorizeRate("foreigner", target, { base: "EUR", quote: "USD", rate: "1.085" }),
		).toEqual({ success: true, data: { kind: "not_found" } });
		expect((await item(target.reportId)).conversion).toBeNull();

		signIn("admin");
		const listed = await settings.getForeignDraftExpenses();
		expect(listed).toMatchObject({
			success: true,
			data: [
				{
					reportId: target.reportId,
					itemId: target.itemId,
					employeeName: "Requester",
					amount: "100.00",
					currency: "USD",
					reimbursementCurrency: "EUR",
					conversion: null,
				},
			],
		});
		const stale = (await item(target.reportId)).version - 1;
		expect(
			await authorizeRate("admin", target, { base: "EUR", quote: "USD", rate: "1.085" }, stale),
		).toMatchObject({ success: true, data: { kind: "conflict" } });
		expect(
			await authorizeRate("admin", target, { base: "GBP", quote: "USD", rate: "1.3" }),
		).toEqual({ success: true, data: { kind: "invalid", errors: { pair: "invalid_pair" } } });

		const reviewedBefore = await reviewed(target.reportId);
		expect(
			await authorizeRate("admin", target, { base: "EUR", quote: "USD", rate: "1.0850" }),
		).toMatchObject({ success: true, data: { kind: "saved" } });
		// The employee's earlier review no longer covers the authorized conversion.
		expect(await submit(target.reportId, reviewedBefore)).toEqual({
			success: true,
			data: { status: "changed_since_review" },
		});
		// The employee can neither remove nor silently keep using an outdated view of it.
		signIn("requester");
		expect(
			await conversions.removeCardChargeConversionAction({
				reportId: target.reportId,
				itemId: target.itemId,
				expectedVersion: (await item(target.reportId)).version,
			}),
		).toEqual({ success: true, data: { kind: "not_allowed" } });

		expect(await submit(target.reportId)).toEqual({ success: true, data: { status: "submitted" } });
		const [frozen] = (await frozenFacts(target.reportId)).facts.items;
		// 100.00 / 1.085 = 92.1658… → 92.17, rounded once, half up.
		expect(frozen.conversion).toMatchObject({
			basis: "manual_rate",
			rate: { base: "EUR", quote: "USD", value: "1.085" },
			rateDate: "2026-09-13",
			reason: "Rate of the bank statement of the travel card",
			authorizedBy: { employeeId: ids.admin, name: "Admin" },
			rounding: { mode: "half_up", minorUnitDigits: 2 },
			reimbursement: { amount: "92.17", currency: "EUR" },
		});

		// A submitted report's conversion is frozen.
		expect(
			await authorizeRate("admin", target, { base: "EUR", quote: "USD", rate: "1.2" }),
		).toEqual({ success: true, data: { kind: "not_draft" } });
	});

	it("drops a conversion recorded for another currency once the receipt currency changes", async () => {
		const target = await foreignReceipt();
		await recordCardCharge(target, "92.17", target.statementId);
		signIn("requester");
		const current = await item(target.reportId);
		const saved = await actions.saveReceiptItemDraftAction({
			reportId: target.reportId,
			itemId: target.itemId,
			expectedVersion: current.version,
			values: {
				expenseDate: "2026-09-14",
				category: "transport",
				description: "Taxi in London",
				amount: "80.00",
				currency: "GBP",
				paidBy: "employee",
				accountingReference: null,
			},
		});
		expect(saved).toMatchObject({ success: true, data: { status: "saved" } });
		expect(await submit(target.reportId)).toMatchObject({
			data: {
				status: "incomplete",
				missing: { items: [{ id: target.itemId, missing: ["conversion_missing"] }] },
			},
		});
	});

	it("uses the organization's reimbursement currency for new reports only", async () => {
		const existing = await foreignReceipt({ currency: "EUR" });

		signIn("requester");
		expect(await settings.saveReimbursementCurrencySetting({ currency: "CHF" })).toEqual({
			success: false,
			error: "Unauthorized: Admin access required",
		});
		signIn("admin");
		expect(await settings.saveReimbursementCurrencySetting({ currency: "KWD" })).toMatchObject({
			success: false,
		});
		expect(await settings.saveReimbursementCurrencySetting({ currency: "chf" })).toEqual({
			success: true,
			data: { currency: "CHF" },
		});
		expect(await settings.getReimbursementCurrencySetting()).toEqual({
			success: true,
			data: { currency: "CHF" },
		});

		signIn("requester");
		const created = await actions.createTripReportAction();
		if (!created.success) throw new Error(created.error);
		const added = await actions.addTripReportItemAction({ reportId: created.data.reportId });
		if (!added.success) throw new Error(added.error);
		const trip = await load(created.data.reportId);
		expect(trip.reimbursementCurrency).toBe("CHF");
		expect(trip.items[0]?.currency).toBe("CHF");
		expect((await load(existing.reportId)).reimbursementCurrency).toBe("EUR");
		// The other organization keeps the default.
		signIn("foreigner");
		expect(await settings.getReimbursementCurrencySetting()).toEqual({
			success: true,
			data: { currency: "EUR" },
		});
	});
});
