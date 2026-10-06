/**
 * #610: exceptional allowance calculations resolved through audited
 * administrator overrides.
 *
 * The real report, mileage, per diem, policy and override actions, the
 * submission owner, the return path and the Approvals decision route run
 * against a disposable PostgreSQL database. Only the session, notifications
 * and object storage are replaced.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t610-org",
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
	onTravelExpenseReportReturned: async () => {},
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
const perDiemActions = await import("@/app/[locale]/(app)/travel-expenses/per-diem-actions");
const reviewActions = await import("@/app/[locale]/(app)/travel-expenses/report-review-actions");
const financeActions = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const adjustmentActions = await import("@/app/[locale]/(app)/travel-expenses/adjustment-actions");
const overrideActions = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/allowance-override-actions"
);
const mileagePolicyActions = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/mileage-policy-actions"
);
const perDiemPolicyActions = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/per-diem-policy-actions"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");

const ids = {
	requester: "e6100000-0000-4000-8000-000000000001",
	manager: "e6100000-0000-4000-8000-000000000002",
	boss: "e6100000-0000-4000-8000-000000000003",
	foreigner: "e6100000-0000-4000-8000-000000000004",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id in ('t610-org', 't610-foreign')");
	await admin.query('delete from "user" where id like $1', ["t610-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t610-org','Overrides','t610-org','Europe/Berlin',now()),
		 ('t610-foreign','Foreign','t610-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t610-org", "member", "employee"],
		["manager", "t610-org", "member", "manager"],
		["boss", "t610-org", "admin", "admin"],
		["foreigner", "t610-foreign", "admin", "admin"],
	];
	for (const [name, organizationId, memberRole, employeeRole] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t610-${name}`, `${name} t610`, `t610-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t610-member-${name}`, organizationId, `t610-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t610-${name}`, organizationId, employeeRole],
		);
	}
	for (const subject of ["requester", "boss"] as const) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't610-boss', now(), now())`,
			[ids[subject], ids.manager],
		);
	}
}

function signIn(name: Person) {
	harness.userId = `t610-${name}`;
	harness.organizationId = name === "foreigner" ? "t610-foreign" : "t610-org";
}

async function load(reportId: string, as: Person = "requester") {
	signIn(as);
	const loaded = await reportActions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

const MILEAGE = {
	expenseDate: "2026-09-15",
	route: "Office Berlin – customer Potsdam – back",
	distanceKm: "61.50",
	vehicle: "car",
	accountingReference: null,
};

async function saveMileage(
	reportId: string,
	item: { id: string; version: number },
	values: Partial<typeof MILEAGE> = {},
	as: Person = "requester",
) {
	signIn(as);
	const saved = await mileageActions.saveMileageItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: { ...MILEAGE, ...values },
	});
	if (!saved.success || saved.data.status !== "saved") {
		throw new Error(`save failed: ${JSON.stringify(saved)}`);
	}
	return saved.data.item;
}

async function standaloneMileage(values: Partial<typeof MILEAGE> = {}, as: Person = "requester") {
	signIn(as);
	const created = await mileageActions.createStandaloneMileageReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	const [item] = (await load(reportId, as)).items;
	if (!item) throw new Error("item missing");
	return { reportId, item: await saveMileage(reportId, item, values, as) };
}

function days(startDate: string, endDate: string): string[] {
	const result: string[] = [];
	for (let day = new Date(`${startDate}T00:00:00Z`); ; day.setUTCDate(day.getUTCDate() + 1)) {
		const date = day.toISOString().slice(0, 10);
		result.push(date);
		if (date === endDate) return result;
	}
}

/**
 * A three-day trip to Paris whose middle day is a situation the daily location
 * answers do not describe (#611 "other"), so the rules flag it as exceptional.
 */
