import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";

const storage = vi.hoisted(() => ({
	fail: false,
	uploads: [] as { key: string; content: Buffer }[],
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	getPresignedUrl: async () => "https://example.test/export",
	uploadExport: async (_org: string, key: string, content: Buffer) => {
		storage.uploads.push({ key, content });
		if (storage.fail) throw new Error("test delivery failure");
	},
}));
const actor = vi.hoisted(() => ({
	employeeId: "d1346000-0000-4000-8000-000000000001",
	organizationId: "t1346-org",
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => ({
		user: { id: "t1346-owner" },
		session: { activeOrganizationId: actor.organizationId },
		employee: { id: actor.employeeId, organizationId: actor.organizationId },
	}),
}));
const { createExportJob, processExportJob } = await import("./export-service");
const {
	readPayrollBaseline,
	cleanupExpiredPayrollBaselines,
	eraseEmployeePayrollBaselines,
} = await import("./baseline-evidence");
const { listPayrollBaselines, inspectPayrollBaseline } = await import(
	"./baseline-access"
);
const admin = integrationAdminPool();
const ORG = "t1346-org";
const OWNER = "d1346000-0000-4000-8000-000000000001";
const WORKER = "d1346000-0000-4000-8000-000000000002";
const config = {
	outputFormat: "sage_native",
	personnelNumberType: "employeeNumber",
	includeZeroHours: false,
};
async function cleanup() {
	await admin.query("delete from organization where id=$1", [ORG]);
	await admin.query('delete from "user" where id=any($1::text[])', [
		["t1346-owner", "t1346-worker"],
	]);
}
async function seed() {
	storage.fail = false;
	storage.uploads = [];
	actor.organizationId = ORG;
	await cleanup();
	await admin.query(
		"insert into organization(id,name,slug,timezone,created_at) values($1,$1,$1,'Europe/Berlin',now())",
		[ORG],
	);
	await admin.query(
		`insert into "user" (id,name,email,created_at,updated_at) values ('t1346-owner','Owner','t1346-owner@example.test',now(),now()),('t1346-worker','Worker','t1346-worker@example.test',now(),now())`,
	);
	await admin.query(
		"insert into employee(id,user_id,organization_id,role,employee_number,updated_at) values($1,'t1346-owner',$3,'admin','OWN',now()),($2,'t1346-worker',$3,'employee','WRK',now())",
		[OWNER, WORKER, ORG],
	);
	await admin.query(
		"insert into payroll_export_format(id,name,version,updated_at) values('sage_lohn','Sage','2024.1',now()) on conflict do nothing",
	);
	await admin.query(
		"insert into payroll_export_config(organization_id,format_id,config,created_by,updated_at) values($1,'sage_lohn',$2,'t1346-owner',now())",
		[ORG, JSON.stringify(config)],
	);
}
async function job() {
	return createExportJob({
		organizationId: ORG,
		formatId: "sage_lohn",
		requestedById: OWNER,
		filters: {
			dateRange: {
				start: DateTime.fromISO("2026-07-01", { zone: "UTC" }),
				end: DateTime.fromISO("2026-07-31", { zone: "UTC" }),
			},
			employeeIds: [WORKER],
		},
	});
}

