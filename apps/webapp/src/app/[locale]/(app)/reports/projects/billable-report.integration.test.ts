/**
 * #902: billable hours, revenue and margin in project reports and the
 * customer view, on PostgreSQL. The real server actions, rate readers and
 * report readers run; only the session, SSO store and logger are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t902-org",
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
								id: `t902-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
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

const { getCustomerBillableReport, getProjectDetailedReport, getProjectsOverview } = await import(
	"./actions"
);
const { exportReportDocumentToCSV } = await import("@/lib/reports/exporters/report-document-csv");
const {
	buildCustomerReportDocument,
	buildProjectReportDocument,
	DEFAULT_PROJECT_REPORT_EXPORT_LABELS,
} = await import("@/lib/reports/project-report-export");

const ids = {
	organization: "t902-org",
	otherOrganization: "t902-other-org",
	ownerUser: "t902-owner-user",
	pmUser: "t902-pm-user",
	teamManagerUser: "t902-team-manager-user",
	workerUser: "t902-worker-user",
	otherUser: "t902-other-user",
	owner: "90200000-0000-4000-8000-000000000001",
	pm: "90200000-0000-4000-8000-000000000002",
	teamManager: "90200000-0000-4000-8000-000000000003",
	worker: "90200000-0000-4000-8000-000000000004",
	otherEmployee: "90200000-0000-4000-8000-000000000005",
	customer: "90200000-0000-4000-8000-0000000000c1",
	otherCustomer: "90200000-0000-4000-8000-0000000000c2",
	website: "90200000-0000-4000-8000-0000000000a1",
	support: "90200000-0000-4000-8000-0000000000a2",
	internal: "90200000-0000-4000-8000-0000000000a3",
	foreignProject: "90200000-0000-4000-8000-0000000000a4",
} as const;
const users = [ids.ownerUser, ids.pmUser, ids.teamManagerUser, ids.workerUser, ids.otherUser];
const rangeStart = new Date("2026-03-01");
const rangeEnd = new Date("2026-04-30");

function actAs(userId: string) {
	harness.userId = userId;
	harness.organizationId = ids.organization;
}

async function unwrap<T>(
	result: Promise<{ success: true; data: T } | { success: false; error: string }>,
) {
	const settled = await result;
	if (!settled.success) throw new Error(settled.error);
	return settled.data;
}

describe("billable project reports on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		for (const organizationId of [ids.organization, ids.otherOrganization]) {
			await admin.query("delete from approval_request where organization_id = $1", [
				organizationId,
			]);
			await admin.query("delete from work_period where organization_id = $1", [organizationId]);
			await admin.query("delete from time_entry where organization_id = $1", [organizationId]);
		}
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function work(options: {
		employeeId: string;
		projectId: string;
		start: string;
		end?: string;
		minutes?: number;
		billable?: boolean;
		offsetMinutes?: number;
		deleted?: boolean;
		pending?: boolean;
		organizationId?: string;
	}) {
		const organizationId = options.organizationId ?? ids.organization;
		const clockInId = randomUUID();
		const clockOutId = options.end ? randomUUID() : null;
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", options.start],
			...(clockOutId ? [[clockOutId, "clock_out", options.end]] : []),
		]) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, $6, 'Etc/UTC', 'user_setting', $8, $7)`,
				[
					entryId,
					options.employeeId,
					organizationId,
					type,
					timestamp,
					options.offsetMinutes ?? 0,
					ids.ownerUser,
					`hash-${entryId}`,
				],
			);
		}
		const id = randomUUID();
		await admin.query(
			`insert into work_period
			 (id, employee_id, organization_id, clock_in_id, clock_out_id, project_id, is_billable, start_time,
			  end_time, duration_minutes, is_active, approval_status, deleted_at, deleted_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())`,
			[
				id,
				options.employeeId,
				organizationId,
				clockInId,
				clockOutId,
				options.projectId,
				options.billable ?? true,
				options.start,
				options.end ?? null,
				options.minutes ?? null,
				!options.end,
				options.pending ? "pending" : "approved",
				options.deleted ? "2026-05-01T00:00:00Z" : null,
				options.deleted ? ids.ownerUser : null,
			],
		);
		return id;
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, billable_time_enabled, created_at)
			 values ($1, 'T902', $1, 'UTC', true, true, now()), ($2, 'T902 other', $2, 'UTC', true, true, now())`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR'), ($2, 'EUR')`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t902-m-owner', $1, $2, 'owner', 'approved', now()),
			 ('t902-m-pm', $1, $3, 'member', 'approved', now()),
			 ('t902-m-tm', $1, $4, 'member', 'approved', now()),
			 ('t902-m-worker', $1, $5, 'member', 'approved', now()),
			 ('t902-m-other', $6, $7, 'owner', 'approved', now())`,
			[
				ids.organization,
				ids.ownerUser,
				ids.pmUser,
				ids.teamManagerUser,
				ids.workerUser,
				ids.otherOrganization,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'admin', now()),
			 ($3, $4, $11, 'employee', now()),
			 ($5, $6, $11, 'manager', now()),
			 ($7, $8, $11, 'employee', now()),
			 ($9, $10, $12, 'admin', now())`,
			[
				ids.owner,
				ids.ownerUser,
				ids.pm,
				ids.pmUser,
				ids.teamManager,
				ids.teamManagerUser,
				ids.worker,
				ids.workerUser,
				ids.otherEmployee,
				ids.otherUser,
				ids.organization,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at) values
			 ($1, $2, 'Acme', $3, now()), ($4, $5, 'Foreign customer', $6, now())`,
			[
				ids.customer,
				ids.organization,
				ids.ownerUser,
				ids.otherCustomer,
				ids.otherOrganization,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, customer_id, billable_default, created_by, updated_at) values
			 ($1, $5, 'Website', 'active', $6, true, $7, now()),
			 ($2, $5, 'Support', 'active', $6, true, $7, now()),
			 ($3, $5, 'Internal', 'active', null, false, $7, now()),
			 ($4, $8, 'Foreign', 'active', $9, true, $10, now())`,
			[
				ids.website,
				ids.support,
				ids.internal,
				ids.foreignProject,
				ids.organization,
				ids.customer,
				ids.ownerUser,
				ids.otherOrganization,
				ids.otherCustomer,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.website, ids.pm, ids.ownerUser],
		);
		await admin.query(
			`insert into billable_rate (organization_id, level, project_id, hourly_rate, effective_from, effective_to) values
			 ($1, 'project', $2, 100.00, '2026-01-01', '2026-04-01'),
			 ($1, 'project', $2, 120.00, '2026-04-01', null),
			 ($3, 'project', $4, 999.00, '2026-01-01', null)`,
			[ids.organization, ids.website, ids.otherOrganization, ids.foreignProject],
		);
		await admin.query(
			`insert into cost_rate (organization_id, employee_id, hourly_rate, effective_from) values ($1, $2, 50.00, '2026-01-01')`,
			[ids.organization, ids.worker],
		);

		// Website: 7h billable (440 + 200 + 100 revenue), 1h non-billable.
		await work({
			employeeId: ids.worker,
			projectId: ids.website,
			start: "2026-03-31T22:00:00Z",
			end: "2026-04-01T02:00:00Z",
			minutes: 240,
		});
		const nonBillable = await work({
			employeeId: ids.worker,
			projectId: ids.website,
			start: "2026-03-10T08:00:00Z",
			end: "2026-03-10T09:00:00Z",
			minutes: 60,
			billable: false,
		});
		await work({
			employeeId: ids.worker,
			projectId: ids.website,
			start: "2026-03-12T08:00:00Z",
			end: "2026-03-12T10:00:00Z",
			minutes: 120,
			pending: true,
		});
		// Local 2026-03-01 00:30 at UTC+01:00, still February in UTC: counted, on March 1st.
		await work({
			employeeId: ids.worker,
			projectId: ids.website,
			start: "2026-02-28T23:30:00Z",
			end: "2026-03-01T00:30:00Z",
			minutes: 60,
			offsetMinutes: 60,
		});
		// Not counted: deleted, live, and local May 1st although April in UTC.
		await work({
			employeeId: ids.worker,
			projectId: ids.website,
			start: "2026-03-11T08:00:00Z",
			end: "2026-03-11T11:00:00Z",
			minutes: 180,
			deleted: true,
		});
		await work({ employeeId: ids.worker, projectId: ids.website, start: "2026-03-20T08:00:00Z" });
		await work({
			employeeId: ids.worker,
			projectId: ids.website,
			start: "2026-04-30T23:30:00Z",
			end: "2026-05-01T00:30:00Z",
			minutes: 60,
			offsetMinutes: 60,
		});
		// Support: 2h billable without any rate, by an employee without a cost rate.
		await work({
			employeeId: ids.pm,
			projectId: ids.support,
			start: "2026-03-15T08:00:00Z",
			end: "2026-03-15T10:00:00Z",
			minutes: 120,
		});
		// Internal has no customer: marked billable, shown as billable without customer.
		await work({
			employeeId: ids.worker,
			projectId: ids.internal,
			start: "2026-03-16T08:00:00Z",
			end: "2026-03-16T09:00:00Z",
			minutes: 60,
		});
		// A pending correction request on the non-billable work.
		await admin.query(
			`insert into approval_request (organization_id, entity_type, entity_id, requested_by, approver_id, status, updated_at)
			 values ($1, 'time_entry', $2, $3, $4, 'pending', now())`,
			[ids.organization, nonBillable, ids.worker, ids.owner],
		);
		// Another organization's work never counts.
		await work({
			organizationId: ids.otherOrganization,
			employeeId: ids.otherEmployee,
			projectId: ids.foreignProject,
			start: "2026-03-10T08:00:00Z",
			end: "2026-03-10T18:00:00Z",
			minutes: 600,
		});
	});
	afterAll(cleanup);

	const websiteFull = {
		access: "full",
		currency: "EUR",
		billableHours: 7,
		nonBillableHours: 1,
		unpricedWorkCount: 0,
		pendingReviewCount: 2,
		revenue: "740.00",
		cost: "350.00",
		margin: "390.00",
		marginPercent: "52.7",
		costUnknownWorkCount: 0,
	};

	it("gives owners revenue, cost and margin per project, with unpriced work and unknown cost flagged", async () => {
		actAs(ids.ownerUser);
		const overview = await unwrap(getProjectsOverview(rangeStart, rangeEnd));
		const byId = new Map(overview.projects.map((summary) => [summary.id, summary]));

		expect(byId.get(ids.website)).toMatchObject({
			totalMinutes: 480,
			workPeriodCount: 4,
			customer: { id: ids.customer, name: "Acme" },
			billable: websiteFull,
		});
		expect(byId.get(ids.support)?.billable).toMatchObject({
			billableHours: 2,
			revenue: "0.00",
			unpricedWorkCount: 1,
			unpricedHours: 2,
			cost: null,
			margin: null,
			marginPercent: null,
			costUnknownWorkCount: 1,
		});
		expect(byId.get(ids.internal)?.billable).toMatchObject({
			billableHours: 0,
			nonBillableHours: 0,
			withoutCustomerHours: 1,
			withoutCustomerWorkCount: 1,
			revenue: "0.00",
		});
		expect(overview.totals.billable).toMatchObject({
			billableHours: 9,
			nonBillableHours: 1,
			withoutCustomerHours: 1,
			revenue: "740.00",
			cost: null,
			margin: null,
			unpricedWorkCount: 1,
		});
		expect(overview.billableTime).toMatchObject({ currency: "EUR" });
	});

	it("keys the detail report on the employee-local day of each start, with per-employee figures", async () => {
		actAs(ids.ownerUser);
		const report = await unwrap(getProjectDetailedReport(ids.website, rangeStart, rangeEnd));

		expect(report.summary).toMatchObject({ totalMinutes: 480, billable: websiteFull });
		expect(report.timeSeries.map(({ date, hours }) => [date, hours])).toEqual([
			["2026-03-01", 1],
			["2026-03-10", 1],
			["2026-03-12", 2],
			["2026-03-31", 4],
		]);
		expect(report.employeeBreakdown).toEqual([
			expect.objectContaining({
				employeeId: ids.worker,
				billable: expect.objectContaining(websiteFull),
			}),
		]);
	});

	it("gives project managers hours and revenue for their projects, with no cost or margin field", async () => {
		actAs(ids.pmUser);
		const overview = await unwrap(getProjectsOverview(rangeStart, rangeEnd));
		const report = await unwrap(getProjectDetailedReport(ids.website, rangeStart, rangeEnd));
		const customers = await unwrap(getCustomerBillableReport(rangeStart, rangeEnd));

		expect(overview.projects.map((summary) => summary.id)).toEqual([ids.website]);
		expect(overview.projects[0]?.billable).toMatchObject({
			access: "revenue",
			billableHours: 7,
			nonBillableHours: 1,
			revenue: "740.00",
		});
		expect(report.summary.billable).toMatchObject({ access: "revenue", revenue: "740.00" });
		expect(customers.customers.map((row) => row.projects.map((p) => p.project.id))).toEqual([
			[ids.website],
		]);
		for (const data of [overview, report, customers]) {
			expect(JSON.stringify(data)).not.toMatch(
				/"(cost|margin|marginPercent|costUnknownWorkCount)"/,
			);
		}
		// Their exports are built from the same data, so they carry no cost or margin either.
		const context = { labels: DEFAULT_PROJECT_REPORT_EXPORT_LABELS, generatedAt: "now" };
		for (const csv of [
			exportReportDocumentToCSV(buildProjectReportDocument(report, context)),
			exportReportDocumentToCSV(buildCustomerReportDocument(customers, context)),
		]) {
			expect(csv).toContain("Revenue (EUR)");
			expect(csv).not.toMatch(/cost|margin/i);
		}

		const otherProject = await getProjectDetailedReport(ids.support, rangeStart, rangeEnd);
		expect(otherProject.success).toBe(false);
	});

	it("shows team managers who manage no project nothing more than hours", async () => {
		actAs(ids.teamManagerUser);
		const overview = await unwrap(getProjectsOverview(rangeStart, rangeEnd));
		const report = await unwrap(getProjectDetailedReport(ids.website, rangeStart, rangeEnd));

		expect(overview.projects).toHaveLength(3);
		expect(overview.projects.every((summary) => summary.billable === undefined)).toBe(true);
		expect(overview.totals.billable).toBeUndefined();
		expect(report.summary.billable).toBeUndefined();
		expect(JSON.stringify([overview, report])).not.toMatch(/revenue|billableHours/);
		expect((await getCustomerBillableReport(rangeStart, rangeEnd)).success).toBe(false);
	});

	it("rolls figures up per customer, its totals the sum of its projects", async () => {
		actAs(ids.ownerUser);
		const view = await unwrap(getCustomerBillableReport(rangeStart, rangeEnd));

		expect(view.access).toBe("full");
		expect(view.customers).toHaveLength(1);
		const [acme] = view.customers;
		expect(acme?.customer).toEqual({ id: ids.customer, name: "Acme" });
		expect(acme?.projects.map((row) => row.project.id)).toEqual([ids.support, ids.website]);
		expect(acme?.billable).toMatchObject({
			billableHours: 9,
			nonBillableHours: 1,
			revenue: "740.00",
			unpricedWorkCount: 1,
			unpricedHours: 2,
			pendingReviewCount: 2,
			cost: null,
			margin: null,
		});
		expect(acme?.totalMinutes).toBe(
			(acme?.projects ?? []).reduce((sum, row) => sum + row.totalMinutes, 0),
		);
		// Billable work on Internal (no customer) is listed apart, never under a customer.
		expect(view.withoutCustomer?.projects.map((row) => row.project.id)).toEqual([ids.internal]);
		expect(view.withoutCustomer?.billable).toMatchObject({
			billableHours: 0,
			withoutCustomerHours: 1,
			revenue: "0.00",
		});
		expect(view.totals.billable).toMatchObject({
			billableHours: 9,
			withoutCustomerHours: 1,
			revenue: "740.00",
		});
		expect(view.totals.totalMinutes).toBe((acme?.totalMinutes ?? 0) + 60);
	});

	it("treats a deleted customer's projects as without customer", async () => {
		await admin.query("update customer set is_active = false where id = $1", [ids.customer]);
		actAs(ids.ownerUser);

		const overview = await unwrap(getProjectsOverview(rangeStart, rangeEnd));
		const website = overview.projects.find((summary) => summary.id === ids.website);
		expect(website?.customer).toBeNull();
		expect(website?.billable).toMatchObject({
			billableHours: 0,
			withoutCustomerHours: 7,
			revenue: "0.00",
		});

		const view = await unwrap(getCustomerBillableReport(rangeStart, rangeEnd));
		expect(view.customers).toEqual([]);
		expect(view.withoutCustomer?.projects.map((row) => row.project.id)).toEqual([
			ids.internal,
			ids.support,
			ids.website,
		]);
	});

	it("shows no Billable Time figures while the module is off", async () => {
		await admin.query("update organization set billable_time_enabled = false where id = $1", [
			ids.organization,
		]);
		actAs(ids.ownerUser);
		const overview = await unwrap(getProjectsOverview(rangeStart, rangeEnd));
		const report = await unwrap(getProjectDetailedReport(ids.website, rangeStart, rangeEnd));

		expect(overview.projects.every((summary) => summary.billable === undefined)).toBe(true);
		expect(report.summary.billable).toBeUndefined();
		expect(report.billableTime).toBeUndefined();
		expect((await getCustomerBillableReport(rangeStart, rangeEnd)).success).toBe(false);
	});

	it("never reads another organization's projects", async () => {
		actAs(ids.ownerUser);
		const foreign = await getProjectDetailedReport(ids.foreignProject, rangeStart, rangeEnd);
		const overview = await unwrap(getProjectsOverview(rangeStart, rangeEnd));

		expect(foreign.success).toBe(false);
		expect(overview.projects.map((summary) => summary.id)).not.toContain(ids.foreignProject);
	});
});