async function parisTrip() {
	signIn("requester");
	const created = await reportActions.createTripReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	const report = await load(reportId);
	const details = await reportActions.saveTripDetailsDraftAction({
		reportId,
		expectedVersion: report.trip?.version ?? 1,
		values: {
			purpose: "Customer workshop",
			startDate: "2026-09-14",
			endDate: "2026-09-16",
			timeZone: "Europe/Berlin",
			destinations: [{ place: "Paris", countryCode: "FR" }],
		},
	});
	if (!details.success) throw new Error(details.error);
	signIn("requester");
	const added = await perDiemActions.addTripPerDiemItemAction({ reportId });
	if (!added.success) throw new Error(added.error);
	signIn("requester");
	const saved = await perDiemActions.savePerDiemDraftAction({
		reportId,
		itemId: added.data.item.id,
		expectedVersion: added.data.item.version,
		values: {
			startDate: "2026-09-14",
			startTime: "07:00",
			startTimeZone: "Europe/Berlin",
			endDate: "2026-09-16",
			endTime: "19:00",
			endTimeZone: "Europe/Berlin",
			overnight: "away",
			prolongedWorkplace: false,
			meals: days("2026-09-14", "2026-09-16").map((date) => ({
				date,
				breakfast: { provided: date !== "2026-09-14", employeePayment: null },
				lunch: { provided: false, employeePayment: null },
				dinner: { provided: false, employeePayment: null },
				...(date === "2026-09-14"
					? { night: { country: "FR", place: "paris" } }
					: date === "2026-09-15"
						? { night: { special: "other" } }
						: { activityAbroad: { country: "FR", place: "paris" } }),
			})),
		},
	});
	if (!saved.success || saved.data.status !== "saved") {
		throw new Error(`save failed: ${JSON.stringify(saved)}`);
	}
	return { reportId, item: saved.data.item };
}

const INCOMPLETE = { success: true, data: { status: "incomplete" } };
const SUBMITTED = { success: true, data: { status: "submitted" } };

const DRAFT = {
	amount: "18.45",
	reason: "No mileage policy is set up yet",
	evidence: "Route planner printout attached to the trip file",
	calculationBasis: "61.50 km × 0.30 EUR",
};

async function authorize(
	reportId: string,
	itemId: string,
	draft: Partial<typeof DRAFT> & { replacesOverrideId?: string | null } = {},
	as: Person = "boss",
) {
	const report = await load(reportId).catch(() => null);
	const version = report?.items.find((item) => item.id === itemId)?.version ?? 1;
	signIn(as);
	return overrideActions.authorizeAllowanceOverrideAction({
		reportId,
		itemId,
		expectedVersion: version,
		...DRAFT,
		...draft,
	});
}

async function reviewed(reportId: string) {
	const report = await load(reportId);
	return {
		detailsVersion: report.kind === "trip" ? (report.trip?.version ?? null) : null,
		items: report.items.map((item) => ({
			id: item.id,
			version: item.version,
			receiptIds: item.receipts.map((receipt) => receipt.id),
			amount: item.perDiem?.amount ?? item.mileage?.amount ?? item.amount,
		})),
	};
}

async function submit(reportId: string) {
	const versions = await reviewed(reportId);
	signIn("requester");
	return reportActions.submitTravelExpenseReportAction({ reportId, reviewed: versions });
}

