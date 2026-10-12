/**
 * #1001 follow-ups (2026-10-10), against a disposable PostgreSQL database:
 * a payroll grant holder's export covers employees of the grant who left
 * during or after the export's dates, so their final payouts reach payroll;
 * and the payroll workspace warns before exporting when the format has no
 * "overtime" wage type while payouts exist in the range. Exports run through
 * the real payroll workspace actions; only the session, the queue and object
 * storage are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({ userId: null as string | null }));

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
								id: `t1001x-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: "t1001x-org",
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadExport: async () => undefined,
	getPresignedUrl: async () => "https://exports.test/file",
}));
vi.mock("@/lib/queue", () => ({ addJob: async () => ({ id: "queued" }) }));

const {
	getOvertimePayoutExportReadinessAction,
	getConfiguredPayrollExportFormatsAction,
	getPayrollExportScopeAction,
	getPayrollWorkspaceSummaryAction,
	startScopedPayrollExportAction,
} = await import("@/app/[locale]/(app)/payroll/actions");

const admin = integrationAdminPool();
const ORG = "t1001x-org";
const users = [
	"t1001x-owner",
	"t1001x-holder",
	"t1001x-worker",
	"t1001x-left-in",
	"t1001x-left-after",
	"t1001x-left-before",
	"t1001x-deactivated",
	"t1001x-former-holder",
];
const ids = {
	owner: "d1001100-0000-4000-8000-000000000001",
	holder: "d1001100-0000-4000-8000-000000000002",
	worker: "d1001100-0000-4000-8000-000000000003",
	leftInRange: "d1001100-0000-4000-8000-000000000004",
	leftAfterRange: "d1001100-0000-4000-8000-000000000005",
	leftBeforeRange: "d1001100-0000-4000-8000-000000000006",
	deactivated: "d1001100-0000-4000-8000-000000000007",
	formerHolder: "d1001100-0000-4000-8000-000000000008",
} as const;
const july = { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" };
const HEADER = '"Personalnummer";"Lohnart";"Betrag";"Datum";"Bemerkung"';

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id = any($1::text[])', [users]);
}

async function employee(id: string, userId: string, number: string, isActive: boolean) {
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, employee_number, is_active, updated_at)
		 values ($1, $2, $3, 'employee', $4, $5, now())`,
		[id, userId, ORG, number, isActive],
	);
}

/** An effective departure whose last working day is `lastWorkingDay` (Europe/Berlin). */
async function departed(employeeId: string, lastWorkingDay: string) {
	const cutoff = `${lastWorkingDay}T22:00:00Z`; // the next local midnight in summer time
	const { rows } = await admin.query(
		`insert into employee_employment_period
		   (organization_id, employee_id, status, started_at, ended_at, start_provenance)
		 values ($1, $2, 'closed', '2026-01-01T00:00:00Z', $3, 'recorded') returning id`,
		[ORG, employeeId, cutoff],
	);
	await admin.query(
		`insert into employee_departure
		   (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
		    cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
		 values ($1, $2, $3, 'scheduled', $4, 'Europe/Berlin', $5, 't1001x-owner', gen_random_uuid(),
		         'test', 1, 'effective', $5)`,
		[ORG, employeeId, rows[0].id, lastWorkingDay, cutoff],
	);
}

async function payout(employeeId: string, day: string, minutes: number, cancelled = false) {
	const { rows } = await admin.query(
		`insert into balance_adjustment (organization_id, employee_id, kind, day, minutes, reason, recorded_by)
		 values ($1, $2, 'overtime_payout', $3, $4, 'Final payout', 't1001x-owner') returning id`,
		[ORG, employeeId, day, -minutes],
	);
	if (cancelled) {
		await admin.query(
			`update balance_adjustment set cancelled_at = now(), cancelled_by = 't1001x-owner',
			 cancellation_reason = 'Recorded twice' where id = $1`,
			[rows[0].id],
		);
	}
}

