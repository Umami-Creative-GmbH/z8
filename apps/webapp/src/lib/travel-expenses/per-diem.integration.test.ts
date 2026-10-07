/**
 * #609: domestic per diem from travel timing and daily meals.
 *
 * The real settings and report actions, the submission owner and the
 * Approvals decision route run against a disposable PostgreSQL database.
 * Only the session, notifications and object storage are replaced. Expected
 * amounts follow the BMF letter of 25.11.2020 (LStH 2026, Anhang 25 III).
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t609-org",
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
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { submitTravelExpenseReport } = await import(
	"@/lib/approvals/server/travel-expense-report-submission"
);
const { db } = await import("@/db");
const { parseInstant } = await import("@/lib/datetime/temporal-core");

const ids = {
	requester: "e6090000-0000-4000-8000-000000000001",
	manager: "e6090000-0000-4000-8000-000000000002",
	boss: "e6090000-0000-4000-8000-000000000003",
	foreigner: "e6090000-0000-4000-8000-000000000004",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id in ('t609-org', 't609-foreign')");
	await admin.query('delete from "user" where id like $1', ["t609-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t609-org','Per diem','t609-org','Europe/Berlin',now()),
		 ('t609-foreign','Foreign','t609-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t609-org", "member", "employee"],
		["manager", "t609-org", "member", "manager"],
		["boss", "t609-org", "admin", "admin"],
		["foreigner", "t609-foreign", "admin", "admin"],
	];
	for (const [name, organizationId, memberRole, employeeRole] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t609-${name}`, name, `t609-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t609-member-${name}`, organizationId, `t609-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t609-${name}`, organizationId, employeeRole],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't609-boss', now(), now())`,
		[ids.requester, ids.manager],
	);
}

function signIn(name: Person) {
	harness.userId = `t609-${name}`;
	harness.organizationId = name === "foreigner" ? "t609-foreign" : "t609-org";
}

async function adoptGermanDefault(effectiveFrom = "2026-01-01", as: Person = "boss") {
	signIn(as);
	return policyActions.activatePerDiemPolicyVersionAction({
		source: "statutory_default",
		effectiveFrom,
		defaultKey: "de-per-diem-estg-9-4a-domestic",
	});
}

async function activateOrganizationRates(
	effectiveFrom: string,
	fullDay: string,
	partialDay: string,
	replacesVersionId: string | null = null,
) {
	signIn("boss");
	const result = await policyActions.activatePerDiemPolicyVersionAction({
		source: "organization",
		effectiveFrom,
		currency: "EUR",
		rates: {
			fullDay,
			partialDay,
			breakfastDeduction: "5.60",
			lunchDeduction: "11.20",
			dinnerDeduction: "11.20",
		},
		sourceReference: "Travel policy",
		replacesVersionId,
	});
	if (!result.success || result.data.status !== "activated") {
		throw new Error(`activation failed: ${JSON.stringify(result)}`);
	}
	return result.data.versionId;
}

async function load(reportId: string, as: Person = "requester") {
	signIn(as);
	const loaded = await reportActions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function trip(startDate: string, endDate: string, countryCode = "DE") {
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
			startDate,
			endDate,
			timeZone: "Europe/Berlin",
			destinations: [{ place: "Hamburg", countryCode }],
		},
	});
	if (!details.success) throw new Error(details.error);
	signIn("requester");
	const added = await perDiemActions.addTripPerDiemItemAction({ reportId });
	if (!added.success) throw new Error(added.error);
	return { reportId, item: added.data.item };
}

type MealFlags = Partial<Record<"breakfast" | "lunch" | "dinner", string | true>>;

function days(startDate: string, endDate: string): string[] {
	const result: string[] = [];
	for (let day = new Date(`${startDate}T00:00:00Z`); ; day.setUTCDate(day.getUTCDate() + 1)) {
		const date = day.toISOString().slice(0, 10);
		result.push(date);
		if (date === endDate) return result;
	}
}

function meals(startDate: string, endDate: string, provided: Record<string, MealFlags> = {}) {
	const entry = (value: string | true | undefined) =>
		value === undefined
			? { provided: false, employeePayment: null }
			: { provided: true, employeePayment: value === true ? null : value };
	return days(startDate, endDate).map((date) => ({
		date,
		breakfast: entry(provided[date]?.breakfast),
		lunch: entry(provided[date]?.lunch),
		dinner: entry(provided[date]?.dinner),
	}));
}

async function savePerDiem(
	reportId: string,
	item: { id: string; version: number },
	values: Partial<Parameters<typeof perDiemActions.savePerDiemDraftAction>[0]["values"]> & {
		startDate: string;
		endDate: string;
	},
) {
	signIn("requester");
	const saved = await perDiemActions.savePerDiemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			startTime: "08:00",
			startTimeZone: "Europe/Berlin",
			endTime: "17:00",
			endTimeZone: "Europe/Berlin",
			overnight: values.startDate === values.endDate ? null : "away",
			prolongedWorkplace: false,
			meals: meals(values.startDate, values.endDate),
			...values,
		},
	});
	if (!saved.success || saved.data.status !== "saved") {
		throw new Error(`save failed: ${JSON.stringify(saved)}`);
	}
	return saved.data.item;
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

describe("domestic per diem from travel timing and daily meals (#609)", () => {
	beforeEach(seed);
	afterAll(cleanup);

	it("lets only expense administrators adopt the verified German default, never before its edition", async () => {
		expect(await adoptGermanDefault("2026-01-01", "requester")).toEqual({
			success: false,
			error: "Unauthorized: Admin access required",
		});
		expect(await adoptGermanDefault("2025-12-31")).toEqual({
			success: true,
			data: { status: "invalid", errors: { effectiveFrom: "before_default_validity" } },
		});
		const adopted = await adoptGermanDefault();
		expect(adopted).toMatchObject({ success: true, data: { status: "activated" } });
		signIn("boss");
		const settings = await policyActions.getPerDiemPolicySettings();
		if (!settings.success) throw new Error(settings.error);
		expect(settings.data.timeline).toEqual([
			expect.objectContaining({
				effectiveFrom: "2026-01-01",
				currency: "EUR",
				source: expect.objectContaining({
					kind: "statutory_default",
					defaultKey: "de-per-diem-estg-9-4a-domestic",
					version: "LStH 2026, Anhang 25 III",
				}),
				rates: {
					DE: {
						fullDay: "28.00",
						partialDay: "14.00",
						breakfastDeduction: "5.60",
						lunchDeduction: "11.20",
						dinnerDeduction: "11.20",
					},
				},
			}),
		]);
		// A partial-day amount above the full-day amount is refused before any write.
		signIn("boss");
		expect(
			await policyActions.activatePerDiemPolicyVersionAction({
				source: "organization",
				effectiveFrom: "2026-03-01",
				currency: "EUR",
				rates: {
					fullDay: "28",
					partialDay: "30",
					breakfastDeduction: "5.60",
					lunchDeduction: "11.20",
					dinnerDeduction: "11.20",
				},
			}),
		).toEqual({
			success: true,
			data: { status: "invalid", errors: { partialDay: "exceeds_full_day" } },
		});
	});

	it("calculates the daily breakdown of a three-day trip with provided meals (Beispiel 48)", async () => {
		await adoptGermanDefault();
		const { reportId, item } = await trip("2026-06-01", "2026-06-03");
		const saved = await savePerDiem(reportId, item, {
			startDate: "2026-06-01",
			endDate: "2026-06-03",
			meals: meals("2026-06-01", "2026-06-03", {
				"2026-06-02": { breakfast: true, lunch: true, dinner: true },
				"2026-06-03": { breakfast: true },
			}),
		});
		expect(saved.perDiem?.amount).toBe("22.40");
		const calculation = saved.perDiem?.calculation;
		if (calculation?.status !== "calculated") throw new Error("not calculated");
		expect(calculation.days.map((day) => [day.date, day.basis, day.rate, day.amount])).toEqual([
			["2026-06-01", "travel_day_with_overnight", "14.00", "14.00"],
			["2026-06-02", "absence_24h", "28.00", "0.00"],
			["2026-06-03", "travel_day_with_overnight", "14.00", "8.40"],
		]);
		// The same calculation is what the report page loads.
		expect((await load(reportId)).items[0]?.perDiem?.amount).toBe("22.40");
	});

	it("refuses a client-supplied amount instead of storing it", async () => {
		await adoptGermanDefault();
		const { reportId, item } = await trip("2026-06-01", "2026-06-01");
		signIn("requester");
		const result = await perDiemActions.savePerDiemDraftAction({
			reportId,
			itemId: item.id,
			expectedVersion: item.version,
			values: {
				startDate: "2026-06-01",
				startTime: "08:00",
				startTimeZone: "Europe/Berlin",
				endDate: "2026-06-01",
				endTime: "18:00",
				endTimeZone: "Europe/Berlin",
				overnight: null,
				prolongedWorkplace: false,
				meals: meals("2026-06-01", "2026-06-01"),
				amount: "500.00",
			} as never,
		});
		expect(result).toEqual({ success: false, error: "Invalid expense draft" });
	});

	it("keeps a per diem without policy coverage or with an exceptional itinerary in draft", async () => {
		const uncovered = await trip("2026-06-01", "2026-06-01");
		const priced = await savePerDiem(uncovered.reportId, uncovered.item, {
			startDate: "2026-06-01",
			endDate: "2026-06-01",
			endTime: "18:00",
		});
		expect(priced.perDiem?.calculation).toEqual({
			status: "policy_missing",
			dates: ["2026-06-01"],
		});
		expect(await submit(uncovered.reportId)).toMatchObject({
			success: true,
			data: {
				status: "incomplete",
				missing: { items: [{ id: uncovered.item.id, missing: ["per_diem_policy_missing"] }] },
			},
		});

		await adoptGermanDefault();
		const prolonged = await trip("2026-07-01", "2026-07-02");
		const flagged = await savePerDiem(prolonged.reportId, prolonged.item, {
			startDate: "2026-07-01",
			endDate: "2026-07-02",
			prolongedWorkplace: true,
		});
		expect(flagged.perDiem?.calculation).toEqual({
			status: "exceptional",
			reasons: ["prolonged_workplace"],
			overlappingDays: [],
		});
		expect(await submit(prolonged.reportId)).toMatchObject({
			data: {
				status: "incomplete",
				missing: { items: [{ id: prolonged.item.id, missing: ["per_diem_exceptional"] }] },
			},
		});

		const abroad = await trip("2026-08-03", "2026-08-03", "FR");
		const international = await savePerDiem(abroad.reportId, abroad.item, {
			startDate: "2026-08-03",
			endDate: "2026-08-03",
		});
		// Since #611 a trip abroad asks for its daily location instead of being flagged.
		expect(international.perDiem?.calculation).toEqual({
			status: "incomplete",
			missingLocations: ["2026-08-03"],
		});
	});

	it("requires the itinerary to match the trip dates and every day's meal facts", async () => {
		await adoptGermanDefault();
		const { reportId, item } = await trip("2026-06-01", "2026-06-03");
		await savePerDiem(reportId, item, {
			startDate: "2026-06-01",
			endDate: "2026-06-02",
			meals: meals("2026-06-01", "2026-06-01"),
		});
		expect(await submit(reportId)).toMatchObject({
			data: {
				status: "incomplete",
				missing: { items: [{ id: item.id, missing: ["per_diem_trip_dates", "per_diem_meals"] }] },
			},
		});
	});

	it("freezes the itinerary, rule edition, policy and breakdown through approval", async () => {
		const versionId = await activateOrganizationRates("2026-01-01", "28.00", "14.00");
		const { reportId, item } = await trip("2026-09-14", "2026-09-15");
		await savePerDiem(reportId, item, {
			startDate: "2026-09-14",
			startTime: "07:15",
			endDate: "2026-09-15",
			endTime: "19:40",
			meals: meals("2026-09-14", "2026-09-15", { "2026-09-15": { breakfast: "2.00" } }),
		});

		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		const frozen = await revisionFacts(reportId);
		expect(frozen.material_fingerprint).toMatch(/^travel_expense_report:v11:[0-9a-f]{64}$/);
		// 14 + (14 - (5.60 - 2.00))
		expect(frozen.facts.totals).toEqual({
			currency: "EUR",
			reimbursable: "24.40",
			companyPaid: "0.00",
		});
		expect((frozen.facts.items as Array<Record<string, unknown>>)[0]).toMatchObject({
			type: "per_diem",
			category: "meals",
			original: { amount: "24.40", currency: "EUR" },
			perDiem: {
				start: {
					date: "2026-09-14",
					time: "07:15",
					timeZone: "Europe/Berlin",
					at: "2026-09-14T05:15:00Z",
				},
				end: {
					date: "2026-09-15",
					time: "19:40",
					timeZone: "Europe/Berlin",
					at: "2026-09-15T17:40:00Z",
				},
				overnight: "away",
				amount: "24.40",
				rules: { key: "de-domestic-per-diem-estg-9-4a-2026", version: "LStH 2026" },
				policies: [expect.objectContaining({ versionId, area: "DE" })],
			},
		});

		// The administrator replaces the rates while the report is in review.
		await activateOrganizationRates("2026-01-01", "40.00", "20.00", versionId);
		expect((await load(reportId)).items[0]?.perDiem?.amount).toBe("24.40");
		expect((await approve(await pendingRequestId(reportId))).status).toBe(200);
		const { rows } = await admin.query("select status from travel_expense_report where id = $1", [
			reportId,
		]);
		expect(rows[0]?.status).toBe("approved");
		expect((await revisionFacts(reportId)).material_fingerprint).toBe(frozen.material_fingerprint);
	});

	it("refuses a per diem until its return has passed, at the injected submission instant (#685)", async () => {
		await activateOrganizationRates("2026-01-01", "28.00", "14.00");
		const { reportId, item } = await trip("2026-09-14", "2026-09-15");
		// 19:40 in Berlin on 2026-09-15 is 17:40Z.
		await savePerDiem(reportId, item, {
			startDate: "2026-09-14",
			startTime: "07:15",
			endDate: "2026-09-15",
			endTime: "19:40",
		});
		const owner = {
			organizationId: "t609-org",
			employeeId: ids.requester,
			userId: "t609-requester",
		};
		const at = async (now: string) =>
			submitTravelExpenseReport(
				db,
				{ owner, reportId, reviewed: await reviewed(reportId) },
				parseInstant(now),
			);

		expect(await at("2026-09-15T17:39:00Z")).toEqual({
			kind: "incomplete",
			missing: { trip: [], items: [{ id: item.id, missing: ["per_diem_not_returned"] }] },
		});
		const { rows } = await admin.query("select status from travel_expense_report where id = $1", [
			reportId,
		]);
		expect(rows[0]?.status).toBe("draft");

		expect(await at("2026-09-15T17:41:00Z")).toMatchObject({ kind: "submitted" });
		expect((await revisionFacts(reportId)).facts.totals).toMatchObject({ reimbursable: "28.00" });
	});

	it("refuses a submission whose calculated allowance changed since the review", async () => {
		const versionId = await activateOrganizationRates("2026-01-01", "28.00", "14.00");
		const { reportId, item } = await trip("2026-06-01", "2026-06-01");
		await savePerDiem(reportId, item, { startDate: "2026-06-01", endDate: "2026-06-01" });
		const versions = await reviewed(reportId);
		await activateOrganizationRates("2026-01-01", "30.00", "15.00", versionId);
		expect(await submit(reportId, versions)).toEqual({
			success: true,
			data: { status: "changed_since_review" },
		});
		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		expect((await revisionFacts(reportId)).facts.totals).toMatchObject({ reimbursable: "15.00" });
	});

	it("submits a legitimate zero allowance after deductions", async () => {
		await adoptGermanDefault();
		const { reportId, item } = await trip("2026-06-01", "2026-06-01");
		const saved = await savePerDiem(reportId, item, {
			startDate: "2026-06-01",
			endDate: "2026-06-01",
			endTime: "18:00",
			meals: meals("2026-06-01", "2026-06-01", { "2026-06-01": { lunch: true, dinner: true } }),
		});
		expect(saved.perDiem?.amount).toBe("0.00");
		expect(await submit(reportId)).toEqual({ success: true, data: { status: "submitted" } });
		expect((await revisionFacts(reportId)).facts.totals).toMatchObject({ reimbursable: "0.00" });
	});

	it("pays no second allowance for a day another submitted report or a legacy claim pays", async () => {
		await adoptGermanDefault();
		const daysOf = async (reportId: string) => {
			const calculation = (await load(reportId)).items[0]?.perDiem?.calculation;
			if (calculation?.status !== "calculated") throw new Error(JSON.stringify(calculation));
			return calculation.days.map((day) => [day.date, day.basis, day.amount]);
		};
		// Monday to Wednesday; Wednesday's lunch and dinner use up its 14 € allowance.
		const first = await trip("2026-06-01", "2026-06-03");
		await savePerDiem(first.reportId, first.item, {
			startDate: "2026-06-01",
			endDate: "2026-06-03",
			meals: meals("2026-06-01", "2026-06-03", { "2026-06-03": { lunch: true, dinner: true } }),
		});
		const second = await trip("2026-05-31", "2026-06-01");
		await savePerDiem(second.reportId, second.item, {
			startDate: "2026-05-31",
			endDate: "2026-06-01",
		});
		// Drafts are no claim yet: both are calculated in full.
		expect(await daysOf(second.reportId)).toEqual([
			["2026-05-31", "travel_day_with_overnight", "14.00"],
			["2026-06-01", "travel_day_with_overnight", "14.00"],
		]);

		expect(await submit(first.reportId)).toEqual({ success: true, data: { status: "submitted" } });
		// Monday is paid by the submitted trip: only that day carries no allowance here.
		expect(await daysOf(second.reportId)).toEqual([
			["2026-05-31", "travel_day_with_overnight", "14.00"],
			["2026-06-01", "claimed_in_other_report", "0.00"],
		]);
		// Wednesday has no positive allowance there, so a trip starting on it is paid in full.
		const third = await trip("2026-06-03", "2026-06-04");
		await savePerDiem(third.reportId, third.item, {
			startDate: "2026-06-03",
			endDate: "2026-06-04",
		});
		expect(await daysOf(third.reportId)).toEqual([
			["2026-06-03", "travel_day_with_overnight", "14.00"],
			["2026-06-04", "travel_day_with_overnight", "14.00"],
		]);

		// The second trip is submittable as calculated and freezes the claimed day.
		expect(await submit(second.reportId)).toEqual({ success: true, data: { status: "submitted" } });
		const frozen = await revisionFacts(second.reportId);
		const frozenItem = (frozen.facts.items as Array<{ perDiem: { days: unknown[] } }>)[0];
		expect(frozenItem?.perDiem.days).toEqual([
			expect.objectContaining({ date: "2026-05-31", amount: "14.00" }),
			expect.objectContaining({
				date: "2026-06-01",
				allowance: "none",
				basis: "claimed_in_other_report",
				amount: "0.00",
			}),
		]);
		expect(frozen.facts.totals).toMatchObject({ reimbursable: "14.00" });
		// Rejecting the first trip later does not change what the second one was submitted with.
		await admin.query(
			"update travel_expense_report set status = 'rejected', decided_at = now() where id = $1",
			[first.reportId],
		);
		expect((await load(second.reportId)).items[0]?.perDiem?.amount).toBe("14.00");

		// A rejected report pays nothing; an approved legacy per diem claim counts with all its days.
		expect(await daysOf(third.reportId)).toEqual([
			["2026-06-03", "travel_day_with_overnight", "14.00"],
			["2026-06-04", "travel_day_with_overnight", "14.00"],
		]);
		await admin.query(
			`insert into travel_expense_claim (organization_id, employee_id, type, status, trip_start, trip_end,
			   trip_start_date, trip_end_date, trip_date_time_zone, original_currency, original_amount,
			   calculated_currency, calculated_amount, created_by, updated_at)
			 values ('t609-org', $1, 'per_diem', 'approved', '2026-06-04T06:00:00Z', '2026-06-04T18:00:00Z',
			   '2026-06-04', '2026-06-04', 'Europe/Berlin', 'EUR', 14, 'EUR', 14, 't609-requester', now())`,
			[ids.requester],
		);
		expect(await daysOf(third.reportId)).toEqual([
			["2026-06-03", "travel_day_with_overnight", "14.00"],
			["2026-06-04", "claimed_in_other_report", "0.00"],
		]);
	});

	it("allows one per diem per trip and none on standalone reports", async () => {
		await adoptGermanDefault();
		const { reportId } = await trip("2026-06-01", "2026-06-01");
		signIn("requester");
		expect(await perDiemActions.addTripPerDiemItemAction({ reportId })).toEqual({
			success: false,
			error: "This trip already has a per diem",
		});
		const standalone = await reportActions.createStandaloneReceiptReportAction();
		if (!standalone.success) throw new Error(standalone.error);
		signIn("requester");
		expect(
			await perDiemActions.addTripPerDiemItemAction({ reportId: standalone.data.reportId }),
		).toEqual({ success: false, error: "Expense report not found" });
	});

	it("never calculates with another organization's policy or edits another employee's trip", async () => {
		await adoptGermanDefault("2026-01-01", "foreigner");
		const { reportId, item } = await trip("2026-06-01", "2026-06-01");
		const saved = await savePerDiem(reportId, item, {
			startDate: "2026-06-01",
			endDate: "2026-06-01",
			endTime: "18:00",
		});
		expect(saved.perDiem?.calculation?.status).toBe("policy_missing");
		signIn("manager");
		expect(
			await perDiemActions.savePerDiemDraftAction({
				reportId,
				itemId: item.id,
				expectedVersion: saved.version,
				values: {
					startDate: "2026-06-01",
					startTime: "08:00",
					startTimeZone: "Europe/Berlin",
					endDate: "2026-06-01",
					endTime: "20:00",
					endTimeZone: "Europe/Berlin",
					overnight: null,
					prolongedWorkplace: false,
					meals: meals("2026-06-01", "2026-06-01"),
				},
			}),
		).toEqual({ success: false, error: "Expense report not found" });
	});
});