const {
	preparePayrollComparison,
	getPayrollComparison,
	downloadPayrollComparison,
	listCompatiblePayrollBaselines,
} = await import("./comparison-service");
const period = { startDate: "2026-07-01", endDate: "2026-07-31" };
async function grant() {
	await admin.query(
		"insert into payroll_access_grant(organization_id,payroll_employee_id,scope,created_by,updated_by,updated_at) values($1,$2,'all','t1346-owner','t1346-owner',now())",
		[ORG, OWNER],
	);
}
async function payout(minutes = -90) {
	await admin.query(
		"insert into payroll_wage_type_mapping(organization_id,special_category,sage_wage_type_code,created_by,updated_at) values($1,'overtime','1900','t1346-owner',now())",
		[ORG],
	);
	await admin.query(
		"insert into balance_adjustment(organization_id,employee_id,kind,day,minutes,reason,recorded_by) values($1,$2,'overtime_payout','2026-07-15',$3,'Paid in July','t1346-owner')",
		[ORG, WORKER, minutes],
	);
}
async function exported() {
	const { jobId } = await job();
	const output = await processExportJob({ jobId, organizationId: ORG });
	const retained = await readPayrollBaseline({ organizationId: ORG, jobId });
	if (!retained) throw new Error("Expected retained baseline");
	return { output, retained, jobId };
}
async function prepare(baselineId: string) {
	return preparePayrollComparison({
		baselineId,
		...period,
		employeeIds: [WORKER],
	});
}
describe("Sage retained output and reviewed comparisons", () => {
	vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
	beforeEach(seed);
	afterAll(cleanup);
	it("captures native output and prepares an unchanged read-only comparison", async () => {
		await grant();
		await payout();
		const { retained, output } = await exported();
		expect(String(output.result?.content)).toContain(
			'"WRK";"1900";"1,50";"2026-07-15"',
		);
		expect(retained.summary).toMatchObject({
			formatId: "sage_lohn",
			availability: "available",
		});
		expect(retained.evidence?.output.rows).toMatchObject([
			{
				date: "2026-07-15",
				quantity: "1.50",
				renderedColumns: { Betrag: "1,50" },
				contributions: [
					{
						kind: "overtime_payout",
						reason: "Paid in July",
						sourceActorId: "t1346-owner",
					},
				],
			},
		]);
		const before = await admin.query(
			"select (select count(*) from payroll_export_job where organization_id=$1)::int jobs,(select count(*) from balance_adjustment where organization_id=$1)::int payouts,(select count(*) from travel_expense_payroll_run_inclusion where organization_id=$1)::int runs",
			[ORG],
		);
		const result = await prepare(retained.summary.id);
		expect(result.status).toBe("ready");
		if (result.status !== "ready") throw new Error("Expected ready");
		expect(result.result.comparison).toMatchObject({
			formatId: "sage_lohn",
			hasPayrollImpact: false,
			rows: [],
			totals: [
				{
					wageTypeCode: "1900",
					oldQuantity: "1.50",
					newQuantity: "1.50",
					delta: "0.00",
				},
			],
		});
		expect(await getPayrollComparison(result.result.id)).toEqual(result.result);
		expect(
			(
				await listCompatiblePayrollBaselines({
					...period,
					employeeIds: [WORKER],
					formatId: "sage_lohn",
				})
			).map((row) => row.id),
		).toEqual([retained.summary.id]);
		expect(
			(await downloadPayrollComparison(result.result.id))?.content,
		).toContain("Expense reimbursements are excluded");
		const after = await admin.query(
			"select (select count(*) from payroll_export_job where organization_id=$1)::int jobs,(select count(*) from balance_adjustment where organization_id=$1)::int payouts,(select count(*) from travel_expense_payroll_run_inclusion where organization_id=$1)::int runs",
			[ORG],
		);
		expect(after.rows).toEqual(before.rows);
	});
	it("retains exact native and DATEV-compatible sides after settings, code and personnel changes", async () => {
		await grant();
		await payout();
		const { retained } = await exported();
		await admin.query(
			"update payroll_export_config set config=jsonb_set(config,'{outputFormat}','\"datev_compatible\"') where organization_id=$1",
			[ORG],
		);
		const changedMode = await prepare(retained.summary.id);
		if (changedMode.status !== "ready")
			throw new Error(`Expected ready: ${JSON.stringify(changedMode)}`);
		expect(changedMode.result.comparison.rows).toMatchObject([
			{
				status: "changed",
				delta: "0.00",
				oldRow: { renderedColumns: { Betrag: "1,50" } },
				newRow: { renderedColumns: { Betrag: "1.50" } },
			},
		]);
		const csv = await downloadPayrollComparison(changedMode.result.id);
		expect(csv?.content).toContain("1,50");
		expect(csv?.content).toContain("1.50");
		await admin.query(
			"update payroll_wage_type_mapping set sage_wage_type_code='2900' where organization_id=$1",
			[ORG],
		);
		await admin.query(
			"update employee set employee_number='WRK-NEW' where id=$1",
			[WORKER],
		);
		const changedCodes = await prepare(retained.summary.id);
		if (changedCodes.status !== "ready") throw new Error("Expected ready");
		expect(changedCodes.result.comparison.totals).toMatchObject([
			{ wageTypeCode: "1900", delta: "-1.50" },
			{ wageTypeCode: "2900", delta: "+1.50" },
		]);
		expect(changedCodes.result.comparison.employees).toMatchObject([
			{
				employeeId: WORKER,
				status: "changed",
				oldPersonnelNumbers: ["WRK"],
				newPersonnelNumbers: ["WRK-NEW"],
			},
		]);
		expect(
			await readPayrollBaseline({
				organizationId: ORG,
				baselineId: retained.summary.id,
			}),
		).toEqual(retained);
		expect(await downloadPayrollComparison(changedMode.result.id)).toEqual(csv);
	});
	it("preserves the reviewed result and CSV after payout cancellation until explicit refresh", async () => {
		await grant();
		const { retained } = await exported();
		expect(retained.summary.availability).toBe("empty");
		await payout();
		const reviewed = await prepare(retained.summary.id);
		if (reviewed.status !== "ready") throw new Error("Expected ready");
		expect(reviewed.result.comparison.rows).toMatchObject([
			{
				status: "added",
				delta: "+1.50",
				newRow: { date: "2026-07-15", quantity: "1.50" },
			},
		]);
		const csv = await downloadPayrollComparison(reviewed.result.id);
		await admin.query(
			"update balance_adjustment set cancelled_at=now(),cancelled_by='t1346-owner',cancellation_reason='Entered twice' where organization_id=$1",
			[ORG],
		);
		expect(await getPayrollComparison(reviewed.result.id)).toEqual(
			reviewed.result,
		);
		expect(await downloadPayrollComparison(reviewed.result.id)).toEqual(csv);
		const fresh = await prepare(retained.summary.id);
		if (fresh.status !== "ready") throw new Error("Expected ready");
		expect(fresh.result.id).not.toBe(reviewed.result.id);
		expect(fresh.result.comparison.hasPayrollImpact).toBe(false);
	});
	it("requires the entire scope again at download and refuses an unavailable result after erasure", async () => {
		await grant();
		await payout();
		const { retained } = await exported();
		const prepared = await prepare(retained.summary.id);
		if (prepared.status !== "ready") throw new Error("Expected ready");
		await admin.query(
			"update payroll_access_grant set scope='specific' where organization_id=$1",
			[ORG],
		);
		expect(await getPayrollComparison(prepared.result.id)).toBeNull();
		expect(await downloadPayrollComparison(prepared.result.id)).toBeNull();
		expect(await listPayrollBaselines()).toEqual([]);
		expect(await prepare(retained.summary.id)).toEqual({
			status: "unavailable",
		});
		await admin.query(
			"update payroll_access_grant set scope='all' where organization_id=$1",
			[ORG],
		);
		await eraseEmployeePayrollBaselines(db, {
			organizationId: ORG,
			employeeId: WORKER,
		});
		expect(
			(
				await readPayrollBaseline({
					organizationId: ORG,
					jobId: retained.summary.jobId,
				})
			)?.summary.availability,
		).toBe("erased");
		expect(await downloadPayrollComparison(prepared.result.id)).toBeNull();
	});
	it("retains evidence after file expiry and target/requester removal, and enforces the calendar retention boundary", async () => {
		await grant();
		await payout();
		const { retained, jobId } = await exported();
		await admin.query(
			"update payroll_export_job set expires_at='2000-01-01T00:00:00Z',s3_key=null where id=$1",
			[jobId],
		);
		expect(await inspectPayrollBaseline(retained.summary.id)).toEqual(retained);
		await admin.query(
			"delete from payroll_export_config where organization_id=$1",
			[ORG],
		);
		await admin.query("delete from employee where id=$1", [OWNER]);
		expect(
			await readPayrollBaseline({
				organizationId: ORG,
				baselineId: retained.summary.id,
			}),
		).toEqual(retained);
		const expires = Temporal.Instant.from(retained.summary.expiresAt);
		expect(
			(
				await readPayrollBaseline({
					organizationId: ORG,
					baselineId: retained.summary.id,
					now: expires.subtract({ nanoseconds: 1 }),
				})
			)?.summary.availability,
		).toBe("available");
		expect(
			(
				await readPayrollBaseline({
					organizationId: ORG,
					baselineId: retained.summary.id,
					now: expires,
				})
			)?.summary.availability,
		).toBe("expired");
		expect(await cleanupExpiredPayrollBaselines({ now: expires })).toBe(1);
		expect(
			(
				await readPayrollBaseline({
					organizationId: ORG,
					baselineId: retained.summary.id,
				})
			)?.evidence,
		).toBeNull();
	});
	it.each(["sage_native", "datev_compatible"] as const)(
		"retains the successful retry attempt in %s mode for inline, async and scheduled file delivery",
		async (outputFormat) => {
			await admin.query(
				"update payroll_export_config set config=jsonb_set(config,'{outputFormat}',$2::jsonb) where organization_id=$1",
				[ORG, JSON.stringify(outputFormat)],
			);
			for (const mode of ["interactive", "async", "scheduled"]) {
				const { jobId } = await job();
				if (mode === "async")
					await admin.query(
						"update payroll_export_job set is_async=true where id=$1",
						[jobId],
					);
				storage.fail = true;
				await expect(
					processExportJob({ jobId, organizationId: ORG }, { storeFile: true }),
				).rejects.toThrow("test delivery failure");
				expect(
					await readPayrollBaseline({ organizationId: ORG, jobId }),
				).toBeNull();
				storage.fail = false;
				await processExportJob(
					{ jobId, organizationId: ORG },
					{ storeFile: mode !== "interactive" },
				);
				const retained = await readPayrollBaseline({
					organizationId: ORG,
					jobId,
				});
				expect(retained?.summary).toMatchObject({
					formatId: "sage_lohn",
					availability: "empty",
				});
				expect(retained?.evidence?.config.outputFormat).toBe(outputFormat);
				if (mode !== "interactive") {
					const last = storage.uploads.at(-1);
					if (!last) throw new Error("Expected stored successful attempt");
					expect(last.key).toContain(`/${retained?.evidence?.attemptId}/`);
					expect(retained?.evidence?.fileDigest).toBe(
						createHash("sha256").update(last.content).digest("hex"),
					);
				}
			}
		},
	);
	it("refuses cross-format, changed scopes and unmapped current payouts instead of reporting removals", async () => {
		await grant();
		await payout();
		const { retained } = await exported();
		expect(
			await preparePayrollComparison({
				baselineId: retained.summary.id,
				...period,
				employeeIds: [WORKER],
				formatId: "datev_lohn",
			}),
		).toEqual({ status: "incompatible", reason: "format_changed" });
		expect(
			await listCompatiblePayrollBaselines({
				...period,
				employeeIds: [WORKER],
				formatId: "datev_lohn",
			}),
		).toEqual([]);
		expect(
			await preparePayrollComparison({
				baselineId: retained.summary.id,
				...period,
				employeeIds: [OWNER, WORKER],
				formatId: "sage_lohn",
			}),
		).toEqual({ status: "incompatible", reason: "employee_scope_changed" });
		await admin.query(
			"update payroll_wage_type_mapping set sage_wage_type_code=null,wage_type_code='' where organization_id=$1",
			[ORG],
		);
		expect(await prepare(retained.summary.id)).toMatchObject({
			status: "blocked",
			blockers: [{ employeeId: WORKER, reason: "unmapped_overtime_payout" }],
		});
	});
});
