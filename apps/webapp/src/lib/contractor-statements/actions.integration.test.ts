/**
 * Contractor statement exports against PostgreSQL (#2000): who may download
 * whose Contractor Time & Fee Statement. Org admins export any contractor of
 * their organization; a contractor exports only their own, without Billable
 * Time rates, cost rates or margins; scoped managers and other members are
 * refused before anything is read, so contractor rates and fee totals never
 * reach them. Only the request/session, the SSO/MFA gate and the request
 * language are replaced.
 */
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { avvPdfText as pdfText } from "@/lib/avv/avv-pdf.test.fixture";
import { changeContractorTerms } from "@/lib/contractor-compensation/store";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	activeOrganizationId: null as string | null,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user", name: "Caller", email: "c@example.test" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.activeOrganizationId,
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
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: async (href: string) => {
		throw new Error(`redirect:${href}`);
	},
}));
// The request language: the statement is written in it.
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/tolgee/server", async () => ({
	getTranslate: async () => (await import("./testing/statement.test.fixture")).catalogT("en"),
}));

const { exportContractorStatement } = await import("./actions");

const decode = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));

describe("contractor statement exports on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let contractorId: string;
	let otherContractorId: string;
	let employeeId: string;
	const users: Record<string, string> = {};

	async function completedWork(employee: string, start: string, end: string, projectId: string) {
		const clockIn = randomUUID();
		const clockOut = randomUUID();
		const minutes = Temporal.Instant.from(end).since(Temporal.Instant.from(start)).total("minutes");
		await withCanonicalRecords(fixture.pool, async (client) => {
			for (const [id, type, timestamp] of [
				[clockIn, "clock_in", start],
				[clockOut, "clock_out", end],
			]) {
				await client.query(
					`insert into time_entry (id, employee_id, organization_id, type, timestamp,
					 utc_offset_minutes, timezone, timezone_source, hash, created_by)
					 values ($1::uuid, $2, $3, $4, $5, 60, 'Europe/Berlin', 'user_setting', $1::uuid::text, $6)`,
					[id, employee, fixture.organizationId, type, timestamp, fixture.ownerUserId],
				);
			}
			await client.query(
				`insert into work_period (employee_id, organization_id, clock_in_id, clock_out_id,
				 start_time, end_time, duration_minutes, is_active, project_id, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, false, $8, now())`,
				[employee, fixture.organizationId, clockIn, clockOut, start, end, minutes, projectId],
			);
		});
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		users.admin = (await fixture.seedEmployee({ role: "admin" })).userId;

		const contractor = await fixture.seedEmployee({ engagementKind: "contractor" });
		contractorId = contractor.employeeId;
		users.contractor = contractor.userId;
		const other = await fixture.seedEmployee({ engagementKind: "contractor" });
		otherContractorId = other.employeeId;
		users.otherContractor = other.userId;
		const employee = await fixture.seedEmployee();
		employeeId = employee.employeeId;
		users.employee = employee.userId;

		// A scoped manager who manages the contractor directly.
		const manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[contractorId, manager.employeeId, fixture.ownerUserId],
		);
		users.scopedManager = manager.userId;

		const otherOrganization = await fixture.createOrganization();
		users.otherOwner = (
			await fixture.seedEmployee({ organizationId: otherOrganization, role: "owner" })
		).userId;
		users.otherOrganization = otherOrganization;

		// A billable customer project with a Billable Time billable rate and a cost rate
		// for the contractor: neither may appear on the statement.
		const customerId = randomUUID();
		await fixture.pool.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Big Customer', $3, now())`,
			[customerId, fixture.organizationId, fixture.ownerUserId],
		);
		const projectId = randomUUID();
		await fixture.pool.query(
			`insert into project (id, organization_id, name, status, customer_id, billable_default,
			 created_by, updated_at)
			 values ($1, $2, 'Customer Portal', 'active', $3, true, $4, now())`,
			[projectId, fixture.organizationId, customerId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into billable_rate (organization_id, level, project_id, hourly_rate, effective_from)
			 values ($1, 'project', $2, 173.37, '2026-01-01')`,
			[fixture.organizationId, projectId],
		);
		await fixture.pool.query(
			`insert into cost_rate (organization_id, employee_id, hourly_rate, effective_from)
			 values ($1, $2, 61.19, '2026-01-01')`,
			[fixture.organizationId, contractorId],
		);

		for (const id of [contractorId, otherContractorId]) {
			const outcome = await changeContractorTerms(db, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: id,
				change: {
					kind: "set",
					effectiveFrom: "2026-03-01",
					compensation: { basis: "hourly", rateAmount: "85", currency: "EUR" },
				},
			});
			if (!outcome.ok) throw new Error(outcome.reason);
		}
		await completedWork(contractorId, "2026-03-02T08:00:00Z", "2026-03-02T12:00:00Z", projectId);
		await completedWork(
			otherContractorId,
			"2026-03-03T08:00:00Z",
			"2026-03-03T10:00:00Z",
			projectId,
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function signIn(userId: string, organizationId = fixture.organizationId) {
		harness.userId = userId;
		harness.activeOrganizationId = organizationId;
	}

	const march = { fromDay: "2026-03-01", toDay: "2026-03-31" };

	it("lets an org admin export any contractor's statement as CSV and PDF", async () => {
		signIn(users.admin);

		const csv = await exportContractorStatement({
			employeeId: contractorId,
			...march,
			format: "csv",
		});
		expect(csv).toMatchObject({
			success: true,
			data: { contentType: "text/csv; charset=utf-8" },
		});
		if (!csv.success) throw new Error("export failed");
		expect(csv.data.filename).toMatch(/^contractor-statement-.+-2026-03-01-2026-03-31\.csv$/);
		const text = Buffer.from(csv.data.base64, "base64").toString("utf8");
		expect(text).toContain("Contractor Time & Fee Verification Statement");
		expect(text).toContain('"Total","","","","","",240,"","","","EUR",4.0000,"Hours",340.00');

		const pdf = await exportContractorStatement({
			employeeId: otherContractorId,
			...march,
			format: "pdf",
		});
		if (!pdf.success) throw new Error("export failed");
		expect(pdf.data.contentType).toBe("application/pdf");
		const pdfContent = (await pdfText(decode(pdf.data.base64))).replace(/\s+/g, " ");
		expect(pdfContent).toContain("Not an invoice");
		expect(pdfContent).toContain("€170.00");
	});

	it("lets a contractor export their own statement without billable rates, cost rates or margins", async () => {
		signIn(users.contractor);

		const own = await exportContractorStatement({
			employeeId: contractorId,
			...march,
			format: "csv",
		});
		if (!own.success) throw new Error("export failed");
		const text = Buffer.from(own.data.base64, "base64").toString("utf8");
		expect(text).toContain("Customer Portal");
		expect(text).toContain("85.00");
		for (const hidden of ["173.37", "173,37", "61.19", "61,19", "Big Customer", "argin"]) {
			expect(text).not.toContain(hidden);
		}

		const ownPdf = await exportContractorStatement({
			employeeId: contractorId,
			...march,
			format: "pdf",
		});
		if (!ownPdf.success) throw new Error("export failed");
		const pdfContent = (await pdfText(decode(ownPdf.data.base64))).replace(/\s+/g, " ");
		expect(pdfContent).toContain("€340.00");
		for (const hidden of ["173.37", "61.19", "Big Customer", "argin"]) {
			expect(pdfContent).not.toContain(hidden);
		}
	});

	it("refuses a contractor another contractor's statement", async () => {
		signIn(users.contractor);
		expect(
			await exportContractorStatement({ employeeId: otherContractorId, ...march, format: "csv" }),
		).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("refuses scoped managers and members contractor statements, even of people they manage", async () => {
		for (const caller of [users.scopedManager, users.employee]) {
			signIn(caller);
			for (const format of ["csv", "pdf"] as const) {
				expect(
					await exportContractorStatement({ employeeId: contractorId, ...march, format }),
				).toMatchObject({ success: false, code: "AuthorizationError" });
			}
		}
	});

	it("refuses an employee's own statement: they have no contractor engagement", async () => {
		signIn(users.employee);
		expect(await exportContractorStatement({ employeeId, ...march, format: "csv" })).toMatchObject({
			success: false,
			refusal: "not_contractor",
		});
	});

	it("never exports another organization's contractor", async () => {
		signIn(users.otherOwner, users.otherOrganization);
		expect(
			await exportContractorStatement({ employeeId: contractorId, ...march, format: "csv" }),
		).toMatchObject({ success: false, code: "NotFoundError" });
	});

	it("refuses an invalid period", async () => {
		signIn(users.admin);
		expect(
			await exportContractorStatement({
				employeeId: contractorId,
				fromDay: "2026-03-31",
				toDay: "2026-03-01",
				format: "csv",
			}),
		).toMatchObject({ success: false, refusal: "invalid_period" });
	});
});