async function mapOvertime(codes: { datev?: string; lexware?: string }) {
	await admin.query(
		`insert into payroll_wage_type_mapping
		   (organization_id, special_category, wage_type_code, datev_wage_type_code, lexware_wage_type_code, created_by, updated_at)
		 values ($1, 'overtime', $2, $3, $4, 't1001x-owner', now())`,
		[ORG, codes.datev ?? codes.lexware ?? "", codes.datev ?? null, codes.lexware ?? null],
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', '2026-01-01')`,
		[ORG],
	);
	await admin.query(
		`insert into "user" (id, name, email, created_at, updated_at)
		 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
		[users],
	);
	await admin.query(
		`insert into member (id, organization_id, user_id, role, status, created_at) values
		 ('t1001x-m-owner', $1, 't1001x-owner', 'owner', 'approved', now()),
		 ('t1001x-m-holder', $1, 't1001x-holder', 'member', 'approved', now()),
		 ('t1001x-m-worker', $1, 't1001x-worker', 'member', 'approved', now()),
		 ('t1001x-m-former-holder', $1, 't1001x-former-holder', 'member', 'approved', now())`,
		[ORG],
	);
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, employee_number, updated_at)
		 values ($1, 't1001x-owner', $2, 'admin', 'OWN-1', now())`,
		[ids.owner, ORG],
	);
	await employee(ids.holder, "t1001x-holder", "HLD-1", true);
	await employee(ids.worker, "t1001x-worker", "WRK-1", true);
	await employee(ids.leftInRange, "t1001x-left-in", "LIN-1", false);
	await employee(ids.leftAfterRange, "t1001x-left-after", "LAF-1", false);
	await employee(ids.leftBeforeRange, "t1001x-left-before", "LBF-1", false);
	await employee(ids.deactivated, "t1001x-deactivated", "DEA-1", false);
	await employee(ids.formerHolder, "t1001x-former-holder", "FHD-1", true);
	await departed(ids.leftInRange, "2026-07-15");
	await departed(ids.leftAfterRange, "2026-08-20");
	await departed(ids.leftBeforeRange, "2026-06-30");
	await admin.query(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'all', 't1001x-owner', now())`,
		[ORG, ids.holder],
	);
	// A grant that covers only employees who have left (#995's former-only state).
	const { rows: formerGrant } = await admin.query(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'specific', 't1001x-owner', now()) returning id`,
		[ORG, ids.formerHolder],
	);
	await admin.query(
		`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
		 values ($1, $2, $3, 't1001x-owner'), ($1, $2, $4, 't1001x-owner')`,
		[ORG, formerGrant[0].id, ids.leftInRange, ids.leftBeforeRange],
	);
	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at) values
		 ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()),
		 ('lexware_lohn', 'Lexware lohn+gehalt', '2024.1', now())
		 on conflict (id) do nothing`,
	);
	await admin.query(
		`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
		 values ($1, 'datev_lohn', $2::jsonb, 't1001x-owner', now())`,
		[
			ORG,
			JSON.stringify({
				mandantennummer: "12345",
				beraternummer: "1234567",
				personnelNumberType: "employeeNumber",
				includeZeroHours: false,
			}),
		],
	);
	for (const employeeId of [
		ids.worker,
		ids.leftInRange,
		ids.leftAfterRange,
		ids.leftBeforeRange,
		ids.deactivated,
	]) {
		await payout(employeeId, "2026-07-10", 60);
	}
}

describe("payroll grant holder exports and the unmapped payout warning on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	beforeEach(async () => {
		harness.userId = "t1001x-holder";
		await seed();
	});
	afterAll(cleanup);

	it("exports covered employees who left during or after the range, not before it", async () => {
		await mapOvertime({ datev: "1900" });

		const result = await startScopedPayrollExportAction({ ...july, formatId: "datev_lohn" });

		expect(result.success).toBe(true);
		const rows = String(result.success ? result.data.fileContent : "").split("\r\n");
		expect(rows).toEqual([
			HEADER,
			'"LAF-1";"1900";1.00;"2026-07-10";"Überstundenauszahlung"',
			'"LIN-1";"1900";1.00;"2026-07-10";"Überstundenauszahlung"',
			'"WRK-1";"1900";1.00;"2026-07-10";"Überstundenauszahlung"',
		]);
	});

	it("leaves the payroll workspace summary to employees who have not left", async () => {
		const result = await startScopedPayrollExportAction({ ...july, formatId: "datev_lohn" });
		const summary = await getPayrollWorkspaceSummaryAction(july);

		expect(result.success).toBe(true);
		expect(summary.success).toBe(true);
		const summarized = summary.success ? summary.data.employees.map((row) => row.id) : [];
		expect(summarized).toContain(ids.worker);
		expect(summarized).not.toContain(ids.leftInRange);
		expect(summarized).not.toContain(ids.leftAfterRange);
	});

	it("warns before exporting about the export's payouts the format has no overtime code for", async () => {
		await mapOvertime({ lexware: "300" });
		await payout(ids.worker, "2026-07-20", 30, true);

		const datev = await getOvertimePayoutExportReadinessAction({ ...july, formatId: "datev_lohn" });
		const lexware = await getOvertimePayoutExportReadinessAction({
			...july,
			formatId: "lexware_lohn",
		});

		// Worker, left in range and left after range; never the cancelled payout.
		expect(datev).toEqual({ success: true, data: { unmappedPayoutCount: 3 } });
		expect(lexware).toEqual({ success: true, data: { unmappedPayoutCount: 0 } });
	});

	it("narrows the warning to the selected employees", async () => {
		const result = await getOvertimePayoutExportReadinessAction({
			...july,
			employeeIds: [ids.worker],
			formatId: "datev_lohn",
		});

		expect(result).toEqual({ success: true, data: { unmappedPayoutCount: 1 } });
	});

	describe("a grant that covers only employees who have left", () => {
		beforeEach(() => {
			harness.userId = "t1001x-former-holder";
		});

		it("exports a period in which one of them was still employed", async () => {
			await mapOvertime({ datev: "1900" });

			const formats = await getConfiguredPayrollExportFormatsAction();
			const scope = await getPayrollExportScopeAction(july);
			const result = await startScopedPayrollExportAction({ ...july, formatId: "datev_lohn" });

			expect(formats).toEqual({
				success: true,
				data: [{ id: "datev_lohn", label: "DATEV Lohn & Gehalt" }],
			});
			expect(scope).toEqual({ success: true, data: { employeeCount: 1 } });
			expect(result.success && result.data.fileContent?.split("\r\n")).toEqual([
				HEADER,
				'"LIN-1";"1900";1.00;"2026-07-10";"Überstundenauszahlung"',
			]);
		});

		it("refuses a period in which none of them was employed any more, with a clear message", async () => {
			const august = { startDate: "2026-08-01", endDate: "2026-08-31", label: "August 2026" };

			const scope = await getPayrollExportScopeAction(august);
			const result = await startScopedPayrollExportAction({ ...august, formatId: "datev_lohn" });

			expect(scope).toEqual({ success: true, data: { employeeCount: 0 } });
			expect(result).toMatchObject({
				success: false,
				error: "No one in your payroll access was employed in this period.",
			});
		});

		it("still has no payroll workspace summary", async () => {
			const summary = await getPayrollWorkspaceSummaryAction(july);

			expect(summary).toMatchObject({ success: false, code: "AuthorizationError" });
		});
	});
});