async function revisions(reportId: string) {
	const { rows } = await admin.query<{ facts: Record<string, unknown>; schema_version: number }>(
		"select facts, schema_version from approval_submitted_revision where source_type = 'travel_expense_report' and source_id = $1 order by created_at",
		[reportId],
	);
	return rows;
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

describe("audited allowance overrides (#610)", () => {
	beforeEach(seed);
	afterAll(cleanup);

	it("refuses ordinary users, managers, foreign administrators and self-authorization", async () => {
		const { reportId, item } = await standaloneMileage();
		for (const person of ["requester", "manager"] as const) {
			expect(await authorize(reportId, item.id, {}, person)).toEqual({
				success: false,
				error: "Unauthorized: Admin access required",
			});
			signIn(person);
			expect(await overrideActions.getAllowanceExceptionItems()).toMatchObject({ success: false });
		}
		expect(await authorize(reportId, item.id, {}, "foreigner")).toMatchObject({
			success: true,
			data: { kind: "not_found" },
		});
		const own = await standaloneMileage({}, "boss");
		signIn("boss");
		expect(
			await overrideActions.authorizeAllowanceOverrideAction({
				reportId: own.reportId,
				itemId: own.item.id,
				expectedVersion: own.item.version,
				...DRAFT,
			}),
		).toEqual({ success: true, data: { kind: "self_authorization" } });
		const { rows } = await admin.query("select id from travel_expense_allowance_override");
		expect(rows).toHaveLength(0);
	});

	it("resolves missing mileage coverage with an evidenced amount the employee and reviewer see", async () => {
		const { reportId, item } = await standaloneMileage();
		// Without a policy the draft stays incomplete with actionable guidance.
		expect(await submit(reportId)).toMatchObject(INCOMPLETE);
		signIn("boss");
		const listed = await overrideActions.getAllowanceExceptionItems();
		expect(listed).toMatchObject({
			success: true,
			data: [
				expect.objectContaining({
					itemId: item.id,
					kind: "mileage",
					distanceKm: "61.50",
					situation: { kind: "missing_coverage", reasons: ["policy_missing"] },
					override: null,
					ownReport: false,
				}),
			],
		});
		// Required fields stay required; an over-precise amount is refused.
		expect(await authorize(reportId, item.id, { evidence: " ", amount: "1.234" })).toEqual({
			success: true,
			data: { kind: "invalid", errors: ["amount", "evidence"] },
		});
		signIn("boss");
		expect(
			await overrideActions.authorizeAllowanceOverrideAction({
				reportId,
				itemId: item.id,
				expectedVersion: item.version - 1,
				...DRAFT,
			}),
		).toEqual({ success: true, data: { kind: "conflict", itemVersion: item.version } });

		const authorized = await authorize(reportId, item.id);
		expect(authorized).toMatchObject({
			success: true,
			data: {
				kind: "authorized",
				itemVersion: item.version + 1,
				override: {
					kind: "mileage",
					amount: "18.45",
					currency: "EUR",
					authorizedBy: { employeeId: ids.boss, name: "boss t610" },
					situation: { kind: "missing_coverage" },
				},
			},
		});
		const view = await load(reportId);
		expect(view.items[0]?.mileage).toMatchObject({
			amount: "18.45",
			currency: "EUR",
			calculation: { status: "policy_missing" },
			override: { applies: true, reason: DRAFT.reason, evidence: DRAFT.evidence },
		});

		expect(await submit(reportId)).toEqual(SUBMITTED);
		const [revision] = await revisions(reportId);
		expect(revision?.schema_version).toBe(10);
		const facts = revision?.facts as {
			items: Array<Record<string, unknown>>;
			totals: Record<string, string>;
		};
		expect(facts.items[0]).toMatchObject({
			type: "mileage",
			original: { amount: "18.45", currency: "EUR" },
			allowanceOverride: {
				amount: "18.45",
				reason: DRAFT.reason,
				evidence: DRAFT.evidence,
				calculationBasis: DRAFT.calculationBasis,
				scope: { kind: "mileage", distanceKm: "61.50", route: MILEAGE.route },
				authorizedBy: { employeeId: ids.boss },
			},
		});
		expect(facts.items[0]?.mileage).toBeUndefined();
		expect(facts.totals.reimbursable).toBe("18.45");

		// The frozen revision cannot be overridden any more.
		expect(await authorize(reportId, item.id, { amount: "99.00" })).toMatchObject({
			success: true,
			data: { kind: "not_draft" },
		});
		// A fresh review of the resolved exception is decided normally.
		const response = await approve(await pendingRequestId(reportId));
		expect(response.status).toBe(200);
		const owner = await load(reportId);
		expect(owner.status).toBe("approved");

		// A later correction (#615) starts from the approved facts, override included.
		signIn("boss");
		const paid = await financeActions.recordTravelExpenseReimbursementAction({
			source: { type: "report", id: reportId },
			idempotencyKey: randomUUID(),
			amount: "18.45",
			occurredOn: "2026-10-01",
			reference: "SEPA-610",
			note: null,
			expectedBalance: { currency: "EUR", amount: "18.45" },
		});
		expect(paid.success && paid.data.status).toBe("recorded");
		signIn("requester");
		const adjustment = await adjustmentActions.createTravelExpenseAdjustmentAction({
			originalReportId: reportId,
			reason: "Route corrected",
			idempotencyKey: randomUUID(),
		});
		if (!adjustment.success || adjustment.data.status !== "created") {
			throw new Error(JSON.stringify(adjustment));
		}
		const copy = await load(adjustment.data.reportId);
		expect(copy.items[0]?.mileage).toMatchObject({
			amount: "18.45",
			override: { applies: true, authorizedBy: { employeeId: ids.boss }, reason: DRAFT.reason },
		});
	});

	it("never fabricates missing facts and refuses a calculable allowance", async () => {
		const { reportId, item } = await standaloneMileage({ distanceKm: "" });
		expect(await authorize(reportId, item.id)).toMatchObject({
			success: true,
			data: { kind: "missing_facts" },
		});
		signIn("boss");
		const adopted = await mileagePolicyActions.activateMileagePolicyVersionAction({
			source: "statutory_default",
			defaultKey: "de-mileage-estg-9-1-4a",
			effectiveFrom: "2026-01-01",
		});
		expect(adopted).toMatchObject({ success: true, data: { status: "activated" } });
		const priced = await standaloneMileage();
		expect(await authorize(priced.reportId, priced.item.id)).toMatchObject({
			success: true,
			data: { kind: "not_exceptional" },
		});
	});

	it("applies only to the facts it was authorized for", async () => {
		const { reportId, item } = await standaloneMileage();
		expect(await authorize(reportId, item.id)).toMatchObject({ data: { kind: "authorized" } });
		const current = (await load(reportId)).items[0];
		if (!current) throw new Error("item missing");
		const changed = await saveMileage(reportId, current, { distanceKm: "70.00" });
		expect(changed.mileage).toMatchObject({ amount: null, override: { applies: false } });
		expect(await submit(reportId)).toMatchObject(INCOMPLETE);
		const back = await saveMileage(reportId, changed, { distanceKm: "61.50" });
		expect(back.mileage).toMatchObject({ amount: "18.45", override: { applies: true } });
		expect(await submit(reportId)).toEqual(SUBMITTED);
	});

	it("keeps overrides immutable: revocation and replacement are new audit facts", async () => {
		const { reportId, item } = await standaloneMileage();
		const first = await authorize(reportId, item.id);
		if (!first.success || first.data.kind !== "authorized") throw new Error("not authorized");
		const firstId = first.data.override.id;

		await expect(
			admin.query("update travel_expense_allowance_override set amount = 1 where id = $1", [
				firstId,
			]),
		).rejects.toThrow(/immutable/);

		// A second override must name the one it replaces.
		expect(await authorize(reportId, item.id, { amount: "20.00" })).toMatchObject({
			data: { kind: "already_overridden", overrideId: firstId },
		});
		const replaced = await authorize(reportId, item.id, {
			amount: "20.00",
			replacesOverrideId: firstId,
		});
		expect(replaced).toMatchObject({ data: { kind: "authorized", override: { amount: "20.00" } } });
		if (!replaced.success || replaced.data.kind !== "authorized") throw new Error("not replaced");

		const version = (await load(reportId)).items[0]?.version ?? 0;
		signIn("boss");
		expect(
			await overrideActions.revokeAllowanceOverrideAction({
				reportId,
				itemId: item.id,
				expectedVersion: version,
				overrideId: replaced.data.override.id,
			}),
		).toEqual({ success: true, data: { kind: "revoked", itemVersion: version + 1 } });
		const { rows } = await admin.query<{ amount: string; revoked: boolean }>(
			"select amount, revoked_at is not null as revoked from travel_expense_allowance_override where item_id = $1 order by authorized_at, amount",
			[item.id],
		);
		expect(rows).toEqual([
			{ amount: "18.45", revoked: true },
			{ amount: "20.00", revoked: true },
		]);
		await expect(
			admin.query("update travel_expense_allowance_override set revoked_at = now() where id = $1", [
				firstId,
			]),
		).rejects.toThrow(/immutable/);
		expect((await load(reportId)).items[0]?.mileage).toMatchObject({ amount: null });
		expect(await submit(reportId)).toMatchObject(INCOMPLETE);
	});

	it("resolves an exceptional international per diem without hiding the exception", async () => {
		signIn("boss");
		await perDiemPolicyActions.activatePerDiemPolicyVersionAction({
			source: "statutory_default",
			effectiveFrom: "2026-01-01",
			defaultKey: "de-per-diem-estg-9-4a-domestic",
		});
		const { reportId, item } = await parisTrip();
		const draft = await load(reportId);
		expect(draft.items[0]?.perDiem?.calculation).toMatchObject({
			status: "exceptional",
			reasons: ["special_location"],
		});
		expect(await submit(reportId)).toMatchObject(INCOMPLETE);

		const authorized = await authorize(reportId, item.id, {
			amount: "112.80",
			reason: "International trip; foreign rates are not supported yet",
			evidence: "BMF Auslandstagegeld 2026, France: Paris",
			calculationBasis: "2 × 39.00 + 58.00 − 2 × 11.60",
		});
		expect(authorized).toMatchObject({
			data: {
				kind: "authorized",
				override: {
					kind: "per_diem",
					situation: { kind: "unsupported_case", reasons: ["special_location"] },
				},
			},
		});
		const view = await load(reportId);
		expect(view.items[0]?.perDiem).toMatchObject({
			amount: "112.80",
			calculation: { status: "exceptional" },
			override: { applies: true },
		});
		expect(await submit(reportId)).toEqual(SUBMITTED);
		const [revision] = await revisions(reportId);
		const facts = revision?.facts as { items: Array<Record<string, unknown>> };
		expect(facts.items[0]).toMatchObject({
			type: "per_diem",
			original: { amount: "112.80", currency: "EUR" },
			allowanceOverride: {
				situation: { kind: "unsupported_case", reasons: ["special_location"] },
				scope: { kind: "per_diem", destinations: [{ place: "Paris", countryCode: "FR" }] },
			},
		});
		expect(facts.items[0]?.perDiem).toBeUndefined();
	});

	it("corrects a returned report through a new override and a fresh revision", async () => {
		const { reportId, item } = await standaloneMileage();
		const first = await authorize(reportId, item.id);
		if (!first.success || first.data.kind !== "authorized") throw new Error("not authorized");
		expect(await submit(reportId)).toEqual(SUBMITTED);

		signIn("manager");
		expect(
			await reviewActions.returnTravelExpenseReportAction({
				approvalId: await pendingRequestId(reportId),
				note: "Please document the detour",
				itemComments: [],
			}),
		).toMatchObject({ success: true });

		const replaced = await authorize(reportId, item.id, {
			amount: "21.00",
			calculationBasis: "70.00 km × 0.30 EUR (detour documented)",
			replacesOverrideId: first.data.override.id,
		});
		expect(replaced).toMatchObject({ data: { kind: "authorized" } });
		expect(await submit(reportId)).toEqual(SUBMITTED);

		const overrideAmounts = (await revisions(reportId)).map(
			(revision) =>
				(revision.facts as { items: Array<{ allowanceOverride?: { amount: string } }> }).items[0]
					?.allowanceOverride?.amount,
		);
		// The earlier revision keeps the override it was frozen with.
		expect(overrideAmounts).toEqual(["18.45", "21.00"]);
		const response = await approve(await pendingRequestId(reportId));
		expect(response.status).toBe(200);
	});
});
