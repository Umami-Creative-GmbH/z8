/**
 * #1999: External Contractors' cost in Billable Time margin, on PostgreSQL.
 * The real report actions, rate readers and contractor pricing engine run;
 * only the session, SSO store and logger are replaced.
 *
 * Customer revenue stays on the billable rate hierarchy. Cost: an explicit
 * cost rate wins; otherwise the contractor's hourly or daily terms, with a
 * daily fee priced once per local day from all of that day's work and split
 * across its projects by duration; with neither, margin stays unknown.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1999-org",
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t1999-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/organization-mfa/organization-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/organization-mfa/organization-access")>()),
	canAccessOrganization: async () => true,
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
	}),
}));

const { getCustomerBillableReport, getProjectDetailedReport, getProjectsOverview } =
	await import("./actions");

const ORG = "t1999-org";
const OTHER_ORG = "t1999-other-org";
const id = (suffix: string) => `19990000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
	owner: id("1"),
	pm: id("2"),
	teamManager: id("3"),
	hourly: id("11"),
	fullDay: id("12"),
	halfDay: id("13"),
	prorated: id("14"),
	capped: id("15"),
	overriddenHourly: id("16"),
	overriddenDaily: id("17"),
	unpriced: id("18"),
	foreign: id("19"),
	tokyo: id("20"),
	usd: id("21"),
	lateStart: id("22"),
	customer: id("c1"),
	foreignCustomer: id("c2"),
	website: id("a1"),
	support: id("a2"),
	foreignProject: id("a3"),
} as const;
const contractors = [
	ids.hourly,
	ids.fullDay,
	ids.halfDay,
	ids.prorated,
	ids.capped,
	ids.overriddenHourly,
	ids.overriddenDaily,
	ids.unpriced,
] as const;
/** Contractors a single test seeds with its own engagement. */
const ownSetupContractors = [ids.tokyo, ids.usd, ids.lateStart] as const;
const userOf = (employeeId: string) => `t1999-user-${employeeId.slice(-4)}`;
const everyEmployee = [
	ids.owner,
	ids.pm,
	ids.teamManager,
	...contractors,
	...ownSetupContractors,
	ids.foreign,
];
const fromDay = "2026-03-01";
const toDay = "2026-03-31";

async function unwrap<T>(
	result: Promise<{ success: true; data: T } | { success: false; error: string }>,
) {
	const settled = await result;
	if (!settled.success) throw new Error(settled.error);
	return settled.data;
}

function actAs(employeeId: string) {
	harness.userId = userOf(employeeId);
	harness.organizationId = ORG;
}

