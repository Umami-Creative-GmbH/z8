/**
 * #608: organization-approved ECB reference rates with an explicit
 * previous-publication fallback, against a disposable PostgreSQL database.
 *
 * The real report, settings and conversion actions, the reference-rate fetch
 * (with an injected fetcher serving verbatim ECB fixture days, never the
 * network), the submission owner and the Approvals inbox routes run. Only
 * the session, notifications and object storage are replaced.
 */

import type { NextRequest } from "next/server";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import { ECB_HISTORY_DAYS, ecbDays, ecbFeedXml } from "./__tests__/ecb-reference-rates-fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t608-org",
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
	S3_PUBLIC_BUCKET: "t608-public",
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
		return { bucket: "t608-private", versionId: `v-${key.length}` };
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

const { db } = await import("@/db");
const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const conversions = await import("@/app/[locale]/(app)/travel-expenses/conversion-actions");
const settings = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/reference-rate-actions"
);
const conversionSettings = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/conversion-actions"
);
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { refreshReferenceRates } = await import("./reference-rate-store");
const { ECB_REFERENCE_RATES } = await import("./reference-rate");
const { referenceRateReviewKey } = await import("./reference-rate-conversion");

const ids = {
	requester: "e6080000-0000-4000-8000-000000000001",
	manager: "e6080000-0000-4000-8000-000000000002",
	admin: "e6080000-0000-4000-8000-000000000003",
	foreigner: "e6080000-0000-4000-8000-000000000004",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanupRates() {
	await admin.query("delete from travel_expense_reference_rate_publication where provider = 'ecb'");
	await admin.query(
		"delete from travel_expense_reference_rate_provider_state where provider = 'ecb'",
	);
}

async function cleanup() {
	await admin.query("delete from organization where id in ('t608-org', 't608-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't608-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t608-%"]);
	await cleanupRates();
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t608-org','Expenses','t608-org','Europe/Berlin',now()),
		 ('t608-foreign','Foreign','t608-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t608-org", "employee", "member"],
		["manager", "t608-org", "manager", "member"],
		["admin", "t608-org", "admin", "admin"],
		["foreigner", "t608-foreign", "admin", "admin"],
	];
	for (const [name, organizationId, role, memberRole] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t608-${name}`, `${name[0]?.toUpperCase()}${name.slice(1)}`, `t608-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t608-member-${name}`, organizationId, `t608-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t608-${name}`, organizationId, role],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't608-manager', now(), now())`,
		[ids.requester, ids.manager],
	);
}

function signIn(name: Person) {
	harness.userId = `t608-${name}`;
	harness.organizationId = name === "foreigner" ? "t608-foreign" : "t608-org";
}

/** Serves ECB documents by URL, like the network would; never reaches it. */
function fetcher(documents: Record<string, string | Error>) {
	const requested: string[] = [];
	return {
		requested,
		fetchText: async (url: string) => {
			requested.push(url);
			const document = documents[url];
			if (document === undefined) throw new Error(`unexpected fetch of ${url}`);
			if (document instanceof Error) throw document;
			return document;
		},
	};
}

const correctedEaster = ecbFeedXml(ecbDays("2026-03-30", "2026-04-08")).replace(
	'<Cube time="2026-04-02"><Cube currency="USD" rate="1.1525"/>',
	'<Cube time="2026-04-02"><Cube currency="USD" rate="1.1530"/>',
);

/** Fetches the full fixture history once, as the first run of the job does. */
async function backfill() {
	const { fetchText } = fetcher({
		[ECB_REFERENCE_RATES.fullHistoryUrl]: ecbFeedXml(ECB_HISTORY_DAYS),
	});
	const result = await refreshReferenceRates(db, { fetchText });
	expect(result).toMatchObject({ ok: true, feed: "full" });
}

async function approveSource(who: Person = "admin") {
	signIn(who);
	return settings.approveReferenceRateSource({ provider: "ecb", acknowledged: true });
}

async function load(reportId: string) {
	signIn("requester");
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function item(reportId: string) {
	const found = (await load(reportId)).items[0];
	if (!found) throw new Error("item missing");
	return found;
}

async function upload(reportId: string, itemId: string, fileName: string) {
	signIn("requester");
	const tusFileKey = createOwnedTusFileKey("t608-requester");
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

/** A standalone foreign taxi receipt with its receipt attached. */
async function foreignReceipt(values: { expenseDate: string; currency?: string; amount?: string }) {
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
			category: "transport",
			description: "Taxi to the customer",
			amount: values.amount ?? "100.00",
			currency: values.currency ?? "USD",
			paidBy: "employee",
			accountingReference: null,
			expenseDate: values.expenseDate,
		},
	});
	if (!saved.success || saved.data.status !== "saved") throw new Error("save failed");
	const receiptId = await upload(reportId, current.id, "taxi.pdf");
	return { reportId, itemId: current.id, receiptId };
}

