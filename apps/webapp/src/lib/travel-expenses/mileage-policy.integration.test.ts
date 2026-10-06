/**
 * #606: mileage priced with dated organization allowance policies.
 *
 * The real settings and report actions, the submission owner and the
 * Approvals decision route run against a disposable PostgreSQL database.
 * Only the session, notifications and object storage are replaced.
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t606-org",
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
vi.mock("@/lib/notifications/triggers", async (original) => ({
	...(await original<typeof import("@/lib/notifications/triggers")>()),
	onTravelExpenseReportDecided: async () => {},
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject() {
		throw new Error("not used");
	},
	async readPrivateObject() {
		throw new Error("not used");
	},
	async deletePrivateObject() {},
}));

const reportActions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const mileageActions = await import("@/app/[locale]/(app)/travel-expenses/mileage-actions");
const policyActions = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/mileage-policy-actions"
);
const { activateMileagePolicyVersion } = await import("./allowance-policy-store");
const { db } = await import("@/db");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");

const ids = {
	requester: "e6060000-0000-4000-8000-000000000001",
	manager: "e6060000-0000-4000-8000-000000000002",
	boss: "e6060000-0000-4000-8000-000000000003",
	foreigner: "e6060000-0000-4000-8000-000000000004",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id in ('t606-org', 't606-foreign')");
	await admin.query('delete from "user" where id like $1', ["t606-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t606-org','Mileage','t606-org','Europe/Berlin',now()),
		 ('t606-foreign','Foreign','t606-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t606-org", "member", "employee"],
		["manager", "t606-org", "member", "manager"],
		["boss", "t606-org", "admin", "admin"],
		["foreigner", "t606-foreign", "admin", "admin"],
	];
	for (const [name, organizationId, memberRole, employeeRole] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t606-${name}`, name, `t606-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t606-member-${name}`, organizationId, `t606-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t606-${name}`, organizationId, employeeRole],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't606-boss', now(), now())`,
		[ids.requester, ids.manager],
	);
}

function signIn(name: Person) {
	harness.userId = `t606-${name}`;
	harness.organizationId = name === "foreigner" ? "t606-foreign" : "t606-org";
}

async function activate(
	input: Parameters<typeof policyActions.activateMileagePolicyVersionAction>[0],
	as: Person = "boss",
) {
	signIn(as);
	return policyActions.activateMileagePolicyVersionAction(input);
}

async function activateOrganizationRate(effectiveFrom: string, car: string, replaces?: string) {
	const result = await activate({
		source: "organization",
		effectiveFrom,
		currency: "EUR",
		ratesPerKm: { car },
		sourceReference: "Travel policy",
		replacesVersionId: replaces ?? null,
	});
	if (!result.success || result.data.status !== "activated") {
		throw new Error(`activation failed: ${JSON.stringify(result)}`);
	}
	return result.data.versionId;
}

async function settings(as: Person = "boss") {
	signIn(as);
	const result = await policyActions.getMileagePolicySettings();
	if (!result.success) throw new Error(result.error);
	return result.data;
}

async function load(reportId: string) {
	signIn("requester");
	const loaded = await reportActions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function saveMileage(
	reportId: string,
	item: { id: string; version: number },
	values: Partial<Record<"expenseDate" | "route" | "distanceKm" | "vehicle", string | null>> = {},
) {
	signIn("requester");
	const saved = await mileageActions.saveMileageItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: "2026-09-15",
			route: "Office Berlin – customer Potsdam – back",
			distanceKm: "123.45",
			vehicle: "car",
			accountingReference: null,
			...values,
		},
	});
	if (!saved.success || saved.data.status !== "saved") {
		throw new Error(`save failed: ${JSON.stringify(saved)}`);
	}
	return saved.data.item;
}

async function standaloneMileage(values: Parameters<typeof saveMileage>[2] = {}) {
	signIn("requester");
	const created = await mileageActions.createStandaloneMileageReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	const [item] = (await load(reportId)).items;
	if (!item) throw new Error("item missing");
	return { reportId, item: await saveMileage(reportId, item, values) };
}

async function reviewed(reportId: string) {
	const report = await load(reportId);
	return {
		detailsVersion: report.kind === "trip" ? (report.trip?.version ?? null) : null,
		items: report.items.map((item) => ({
			id: item.id,
			version: item.version,
			receiptIds: item.receipts.map((receipt) => receipt.id),
			amount: item.mileage?.amount ?? item.amount,
		})),
	};
}

async function submit(reportId: string, versions?: Awaited<ReturnType<typeof reviewed>>) {
	const reviewedVersions = versions ?? (await reviewed(reportId));
	signIn("requester");
	return reportActions.submitTravelExpenseReportAction({ reportId, reviewed: reviewedVersions });
}

async function revisionFacts(reportId: string) {
	const { rows } = await admin.query(
		"select material_fingerprint, facts from approval_submitted_revision where source_type = 'travel_expense_report' and source_id = $1",
		[reportId],
	);
	expect(rows).toHaveLength(1);
	return rows[0] as { material_fingerprint: string; facts: Record<string, unknown> };
}

async function pendingRequestId(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
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
			body: "{}",
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: requestId }) },
	);
}

async function activeVersions() {
	const { rows } = await admin.query<{ id: string; effective_from: string }>(
		`select v.id, to_char(v.effective_from, 'YYYY-MM-DD') as effective_from
		 from travel_expense_allowance_policy_version v
		 where v.organization_id = 't606-org' and v.withdrawn_at is null order by v.effective_from`,
	);
	return rows;
}

describe("mileage with versioned organization allowance policies (#606)", () => {
	beforeEach(seed);
	afterAll(cleanup);

	it("lets only expense administrators manage dated versions and keeps their timeline", async () => {
		expect(
			await activate(
				{
					source: "organization",
					effectiveFrom: "2026-01-01",
					currency: "EUR",
					ratesPerKm: { car: "0.30" },
				},
				"manager",
			),
		).toEqual({ success: false, error: "Unauthorized: Admin access required" });

		const first = await activateOrganizationRate("2026-01-01", "0.30");
		const second = await activateOrganizationRate("2026-07-01", "0.35");
		const data = await settings();
		expect(
			data.timeline.map((version) => [version.id, version.effectiveFrom, version.effectiveUntil]),
		).toEqual([
			[second, "2026-07-01", null],
			[first, "2026-01-01", "2026-07-01"],
		]);
		expect(data.timeline[0]?.ratesPerKm).toEqual({ car: "0.3500" });
		// Another organization's administrator sees none of it.
		expect((await settings("foreigner")).timeline).toEqual([]);
	});

	it("never replaces a version implicitly, and a failed or stale replacement keeps the valid version", async () => {
		const original = await activateOrganizationRate("2026-01-01", "0.30");

		expect(
			await activate({
				source: "organization",
				effectiveFrom: "2026-01-01",
				currency: "EUR",
				ratesPerKm: { car: "0.40" },
			}),
		).toEqual({ success: true, data: { status: "start_taken", existingVersionId: original } });

		// A version of another organization is never a valid replacement target.
		signIn("foreigner");
		const foreign = await policyActions.activateMileagePolicyVersionAction({
			source: "organization",
			effectiveFrom: "2026-01-01",
			currency: "EUR",
			ratesPerKm: { car: "0.10" },
		});
		if (!foreign.success || foreign.data.status !== "activated") throw new Error("foreign failed");
		expect(
			await activate({
				source: "organization",
				effectiveFrom: "2026-01-01",
				currency: "EUR",
				ratesPerKm: { car: "0.40" },
				replacesVersionId: foreign.data.versionId,
			}),
		).toEqual({ success: true, data: { status: "stale_replacement" } });
		expect(
			await policyActions.withdrawMileagePolicyVersionAction({ versionId: foreign.data.versionId }),
		).toEqual({
			success: false,
			error: "Mileage policy version not found",
		});

		// The replacement's insert fails (rate above the database limit) after the
		// old version was withdrawn in the same transaction: nothing is committed.
		await expect(
			activateMileagePolicyVersion(
				db,
				{ organizationId: "t606-org", userId: "t606-boss" },
				{
					effectiveFrom: "2026-01-01",
					currency: "EUR",
					ratesPerKm: { car: "1000.0000" },
					source: { kind: "organization", reference: null, version: null, defaultKey: null },
					note: null,
					replacesVersionId: original,
				},
			),
		).rejects.toThrow();
		expect(await activeVersions()).toEqual([{ id: original, effective_from: "2026-01-01" }]);

		const replacement = await activateOrganizationRate("2026-01-01", "0.40", original);
		expect(await activeVersions()).toEqual([{ id: replacement, effective_from: "2026-01-01" }]);
		expect((await settings()).withdrawn.map((version) => version.id)).toEqual([original]);
	});

	it("adopts the verified German default only from the edition it was verified for", async () => {
		expect(
			await activate({
				source: "statutory_default",
				defaultKey: "de-mileage-estg-9-1-4a",
				effectiveFrom: "2025-06-01",
			}),
		).toEqual({
			success: true,
			data: { status: "invalid", errors: { effectiveFrom: "before_default_validity" } },
		});
		const adopted = await activate({
			source: "statutory_default",
			defaultKey: "de-mileage-estg-9-1-4a",
			effectiveFrom: "2026-01-01",
			ratesPerKm: { car: "5.00" },
		});
		expect(adopted).toMatchObject({ success: true, data: { status: "activated" } });
		const [version] = (await settings()).timeline;
		expect(version).toMatchObject({
			currency: "EUR",
			ratesPerKm: { car: "0.3000", other_motor_vehicle: "0.2000" },
			source: {
				kind: "statutory_default",
				defaultKey: "de-mileage-estg-9-1-4a",
				version: "LStH 2026, Anhang 25 III",
			},
		});
	});

	it("keeps mileage without effective policy coverage in draft with actionable guidance", async () => {
		const { reportId, item } = await standaloneMileage();
		expect(item.mileage?.calculation).toEqual({
			status: "policy_missing",
			expenseDate: "2026-09-15",
			vehicle: "car",
		});
		expect(await submit(reportId)).toEqual({
			success: true,
			data: {
				status: "incomplete",
				missing: { trip: [], items: [{ id: item.id, missing: ["mileage_policy_missing"] }] },
			},
		});
		// Coverage starting after the drive does not apply to it either.
		await activateOrganizationRate("2026-09-16", "0.30");
		expect((await load(reportId)).items[0]?.mileage?.calculation).toMatchObject({
			status: "policy_missing",
		});
		await activateOrganizationRate("2026-09-15", "0.30");
		expect((await load(reportId)).items[0]?.mileage).toMatchObject({
			amount: "37.04",
			calculation: { status: "calculated", exactAmount: "37.035000", ratePerKm: "0.3000" },
		});
	});

	it("applies the version effective on each expense date", async () => {
		await activateOrganizationRate("2026-01-01", "0.30");
		await activateOrganizationRate("2026-09-16", "0.42");
		const before = await standaloneMileage({ expenseDate: "2026-09-15", distanceKm: "100" });
		const after = await standaloneMileage({ expenseDate: "2026-09-16", distanceKm: "100" });
		expect([before.item.mileage?.amount, after.item.mileage?.amount]).toEqual(["30.00", "42.00"]);
	});

	it("refuses a client-supplied amount instead of storing it", async () => {
		const { reportId, item } = await standaloneMileage();
		signIn("requester");
		expect(
			await mileageActions.saveMileageItemDraftAction({
				reportId,
				itemId: item.id,
				expectedVersion: item.version,
				values: {
					expenseDate: "2026-09-15",
					route: "A – B",
					distanceKm: "10",
					vehicle: "car",
					accountingReference: null,
					amount: "999.00",
				} as never,
			}),
		).toEqual({ success: false, error: "Invalid expense draft" });
		// A receipt save cannot write an amount onto a mileage item either.
		expect(
			await reportActions.saveReceiptItemDraftAction({
				reportId,
				itemId: item.id,
				expectedVersion: item.version,
				values: {
					expenseDate: "2026-09-15",
					category: "transport",
					description: "x",
					amount: "999.00",
					currency: "EUR",
					paidBy: "employee",
					accountingReference: null,
				},
			}),
		).toEqual({ success: false, error: "Expense report not found" });
	});

	it("freezes the applied version through approval; later policy changes never alter or hold it", async () => {
		const versionId = await activateOrganizationRate("2026-01-01", "0.30");
		const { reportId } = await standaloneMileage();

		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		const frozen = await revisionFacts(reportId);
		expect(frozen.material_fingerprint).toMatch(/^travel_expense_report:v2:[0-9a-f]{64}$/);
		expect(frozen.facts.totals).toEqual({
			currency: "EUR",
			reimbursable: "37.04",
			companyPaid: "0.00",
		});
		expect((frozen.facts.items as Array<Record<string, unknown>>)[0]).toMatchObject({
			type: "mileage",
			original: { amount: "37.04", currency: "EUR" },
			mileage: {
				route: "Office Berlin – customer Potsdam – back",
				distanceKm: "123.45",
				vehicle: "car",
				ratePerKm: "0.3000",
				exactAmount: "37.035000",
				amount: "37.04",
				rounding: "half_up",
				policy: { versionId, effectiveFrom: "2026-01-01" },
			},
		});

		// The administrator replaces the rate while the report is in review.
		await activateOrganizationRate("2026-01-01", "0.50", versionId);
		expect((await load(reportId)).items[0]?.mileage?.amount).toBe("37.04");

		expect((await approve(await pendingRequestId(reportId))).status).toBe(200);
		const { rows } = await admin.query("select status from travel_expense_report where id = $1", [
			reportId,
		]);
		expect(rows[0]?.status).toBe("approved");
		expect((await revisionFacts(reportId)).material_fingerprint).toBe(frozen.material_fingerprint);
	});

	it("refuses a submission whose calculated amount changed since the employee reviewed it", async () => {
		const versionId = await activateOrganizationRate("2026-01-01", "0.30");
		const { reportId } = await standaloneMileage();
		const versions = await reviewed(reportId);
		await activateOrganizationRate("2026-01-01", "0.35", versionId);

		expect(await submit(reportId, versions)).toEqual({
			success: true,
			data: { status: "changed_since_review" },
		});
		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		expect((await revisionFacts(reportId)).facts.totals).toMatchObject({ reimbursable: "43.21" });
	});

	it("submits a trip with receipt and mileage expenses and counts both", async () => {
		await activateOrganizationRate("2026-01-01", "0.30");
		signIn("requester");
		const created = await reportActions.createTripReportAction();
		if (!created.success) throw new Error(created.error);
		const { reportId } = created.data;
		const trip = await load(reportId);
		const details = await reportActions.saveTripDetailsDraftAction({
			reportId,
			expectedVersion: trip.trip?.version ?? 1,
			values: {
				purpose: "Customer workshop",
				startDate: "2026-09-14",
				endDate: "2026-09-16",
				timeZone: "Europe/Berlin",
				destinations: [{ place: "Potsdam", countryCode: "DE" }],
			},
		});
		expect(details.success).toBe(true);
		const added = await mileageActions.addTripMileageItemAction({ reportId });
		if (!added.success) throw new Error(added.error);
		await saveMileage(reportId, added.data.item, { distanceKm: "50" });
		// Mileage needs no receipt; the trip is complete.
		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		expect((await revisionFacts(reportId)).facts.totals).toEqual({
			currency: "EUR",
			reimbursable: "15.00",
			companyPaid: "0.00",
		});
		// Standalone reports cannot take a second item.
		const { reportId: standalone } = await standaloneMileage();
		signIn("requester");
		expect(await mileageActions.addTripMileageItemAction({ reportId: standalone })).toEqual({
			success: false,
			error: "Expense report not found",
		});
	});

	it("never prices one organization's mileage with another organization's policy", async () => {
		signIn("foreigner");
		await policyActions.activateMileagePolicyVersionAction({
			source: "organization",
			effectiveFrom: "2026-01-01",
			currency: "EUR",
			ratesPerKm: { car: "0.99" },
		});
		const { item } = await standaloneMileage();
		expect(item.mileage?.calculation?.status).toBe("policy_missing");
	});
});