describe("contractor cost in Billable Time margin on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		for (const organizationId of [ORG, OTHER_ORG]) {
			await admin.query("delete from work_period where organization_id = $1", [organizationId]);
			await admin.query("delete from time_entry where organization_id = $1", [organizationId]);
		}
		await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
		await admin.query('delete from "user" where id = any($1::text[])', [everyEmployee.map(userOf)]);
	}

	async function work(options: {
		employeeId: string;
		projectId: string;
		start: string;
		end: string;
		billable?: boolean;
		organizationId?: string;
		/** The clock entries' captured offset and zone; UTC by default. */
		offsetMinutes?: number;
		timezone?: string;
	}) {
		const organizationId = options.organizationId ?? ORG;
		const minutes = (new Date(options.end).getTime() - new Date(options.start).getTime()) / 60_000;
		const clockInId = randomUUID();
		const clockOutId = randomUUID();
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", options.start],
			[clockOutId, "clock_out", options.end],
		]) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
				 values ($1::uuid, $2, $3, $4, $5, $7, $8, 'user_setting', $1::uuid::text, $6)`,
				[
					entryId,
					options.employeeId,
					organizationId,
					type,
					timestamp,
					userOf(ids.owner),
					options.offsetMinutes ?? 0,
					options.timezone ?? "Etc/UTC",
				],
			);
		}
		await withCanonicalRecords(admin, (client) =>
			client.query(
				`insert into work_period
				 (employee_id, organization_id, clock_in_id, clock_out_id, project_id, is_billable, start_time,
				  end_time, duration_minutes, is_active, approval_status, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, 'approved', now())`,
				[
					options.employeeId,
					organizationId,
					clockInId,
					clockOutId,
					options.projectId,
					options.billable ?? true,
					options.start,
					options.end,
					minutes,
				],
			),
		);
	}

	async function contractor(employeeId: string, startedAt = "2026-01-01T00:00:00Z") {
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, engagement_kind, updated_at)
			 values ($1, $2, $3, 'employee', 'contractor', now())`,
			[employeeId, userOf(employeeId), ORG],
		);
		const {
			rows: [period],
		} = await admin.query<{ id: string }>(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
			 values ($1, $2, 'open', $3, 'recorded', 'contractor') returning id`,
			[ORG, employeeId, startedAt],
		);
		return period.id;
	}

	async function terms(
		employeeId: string,
		periodId: string,
		input: {
			basis: "hourly" | "daily";
			rate: string;
			from?: string;
			to?: string;
			rule?: "any_work_full_day" | "half_and_full_day" | "prorated_by_standard_day";
			threshold?: number;
			standard?: number;
			cap?: boolean;
			currency?: string;
			organizationId?: string;
		},
	) {
		await admin.query(
			`insert into contractor_compensation_terms
			 (organization_id, employee_id, employment_period_id, compensation_basis, rate_amount, currency,
			  day_unit_rule, half_day_threshold_minutes, standard_day_minutes, cap_at_one_day, effective_from, effective_to)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			[
				input.organizationId ?? ORG,
				employeeId,
				periodId,
				input.basis,
				input.rate,
				input.currency ?? "EUR",
				input.rule ?? null,
				input.threshold ?? null,
				input.standard ?? null,
				input.cap ?? null,
				input.from ?? "2026-03-01",
				input.to ?? null,
			],
		);
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, billable_time_enabled, created_at)
			 values ($1, 'T1999', $1, 'UTC', true, true, now()), ($2, 'T1999 other', $2, 'UTC', true, true, now())`,
			[ORG, OTHER_ORG],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR'), ($2, 'EUR')`,
			[ORG, OTHER_ORG],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[everyEmployee.map(userOf)],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 'm-' || user_id, $1, user_id, case when user_id = $2 then 'owner' else 'member' end, 'approved', now()
			 from unnest($3::text[]) as user_id`,
			[
				ORG,
				userOf(ids.owner),
				[ids.owner, ids.pm, ids.teamManager, ...contractors, ...ownSetupContractors].map(userOf),
			],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('m-foreign', $1, $2, 'owner', 'approved', now())`,
			[OTHER_ORG, userOf(ids.foreign)],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'admin', now()), ($3, $4, $7, 'employee', now()), ($5, $6, $7, 'manager', now())`,
			[
				ids.owner,
				userOf(ids.owner),
				ids.pm,
				userOf(ids.pm),
				ids.teamManager,
				userOf(ids.teamManager),
				ORG,
			],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at) values
			 ($1, $2, 'Acme', $3, now()), ($4, $5, 'Foreign', $6, now())`,
			[ids.customer, ORG, userOf(ids.owner), ids.foreignCustomer, OTHER_ORG, userOf(ids.foreign)],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, customer_id, billable_default, created_by, updated_at) values
			 ($1, $3, 'Website', 'active', $4, true, $5, now()),
			 ($2, $3, 'Support', 'active', $4, true, $5, now()),
			 ($6, $7, 'Foreign', 'active', $8, true, $9, now())`,
			[
				ids.website,
				ids.support,
				ORG,
				ids.customer,
				userOf(ids.owner),
				ids.foreignProject,
				OTHER_ORG,
				ids.foreignCustomer,
				userOf(ids.foreign),
			],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.website, ids.pm, userOf(ids.owner)],
		);
		await admin.query(
			`insert into billable_rate (organization_id, level, project_id, hourly_rate, effective_from) values
			 ($1, 'project', $2, 100.00, '2026-01-01'), ($1, 'project', $3, 80.00, '2026-01-01')`,
			[ORG, ids.website, ids.support],
		);

		const periods = new Map<string, string>();
		for (const employeeId of contractors) periods.set(employeeId, await contractor(employeeId));
		const periodOf = (employeeId: string) => periods.get(employeeId) ?? "";

		// Hourly terms with a rate change on 16 March.
		await terms(ids.hourly, periodOf(ids.hourly), {
			basis: "hourly",
			rate: "90",
			to: "2026-03-16",
		});
		await terms(ids.hourly, periodOf(ids.hourly), {
			basis: "hourly",
			rate: "100",
			from: "2026-03-16",
		});
		await work({
			employeeId: ids.hourly,
			projectId: ids.website,
			start: "2026-03-13T09:00:00Z",
			end: "2026-03-13T17:00:00Z",
		});
		await work({
			employeeId: ids.hourly,
			projectId: ids.website,
			start: "2026-03-16T09:00:00Z",
			end: "2026-03-16T11:30:00Z",
		});

		// Any day with work is a full day of 600.00, over 2 h Website, 1 h Support, 1 h non-billable.
		await terms(ids.fullDay, periodOf(ids.fullDay), {
			basis: "daily",
			rate: "600",
			rule: "any_work_full_day",
		});
		await work({
			employeeId: ids.fullDay,
			projectId: ids.website,
			start: "2026-03-02T08:00:00Z",
			end: "2026-03-02T10:00:00Z",
		});
		await work({
			employeeId: ids.fullDay,
			projectId: ids.support,
			start: "2026-03-02T10:00:00Z",
			end: "2026-03-02T11:00:00Z",
		});
		await work({
			employeeId: ids.fullDay,
			projectId: ids.website,
			start: "2026-03-02T11:00:00Z",
			end: "2026-03-02T12:00:00Z",
			billable: false,
		});

		// Half day (3 h up to 4 h) of 200.00 over three hours, then a full day.
		await terms(ids.halfDay, periodOf(ids.halfDay), {
			basis: "daily",
			rate: "200",
			rule: "half_and_full_day",
			threshold: 240,
		});
		for (const [projectId, start, end] of [
			[ids.website, "2026-03-02T08:00:00Z", "2026-03-02T09:00:00Z"],
			[ids.support, "2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"],
			[ids.website, "2026-03-02T10:00:00Z", "2026-03-02T11:00:00Z"],
			[ids.website, "2026-03-03T08:00:00Z", "2026-03-03T13:00:00Z"],
		]) {
			await work({ employeeId: ids.halfDay, projectId, start, end });
		}

		// Prorated by an 8 h day, uncapped: 10 h are 1.25 days of 800.00.
		await terms(ids.prorated, periodOf(ids.prorated), {
			basis: "daily",
			rate: "800",
			rule: "prorated_by_standard_day",
			standard: 480,
			cap: false,
		});
		await work({
			employeeId: ids.prorated,
			projectId: ids.website,
			start: "2026-03-02T08:00:00Z",
			end: "2026-03-02T15:00:00Z",
		});
		await work({
			employeeId: ids.prorated,
			projectId: ids.support,
			start: "2026-03-02T15:00:00Z",
			end: "2026-03-02T18:00:00Z",
		});

		// Prorated and capped: 10 h are one day of 800.00.
		await terms(ids.capped, periodOf(ids.capped), {
			basis: "daily",
			rate: "800",
			rule: "prorated_by_standard_day",
			standard: 480,
			cap: true,
		});
		await work({
			employeeId: ids.capped,
			projectId: ids.website,
			start: "2026-03-02T08:00:00Z",
			end: "2026-03-02T14:00:00Z",
		});
		await work({
			employeeId: ids.capped,
			projectId: ids.support,
			start: "2026-03-02T14:00:00Z",
			end: "2026-03-02T18:00:00Z",
		});

		// Explicit cost rates of 50.00 beside hourly and daily terms.
		await terms(ids.overriddenHourly, periodOf(ids.overriddenHourly), {
			basis: "hourly",
			rate: "90",
		});
		await terms(ids.overriddenDaily, periodOf(ids.overriddenDaily), {
			basis: "daily",
			rate: "600",
			rule: "any_work_full_day",
		});
		await admin.query(
			`insert into cost_rate (organization_id, employee_id, hourly_rate, effective_from) values
			 ($1, $2, 50.00, '2026-01-01'), ($1, $3, 50.00, '2026-01-01')`,
			[ORG, ids.overriddenHourly, ids.overriddenDaily],
		);
		for (const employeeId of [ids.overriddenHourly, ids.overriddenDaily]) {
			await work({
				employeeId,
				projectId: ids.website,
				start: "2026-03-02T09:00:00Z",
				end: "2026-03-02T11:00:00Z",
			});
		}

		// A contractor with neither terms nor a cost rate.
		await work({
			employeeId: ids.unpriced,
			projectId: ids.support,
			start: "2026-03-04T09:00:00Z",
			end: "2026-03-04T10:00:00Z",
		});

		// Another organization's contractor, terms and work never count.
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, engagement_kind, updated_at)
			 values ($1, $2, $3, 'admin', 'contractor', now())`,
			[ids.foreign, userOf(ids.foreign), OTHER_ORG],
		);
		const {
			rows: [foreignPeriod],
		} = await admin.query<{ id: string }>(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
			 values ($1, $2, 'open', '2026-01-01T00:00:00Z', 'recorded', 'contractor') returning id`,
			[OTHER_ORG, ids.foreign],
		);
		await terms(ids.foreign, foreignPeriod.id, {
			basis: "hourly",
			rate: "999",
			organizationId: OTHER_ORG,
		});
		await work({
			employeeId: ids.foreign,
			projectId: ids.foreignProject,
			organizationId: OTHER_ORG,
			start: "2026-03-02T09:00:00Z",
			end: "2026-03-02T11:00:00Z",
		});
	});
	afterAll(cleanup);

	async function costsByEmployee(projectId: string) {
		const report = await unwrap(getProjectDetailedReport(projectId, fromDay, toDay));
		return Object.fromEntries(
			report.employeeBreakdown.map((row) => [
				row.employeeId,
				row.billable?.access === "full"
					? {
							revenue: row.billable.revenue,
							cost: row.billable.cost,
							margin: row.billable.margin,
						}
					: null,
			]),
		);
	}

	it("costs contractors without a cost rate at their hourly terms across a rate change, revenue unchanged", async () => {
		actAs(ids.owner);
		const website = await costsByEmployee(ids.website);

		// Revenue 10.5 h × 100.00; cost 8 h × 90.00 + 2.5 h × 100.00.
		expect(website[ids.hourly]).toEqual({ revenue: "1050.00", cost: "970.00", margin: "80.00" });
	});

	it("lets an explicit cost rate win over hourly and daily contractor terms", async () => {
		actAs(ids.owner);
		const website = await costsByEmployee(ids.website);

		expect(website[ids.overriddenHourly]).toEqual({
			revenue: "200.00",
			cost: "100.00",
			margin: "100.00",
		});
		expect(website[ids.overriddenDaily]).toEqual({
			revenue: "200.00",
			cost: "100.00",
			margin: "100.00",
		});
	});

	it("splits each daily fee across the day's projects by duration, adding up to one fee", async () => {
		actAs(ids.owner);
		const website = await costsByEmployee(ids.website);
		const support = await costsByEmployee(ids.support);
		const cost = (rows: typeof website, employeeId: string) => rows[employeeId]?.cost;

		// any_work_full_day 600.00 over 4 h: the non-billable hour keeps its 150.00.
		expect([cost(website, ids.fullDay), cost(support, ids.fullDay)]).toEqual(["300.00", "150.00"]);
		// half_and_full_day: a half day of 100.00 over three hours (66.67 + 33.33), then a full 200.00.
		expect([cost(website, ids.halfDay), cost(support, ids.halfDay)]).toEqual(["266.67", "33.33"]);
		// prorated, uncapped: 1.25 days = 1000.00 over 7 h and 3 h.
		expect([cost(website, ids.prorated), cost(support, ids.prorated)]).toEqual([
			"700.00",
			"300.00",
		]);
		// prorated, capped: one day of 800.00 over 6 h and 4 h.
		expect([cost(website, ids.capped), cost(support, ids.capped)]).toEqual(["480.00", "320.00"]);
	});

	it("keeps margin unknown, never zero, for contractor work with neither terms nor a cost rate", async () => {
		actAs(ids.owner);
		const support = await costsByEmployee(ids.support);
		const overview = await unwrap(getProjectsOverview(fromDay, toDay));
		const supportTotals = overview.projects.find((row) => row.id === ids.support)?.billable;

		expect(support[ids.unpriced]).toEqual({ revenue: "80.00", cost: null, margin: null });
		expect(supportTotals).toMatchObject({ cost: null, margin: null, costUnknownWorkCount: 1 });
	});

	it("shares a contractor-local day fee with night work that started before the report's first day", async () => {
		// Neither the organization's zone nor UTC decides the day: the contractor works at +09:00.
		await admin.query("update organization set timezone = 'America/New_York' where id = $1", [ORG]);
		const periodId = await contractor(ids.tokyo);
		await terms(ids.tokyo, periodId, {
			basis: "daily",
			rate: "480",
			rule: "any_work_full_day",
			from: "2026-02-01",
		});
		const tokyo = { employeeId: ids.tokyo, offsetMinutes: 540, timezone: "Asia/Tokyo" };
		// 28 Feb 23:00 – 1 Mar 03:00 Tokyo: starts before the report, 3 h of it on 1 March.
		await work({
			...tokyo,
			projectId: ids.website,
			start: "2026-02-28T14:00:00Z",
			end: "2026-02-28T18:00:00Z",
		});
		// 1 Mar 09:00 – 10:00 Tokyo, in the report.
		await work({
			...tokyo,
			projectId: ids.website,
			start: "2026-03-01T00:00:00Z",
			end: "2026-03-01T01:00:00Z",
		});
		actAs(ids.owner);
		const website = await costsByEmployee(ids.website);

		// One fee of 480.00 for 1 March over 3 h + 1 h: the reported hour carries 120.00.
		expect(website[ids.tokyo]).toEqual({ revenue: "100.00", cost: "120.00", margin: "-20.00" });
	});

	it("keeps margin unknown for contractor terms in another currency than the billable one", async () => {
		const periodId = await contractor(ids.usd);
		await terms(ids.usd, periodId, { basis: "hourly", rate: "90", currency: "USD" });
		await work({
			employeeId: ids.usd,
			projectId: ids.website,
			start: "2026-03-09T09:00:00Z",
			end: "2026-03-09T11:00:00Z",
		});
		actAs(ids.owner);
		const report = await unwrap(getProjectDetailedReport(ids.website, fromDay, toDay));
		const website = await costsByEmployee(ids.website);

		expect(website[ids.usd]).toEqual({ revenue: "200.00", cost: null, margin: null });
		expect(report.summary.billable).toMatchObject({ cost: null, costUnknownWorkCount: 1 });
	});

	it("keeps margin unknown for work that started before the contractor engagement", async () => {
		const periodId = await contractor(ids.lateStart, "2026-03-05T12:00:00Z");
		await terms(ids.lateStart, periodId, { basis: "hourly", rate: "90", from: "2026-03-04" });
		// 10:00 – 14:00 UTC: only the two hours from noon are contractor work.
		await work({
			employeeId: ids.lateStart,
			projectId: ids.website,
			start: "2026-03-05T10:00:00Z",
			end: "2026-03-05T14:00:00Z",
		});
		actAs(ids.owner);
		const report = await unwrap(getProjectDetailedReport(ids.website, fromDay, toDay));
		const website = await costsByEmployee(ids.website);

		expect(website[ids.lateStart]).toEqual({ revenue: "400.00", cost: null, margin: null });
		expect(report.summary.billable).toMatchObject({ cost: null, costUnknownWorkCount: 1 });
	});

	it("rolls a known project cost up from the contractors' allocated fees", async () => {
		await admin.query("delete from work_period where employee_id = $1", [ids.unpriced]);
		actAs(ids.owner);
		const overview = await unwrap(getProjectsOverview(fromDay, toDay));
		const support = overview.projects.find((row) => row.id === ids.support)?.billable;
		const customers = await unwrap(getCustomerBillableReport(fromDay, toDay));

		// 150.00 + 33.33 + 300.00 + 320.00 against 9 h × 80.00.
		expect(support).toMatchObject({
			revenue: "720.00",
			cost: "803.33",
			margin: "-83.33",
			costUnknownWorkCount: 0,
		});
		expect(
			customers.customers[0]?.projects.find((row) => row.project.id === ids.support)?.billable,
		).toMatchObject({ cost: "803.33" });
	});

	it("never shows contractor cost to project managers, team managers or contractors", async () => {
		const leaks = /"(cost|margin|marginPercent|costUnknownWorkCount|rateMinor|compensation)"/;

		actAs(ids.pm);
		const overview = await unwrap(getProjectsOverview(fromDay, toDay));
		const report = await unwrap(getProjectDetailedReport(ids.website, fromDay, toDay));
		expect(report.summary.billable).toMatchObject({ access: "revenue" });
		expect(JSON.stringify([overview, report])).not.toMatch(leaks);

		actAs(ids.teamManager);
		const managerView = await unwrap(getProjectDetailedReport(ids.website, fromDay, toDay));
		expect(managerView.summary.billable).toBeUndefined();
		expect(JSON.stringify(managerView)).not.toMatch(leaks);

		actAs(ids.fullDay);
		for (const result of [
			await getProjectsOverview(fromDay, toDay),
			await getProjectDetailedReport(ids.website, fromDay, toDay),
		]) {
			expect(JSON.stringify(result)).not.toMatch(leaks);
			expect(JSON.stringify(result)).not.toMatch(/"revenue"/);
		}
	});
});