async function reviewed(reportId: string) {
	const report = await load(reportId);
	return {
		detailsVersion: null,
		items: report.items.map((entry) => ({
			id: entry.id,
			version: entry.version,
			receiptIds: entry.receipts.map((receipt) => receipt.id),
			referenceRate: referenceRateReviewKey(entry.conversion),
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

async function pendingRequestId(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		`select id from approval_request where entity_type = 'travel_expense_report'
		 and entity_id = $1 and status = 'pending'`,
		[reportId],
	);
	if (!rows[0]) throw new Error("no pending request");
	return rows[0].id;
}

function approve(requestId: string) {
	signIn("manager");
	return approveRoute(
		new Request(`http://localhost/api/approvals/inbox/${requestId}/approve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: requestId }) },
	);
}

const today = Temporal.Now.plainDateISO("Europe/Berlin");

describe("approved reference rates (#608)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
	});
	afterAll(cleanup);

	it("backfills the history once, then records corrections as new versions and survives outages", async () => {
		await backfill();
		const { rows: first } = await admin.query(
			"select count(*)::int as n, min(publication_date)::text as earliest from travel_expense_reference_rate_publication",
		);
		expect(first[0]).toEqual({ n: ECB_HISTORY_DAYS.length, earliest: "2022-02-25" });

		const corrected = fetcher({ [ECB_REFERENCE_RATES.recentFeedUrl]: correctedEaster });
		expect(await refreshReferenceRates(db, { fetchText: corrected.fetchText })).toEqual({
			ok: true,
			feed: "recent",
			inserted: 0,
			corrected: 1,
			unchanged: 5,
		});
		const { rows: versions } = await admin.query(
			`select version, rates->>'USD' as usd, superseded_at is not null as superseded
			 from travel_expense_reference_rate_publication
			 where publication_date = '2026-04-02' order by version`,
		);
		expect(versions).toEqual([
			{ version: 1, usd: "1.1525", superseded: true },
			{ version: 2, usd: "1.153", superseded: false },
		]);

		const outage = fetcher({
			[ECB_REFERENCE_RATES.recentFeedUrl]: new Error("getaddrinfo ENOTFOUND www.ecb.europa.eu"),
		});
		expect(await refreshReferenceRates(db, { fetchText: outage.fetchText })).toMatchObject({
			ok: false,
			feed: "recent",
		});
		const broken = fetcher({ [ECB_REFERENCE_RATES.recentFeedUrl]: "<html>maintenance</html>" });
		expect(await refreshReferenceRates(db, { fetchText: broken.fetchText })).toMatchObject({
			ok: false,
		});
		const { rows: state } = await admin.query(
			`select history_from::text, latest_failure is not null as failed,
			 latest_success_at < latest_failure_at as failed_after_success
			 from travel_expense_reference_rate_provider_state where provider = 'ecb'`,
		);
		expect(state[0]).toEqual({
			history_from: "2022-02-25",
			failed: true,
			failed_after_success: true,
		});
		const { rows: kept } = await admin.query(
			"select count(*)::int as n from travel_expense_reference_rate_publication",
		);
		expect(kept[0]?.n).toBe(ECB_HISTORY_DAYS.length + 1);
	});

	it("converts drafts only after an expense administrator explicitly approves the source", async () => {
		await backfill();
		const target = await foreignReceipt({ expenseDate: "2026-04-07" });
		expect(await item(target.reportId)).toMatchObject({ conversion: null, referenceRate: null });

		for (const who of ["requester", "manager"] as const) {
			expect(await approveSource(who)).toEqual({
				success: false,
				error: "Unauthorized: Admin access required",
			});
		}
		signIn("admin");
		expect(
			await settings.approveReferenceRateSource({ provider: "ecb", acknowledged: false }),
		).toMatchObject({ success: false });
		expect(
			await admin.query(
				"select count(*)::int as n from travel_expense_reference_rate_policy where organization_id = 't608-org'",
			),
		).toMatchObject({ rows: [{ n: 0 }] });
		const approved = await approveSource();
		expect(approved).toMatchObject({
			success: true,
			data: {
				policy: {
					provider: "ecb",
					approvedByName: "Admin",
					acknowledgement: "ecb_information_only_v1",
				},
			},
		});
		// Who acknowledged which statement for which source, and when, is kept with the approval.
		const { rows: acknowledged } = await admin.query(
			`select provider, approved_by, acknowledgement, acknowledged_at = approved_at as same_instant
			 from travel_expense_reference_rate_policy where organization_id = 't608-org'`,
		);
		expect(acknowledged).toEqual([
			{
				provider: "ecb",
				approved_by: "t608-admin",
				acknowledgement: "ecb_information_only_v1",
				same_instant: true,
			},
		]);
		if (!approved.success) throw new Error(approved.error);
		expect(approved.data.policy.acknowledgedAt).toBe(approved.data.policy.approvedAt);
		expect(await settings.getReferenceRateSettings()).toMatchObject({
			success: true,
			data: {
				policy: { provider: "ecb" },
				provider: { historyFrom: "2022-02-25", latestPublicationDate: "2026-04-08" },
			},
		});

		expect(await item(target.reportId)).toMatchObject({
			conversion: {
				basis: "reference_rate",
				rate: { base: "EUR", quote: "USD", value: "1.1557" },
				rateDate: "2026-04-07",
				expenseDate: "2026-04-07",
			},
			referenceRate: { status: "applied", rateDate: "2026-04-07", fallback: false },
		});
		// Administrators see it as converted, not as waiting for a documented rate.
		signIn("admin");
		expect(await conversionSettings.getForeignDraftExpenses()).toMatchObject({
			success: true,
			data: [{ itemId: target.itemId, conversion: { basis: "reference_rate" } }],
		});
		// Another organization did not approve anything.
		signIn("foreigner");
		expect(await settings.getReferenceRateSettings()).toMatchObject({
			success: true,
			data: { policy: null },
		});

		signIn("admin");
		expect(await settings.revokeReferenceRateSource()).toEqual({
			success: true,
			data: { policy: null },
		});
		expect(await item(target.reportId)).toMatchObject({ conversion: null, referenceRate: null });
	});

	it("uses the last publication before Easter, shows its real date and freezes it at submission", async () => {
		await backfill();
		await approveSource();
		const target = await foreignReceipt({ expenseDate: "2026-04-05" });

		expect(await item(target.reportId)).toMatchObject({
			conversion: {
				basis: "reference_rate",
				rate: { base: "EUR", quote: "USD", value: "1.1525" },
				rateDate: "2026-04-02",
				expenseDate: "2026-04-05",
				source: { provider: "ecb", publicationVersion: 1 },
			},
			referenceRate: { status: "applied", rateDate: "2026-04-02", fallback: true },
		});
		expect(await submit(target.reportId)).toEqual({ success: true, data: { status: "submitted" } });

		const revision = await frozenFacts(target.reportId);
		// Frozen at the current facts version (v9 since #610 allowance overrides).
		expect(revision.material_fingerprint).toMatch(/^travel_expense_report:v11:[0-9a-f]{64}$/);
		const [frozen] = revision.facts.items;
		expect(frozen.original).toEqual({ amount: "100.00", currency: "USD" });
		// 100.00 / 1.1525 = 86.7678… → 86.77, rounded once, half up.
		expect(frozen.conversion).toMatchObject({
			basis: "reference_rate",
			rate: { base: "EUR", quote: "USD", value: "1.1525" },
			rateDate: "2026-04-02",
			expenseDate: "2026-04-05",
			source: { provider: "ecb", publicationVersion: 1 },
			rounding: { mode: "half_up", minorUnitDigits: 2 },
			reimbursement: { amount: "86.77", currency: "EUR" },
		});
		expect(frozen.conversion.source.retrievedAt).toMatch(/Z$/);
		expect(revision.facts.totals).toMatchObject({ reimbursable: "86.77" });

		// ECB corrects the publication after submission: the frozen conversion stays.
		const corrected = fetcher({ [ECB_REFERENCE_RATES.recentFeedUrl]: correctedEaster });
		expect(await refreshReferenceRates(db, { fetchText: corrected.fetchText })).toMatchObject({
			corrected: 1,
		});
		expect((await frozenFacts(target.reportId)).facts).toEqual(revision.facts);
		// The reviewer decides on the frozen facts; the correction is no material change.
		const response = await approve(await pendingRequestId(target.reportId));
		expect(response.status).toBe(200);

		// A new draft for the same day uses the corrected version.
		const later = await foreignReceipt({ expenseDate: "2026-04-05" });
		expect((await item(later.reportId)).conversion).toMatchObject({
			rate: { value: "1.153" },
			source: { publicationVersion: 2 },
		});
	});

	it("refuses a submission reviewed before the publication was corrected", async () => {
		await backfill();
		await approveSource();
		const target = await foreignReceipt({ expenseDate: "2026-04-02" });
		const before = await reviewed(target.reportId);

		const corrected = fetcher({ [ECB_REFERENCE_RATES.recentFeedUrl]: correctedEaster });
		await refreshReferenceRates(db, { fetchText: corrected.fetchText });
		expect(await submit(target.reportId, before)).toEqual({
			success: true,
			data: { status: "changed_since_review" },
		});
		expect(await submit(target.reportId)).toEqual({ success: true, data: { status: "submitted" } });
		const [frozen] = (await frozenFacts(target.reportId)).facts.items;
		// 100.00 / 1.1530 = 86.7302… → 86.73
		expect(frozen.conversion).toMatchObject({
			rate: { value: "1.153" },
			reimbursement: { amount: "86.73", currency: "EUR" },
		});
	});

	it("keeps the draft with guidance when the currency, history or provider is unavailable", async () => {
		await backfill();
		await approveSource();
		// The rouble was suspended from 2022-03-02; 2022-03-01 still had it.
		const rouble = await foreignReceipt({ expenseDate: "2022-03-02", currency: "RUB" });
		expect(await item(rouble.reportId)).toMatchObject({
			conversion: null,
			referenceRate: { status: "unavailable", reason: "currency_unavailable" },
		});
		expect(await submit(rouble.reportId)).toMatchObject({
			data: {
				status: "incomplete",
				missing: { items: [{ id: rouble.itemId, missing: ["conversion_missing"] }] },
			},
		});
		// An evidenced actual charge remains a separate, supported basis.
		signIn("requester");
		const current = await item(rouble.reportId);
		expect(
			await conversions.saveCardChargeConversionAction({
				reportId: rouble.reportId,
				itemId: rouble.itemId,
				expectedVersion: current.version,
				chargedAmount: "0.86",
				evidenceReceiptId: rouble.receiptId,
			}),
		).toMatchObject({ success: true, data: { kind: "saved" } });
		expect(await submit(rouble.reportId)).toEqual({ success: true, data: { status: "submitted" } });
		expect((await frozenFacts(rouble.reportId)).facts.items[0].conversion).toMatchObject({
			basis: "card_charge",
		});

		// A pre-publication request: tomorrow's rate cannot be published yet.
		const tomorrow = await foreignReceipt({ expenseDate: today.add({ days: 1 }).toString() });
		expect((await item(tomorrow.reportId)).referenceRate).toEqual({
			status: "unavailable",
			reason: "not_yet_published",
		});
		// The last successful fetch was before yesterday's publication: a provider outage.
		await admin.query(
			"update travel_expense_reference_rate_provider_state set latest_success_at = '2026-04-08T18:00:00Z'",
		);
		const yesterday = await foreignReceipt({ expenseDate: today.subtract({ days: 1 }).toString() });
		expect((await item(yesterday.reportId)).referenceRate).toEqual({
			status: "unavailable",
			reason: "provider_unavailable",
		});
		// Before the stored history nothing is assumed.
		const early = await foreignReceipt({ expenseDate: "2022-02-24" });
		expect((await item(early.reportId)).referenceRate).toEqual({
			status: "unavailable",
			reason: "history_unavailable",
		});
	});

	it("lets an evidenced card charge take precedence over the reference rate", async () => {
		await backfill();
		await approveSource();
		const target = await foreignReceipt({ expenseDate: "2026-04-07" });
		signIn("requester");
		const current = await item(target.reportId);
		await conversions.saveCardChargeConversionAction({
			reportId: target.reportId,
			itemId: target.itemId,
			expectedVersion: current.version,
			chargedAmount: "87.10",
			evidenceReceiptId: target.receiptId,
		});
		expect(await item(target.reportId)).toMatchObject({
			conversion: { basis: "card_charge", chargedAmount: "87.10" },
			referenceRate: null,
		});
		// Removing the card charge falls back to the approved reference rate.
		const withCharge = await item(target.reportId);
		expect(
			await conversions.removeCardChargeConversionAction({
				reportId: target.reportId,
				itemId: target.itemId,
				expectedVersion: withCharge.version,
			}),
		).toMatchObject({ success: true, data: { kind: "removed" } });
		expect((await item(target.reportId)).conversion).toMatchObject({ basis: "reference_rate" });
	});
});
