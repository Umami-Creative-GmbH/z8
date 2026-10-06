/**
 * #611: international per diem from the daily itinerary and the verified BMF
 * table of foreign amounts for 2026.
 *
 * The real settings, report, per diem and override actions, the submission
 * owner and the Approvals decision route run against a disposable PostgreSQL
 * database. Only the session, notifications and object storage are replaced.
 * Expected amounts are read from LStH 2026, Anhang 25 I (BMF 05.12.2025).
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t611-org",
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
const perDiemActions = await import("@/app/[locale]/(app)/travel-expenses/per-diem-actions");
const policyActions = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/per-diem-policy-actions"
);
const overrideActions = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/allowance-override-actions"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");

const ids = {
	requester: "e6110000-0000-4000-8000-000000000001",
	manager: "e6110000-0000-4000-8000-000000000002",
	boss: "e6110000-0000-4000-8000-000000000003",
} as const;
type Person = keyof typeof ids;

const FOREIGN_DEFAULT = "de-per-diem-estg-9-4a-bmf-foreign-2026";
const DOMESTIC_DEFAULT = "de-per-diem-estg-9-4a-domestic";

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = 't611-org'");
	await admin.query('delete from "user" where id like $1', ["t611-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t611-org','International per diem','t611-org','Europe/Berlin',now())`,
	);
	const people: Array<[Person, string, string]> = [
		["requester", "member", "employee"],
		["manager", "member", "manager"],
		["boss", "admin", "admin"],
	];
	for (const [name, memberRole, employeeRole] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t611-${name}`, `${name} t611`, `t611-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,'t611-org',$2,$3,'approved',now())",
			[`t611-member-${name}`, `t611-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,'t611-org',$3,now())",
			[ids[name], `t611-${name}`, employeeRole],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't611-boss', now(), now())`,
		[ids.requester, ids.manager],
	);
}

function signIn(name: Person) {
	harness.userId = `t611-${name}`;
	harness.organizationId = "t611-org";
}

async function adopt(defaultKey: string, effectiveFrom = "2026-01-01") {
	signIn("boss");
	return policyActions.activatePerDiemPolicyVersionAction({
		source: "statutory_default",
		effectiveFrom,
		defaultKey,
	});
}

async function load(reportId: string, as: Person = "requester") {
	signIn(as);
	const loaded = await reportActions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function trip(startDate: string, endDate: string, countries: string[]) {
	signIn("requester");
	const created = await reportActions.createTripReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	const report = await load(reportId);
	const details = await reportActions.saveTripDetailsDraftAction({
		reportId,
		expectedVersion: report.trip?.version ?? 1,
		values: {
			purpose: "Partner visits",
			startDate,
			endDate,
			timeZone: "Europe/Berlin",
			destinations: countries.map((countryCode) => ({ place: `Office ${countryCode}`, countryCode })),
		},
	});
	if (!details.success) throw new Error(details.error);
	signIn("requester");
	const added = await perDiemActions.addTripPerDiemItemAction({ reportId });
	if (!added.success) throw new Error(added.error);
	return { reportId, item: added.data.item };
}

function days(startDate: string, endDate: string): string[] {
	const result: string[] = [];
	for (let day = new Date(`${startDate}T00:00:00Z`); ; day.setUTCDate(day.getUTCDate() + 1)) {
		const date = day.toISOString().slice(0, 10);
		result.push(date);
		if (date === endDate) return result;
	}
}

type Location = { country: string; place: string | null } | { special: string };
type DayAnswers = { night?: Location; activityAbroad?: Location; breakfast?: boolean };

const place = (country: string, key: string | null = null): Location => ({ country, place: key });

function dayRows(startDate: string, endDate: string, answers: DayAnswers[]) {
	const none = { provided: false, employeePayment: null };
	return days(startDate, endDate).map((date, index) => {
		const { breakfast, ...locations } = answers[index] ?? {};
		return {
			date,
			breakfast: breakfast ? { provided: true, employeePayment: null } : none,
			lunch: none,
			dinner: none,
			...locations,
		};
	});
}

async function savePerDiem(
	reportId: string,
	item: { id: string; version: number },
	values: { start: string; end: string; answers: DayAnswers[]; overnight?: string | null },
) {
	const [startDate = "", startTime = ""] = values.start.split("T");
	const [endDate = "", endTime = ""] = values.end.split("T");
	signIn("requester");
	return perDiemActions.savePerDiemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			startDate,
			startTime,
			startTimeZone: "Europe/Berlin",
			endDate,
			endTime,
			endTimeZone: "Europe/Berlin",
			overnight: values.overnight ?? (startDate === endDate ? null : "away"),
			prolongedWorkplace: false,
			meals: dayRows(startDate, endDate, values.answers) as never,
		},
	});
}

async function saved(...args: Parameters<typeof savePerDiem>) {
	const result = await savePerDiem(...args);
	if (!result.success || result.data.status !== "saved") {
		throw new Error(`save failed: ${JSON.stringify(result)}`);
	}
	return result.data.item;
}

async function reviewed(reportId: string) {
	const report = await load(reportId);
	return {
		detailsVersion: report.trip?.version ?? null,
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

async function revisionFacts(reportId: string) {
	const { rows } = await admin.query(
		"select material_fingerprint, schema_version, facts from approval_submitted_revision where source_type = 'travel_expense_report' and source_id = $1",
		[reportId],
	);
	expect(rows).toHaveLength(1);
	return rows[0] as {
		material_fingerprint: string;
		schema_version: number;
		facts: { items: Array<Record<string, unknown>>; totals: Record<string, string> };
	};
}

async function approve(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
		[reportId],
	);
	const requestId = rows[0]?.id;
	if (!requestId) throw new Error("no pending request");
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

// Rz. 52 Beispiel 37: Berlin Monday 20:00, Brussels Tuesday, Amsterdam Wednesday, home Thursday.
const BENELUX = {
	start: "2026-03-02T20:00",
	end: "2026-03-05T22:30",
	answers: [
		{ night: place("DE"), activityAbroad: place("DE") },
		{ night: place("BE") },
		{ night: place("NL"), breakfast: true },
		{ activityAbroad: place("NL"), breakfast: true },
	],
};

describe("international per diem from the daily itinerary (#611)", () => {
	beforeEach(seed);
	afterAll(cleanup);

	it("adopts the verified foreign table only explicitly and only within its year", async () => {
		expect(await adopt(FOREIGN_DEFAULT, "2027-01-04")).toEqual({
			success: true,
			data: { status: "invalid", errors: { effectiveFrom: "after_default_validity" } },
		});
		const adopted = await adopt(FOREIGN_DEFAULT);
		if (!adopted.success || adopted.data.status !== "activated") throw new Error("not adopted");
		const { rows } = await admin.query<{ area: string; full_day_amount: string; breakfast: string }>(
			`select area, full_day_amount, breakfast_deduction as breakfast from travel_expense_per_diem_rate
			 where organization_id = 't611-org' and version_id = $1 order by area`,
			[adopted.data.versionId],
		);
		// Germany, 166 countries and 48 places of the 2026 notice.
		expect(rows).toHaveLength(1 + 166 + 48);
		expect(rows.find((row) => row.area === "US:new-york-city")).toMatchObject({
			full_day_amount: "66.00",
			breakfast: "13.20",
		});
		expect(rows.find((row) => row.area === "DE")).toMatchObject({ full_day_amount: "28.00" });
		const { rows: versions } = await admin.query(
			"select source_kind, default_key, source_version from travel_expense_allowance_policy_version where organization_id = 't611-org'",
		);
		expect(versions).toEqual([
			{
				source_kind: "statutory_default",
				default_key: FOREIGN_DEFAULT,
				source_version: "LStH 2026, Anhang 25 I and III",
			},
		]);
	});

	it("prices a multi-country trip per day, freezes the location decisions and approves it", async () => {
		await adopt(FOREIGN_DEFAULT);
		const { reportId, item } = await trip("2026-03-02", "2026-03-05", ["BE", "NL"]);
		const empty = await saved(reportId, item, { ...BENELUX, answers: [] });
		expect(empty.perDiem?.calculation).toEqual({
			status: "incomplete",
			missingLocations: ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"],
		});
		expect(await submit(reportId)).toMatchObject({
			data: {
				status: "incomplete",
				missing: { items: [{ id: item.id, missing: ["per_diem_locations"] }] },
			},
		});

		const answered = await saved(reportId, empty, BENELUX);
		// 14 (DE) + 59 (BE) + (58 - 11.60) NL + (39 - 11.60) NL = 146.80
		expect(answered.perDiem?.amount).toBe("146.80");
		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });

		const frozen = await revisionFacts(reportId);
		expect(frozen.schema_version).toBe(10);
		expect(frozen.material_fingerprint).toMatch(/^travel_expense_report:v10:[0-9a-f]{64}$/);
		const perDiem = frozen.facts.items[0]?.perDiem as {
			days: Array<{ date: string; location: { area: string; basis: string; rule: string } }>;
			meals: Array<Record<string, unknown>>;
			rules: { foreignTable: { key: string } };
		};
		expect(perDiem.days.map((day) => [day.date, day.location.area, day.location.basis])).toEqual([
			["2026-03-02", "DE", "domestic"],
			["2026-03-03", "BE", "night"],
			["2026-03-04", "NL", "night"],
			["2026-03-05", "NL", "last_activity_abroad"],
		]);
		expect(perDiem.meals[1]?.night).toEqual({ country: "BE", place: null });
		expect(perDiem.rules.foreignTable.key).toBe("de-bmf-foreign-per-diem-2026");
		expect(frozen.facts.totals.reimbursable).toBe("146.80");

		// The stamp keeps the frozen result even after the organization's rates change.
		await adopt(DOMESTIC_DEFAULT, "2026-02-01");
		const response = await approve(reportId);
		expect(response.status).toBe(200);
		const decided = await load(reportId);
		expect(decided.status).toBe("approved");
	});

	it("keeps foreign days in draft when the organization adopted domestic rates only", async () => {
		await adopt(DOMESTIC_DEFAULT);
		const { reportId, item } = await trip("2026-03-02", "2026-03-05", ["BE", "NL"]);
		const answered = await saved(reportId, item, BENELUX);
		expect(answered.perDiem?.calculation).toEqual({
			status: "policy_missing",
			dates: ["2026-03-03", "2026-03-04", "2026-03-05"],
		});
		expect(await submit(reportId)).toMatchObject({
			data: {
				status: "incomplete",
				missing: { items: [{ id: item.id, missing: ["per_diem_policy_missing"] }] },
			},
		});
	});

	it("calculates an official fallback visibly and lets an administrator override it", async () => {
		await adopt(FOREIGN_DEFAULT);
		const { reportId, item } = await trip("2026-09-07", "2026-09-08", ["IQ"]);
		const answered = await saved(reportId, item, {
			start: "2026-09-07T06:00",
			end: "2026-09-08T22:00",
			answers: [{ night: place("IQ") }, { activityAbroad: place("IQ") }],
		});
		expect(answered.perDiem).toMatchObject({
			amount: "84.00",
			calculation: {
				status: "calculated",
				days: [
					{ location: { rule: "luxembourg", area: "LU" }, rate: "42.00" },
					{ location: { rule: "luxembourg", area: "LU" }, rate: "42.00" },
				],
			},
		});
		const report = await load(reportId);
		signIn("boss");
		const authorized = await overrideActions.authorizeAllowanceOverrideAction({
			reportId,
			itemId: item.id,
			expectedVersion: report.items[0]?.version ?? 0,
			amount: "90.00",
			reason: "Embassy-confirmed local costs",
			evidence: "Travel office confirmation",
			calculationBasis: "2 × 45.00",
		});
		expect(authorized).toMatchObject({
			success: true,
			data: {
				kind: "authorized",
				override: { situation: { kind: "official_fallback", reasons: ["luxembourg"] } },
			},
		});
	});

	it("refuses unknown places and flags destinations the rules do not resolve", async () => {
		await adopt(FOREIGN_DEFAULT);
		const { reportId, item } = await trip("2026-05-04", "2026-05-05", ["US"]);
		expect(
			await savePerDiem(reportId, item, {
				start: "2026-05-04T08:00",
				end: "2026-05-05T18:00",
				answers: [{ night: place("US", "gotham") }, { activityAbroad: place("US") }],
			}),
		).toEqual({ success: true, data: { status: "invalid", errors: { meals: "invalid_location" } } });

		const flagged = await saved(reportId, item, {
			start: "2026-05-04T08:00",
			end: "2026-05-05T18:00",
			answers: [{ night: place("PS") }, { activityAbroad: place("PS") }],
		});
		expect(flagged.perDiem?.calculation).toEqual({
			status: "exceptional",
			reasons: ["destination_not_listed"],
			overlappingDays: [],
		});
	});

	it("never grants a second allowance for a day a consecutive trip already claims", async () => {
		await adopt(FOREIGN_DEFAULT);
		// BMF example: home from Strasbourg on Tuesday, on to Copenhagen the same day.
		const first = await trip("2026-06-08", "2026-06-09", ["FR"]);
		await saved(first.reportId, first.item, {
			start: "2026-06-08T07:00",
			end: "2026-06-09T14:00",
			answers: [{ night: place("FR") }, { activityAbroad: place("FR") }],
		});
		const second = await trip("2026-06-09", "2026-06-10", ["DK"]);
		const overlapping = await saved(second.reportId, second.item, {
			start: "2026-06-09T16:00",
			end: "2026-06-10T20:00",
			answers: [{ night: place("DK") }, { activityAbroad: place("DK") }],
		});
		expect(overlapping.perDiem?.calculation).toMatchObject({
			status: "exceptional",
			reasons: ["overlapping_days"],
			overlappingDays: ["2026-06-09"],
		});
	});
});
