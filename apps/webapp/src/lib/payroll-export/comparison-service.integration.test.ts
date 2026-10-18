import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, payrollAccessGrant } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { listPayrollBaselines } from "./baseline-access";
import {
	eraseEmployeePayrollBaselines,
	insertPayrollBaseline,
	payrollBaselineDigest,
	readPayrollBaseline,
} from "./baseline-evidence";
import type { PayrollBaselineEvidence } from "./baseline-types";

const concurrent = vi.hoisted(() => ({
	afterSnapshot: null as null | (() => Promise<void>),
	departedScopeReads: 0,
}));
// Instrument only the real database driver: production still runs its complete prepare path.
vi.mock("@/db", async () => {
	const module = await (
		await import("@/test/integration-database")
	).integrationDbModule();
	module.pool.on("connect", (client) => {
		const original = client.query;
		Object.defineProperty(client, "query", {
			configurable: true,
			writable: true,
			value: (...args: unknown[]) => {
				const pending = Reflect.apply(original, client, args);
				const config = args[0];
				const text =
					typeof config === "string"
						? config
						: config && typeof config === "object" && "text" in config
							? String(config.text)
							: "";
				if (
					text.includes("from holder_grant hg") &&
					text.includes("e.is_active = false")
				)
					concurrent.departedScopeReads++;
				if (
					concurrent.afterSnapshot &&
					text.startsWith(
						'select "id" from "employee" where "employee"."organization_id" =',
					) &&
					typeof args.at(-1) !== "function"
				) {
					const hook = concurrent.afterSnapshot;
					concurrent.afterSnapshot = null;
					return Promise.resolve(pending).then(async (value) => {
						await hook();
						return value;
					});
				}
				return pending;
			},
		});
	});
	return module;
});
const auth = vi.hoisted(() => ({
	organizationId: "t1344-org",
	userId: "t1344-owner",
	employeeId: "d1344000-0000-4000-8000-000000000001",
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => ({
		user: { id: auth.userId },
		session: { activeOrganizationId: auth.organizationId },
		employee: { id: auth.employeeId, organizationId: auth.organizationId },
	}),
}));
const {
	preparePayrollComparison,
	getPayrollComparison,
	downloadPayrollComparison,
	cleanupExpiredPayrollComparisons,
	listCompatiblePayrollBaselines,
} = await import("./comparison-service");
const admin = integrationAdminPool();
const ORG = "t1344-org";
const OWNER = "d1344000-0000-4000-8000-000000000001";
const WORKER = "d1344000-0000-4000-8000-000000000002";
const period = { startDate: "2026-07-01", endDate: "2026-07-31" };
const config = {
	mandantennummer: "12345",
	beraternummer: "1234567",
	personnelNumberType: "employeeNumber",
	includeZeroHours: false,
};
let baselineId: string;
async function cleanup() {
	await admin.query("delete from organization where id=$1", [ORG]);
	await admin.query('delete from "user" where id=any($1::text[])', [
		["t1344-owner", "t1344-worker"],
	]);
}
async function seed() {
	concurrent.afterSnapshot = null;
	auth.organizationId = ORG;
	auth.userId = "t1344-owner";
	auth.employeeId = OWNER;
	await cleanup();
	await admin.query(
		"insert into organization(id,name,slug,timezone,created_at) values($1,$1,$1,'Europe/Berlin',now())",
		[ORG],
	);
	await admin.query(
		`insert into "user"(id,name,email,created_at,updated_at) values ('t1344-owner','Owner','t1344-owner@example.test',now(),now()),('t1344-worker','Worker','t1344-worker@example.test',now(),now())`,
	);
	await admin.query(
		"insert into employee(id,user_id,organization_id,role,employee_number,updated_at) values($1,'t1344-owner',$3,'admin','OWN',now()),($2,'t1344-worker',$3,'employee','WRK',now())",
		[OWNER, WORKER, ORG],
	);
	await admin.query(
		"insert into payroll_export_format(id,name,version,updated_at) values('datev_lohn','DATEV','2024.1',now()) on conflict do nothing",
	);
	const { rows } = await admin.query(
		"insert into payroll_export_config(organization_id,format_id,config,created_by,updated_at) values($1,'datev_lohn',$2,'t1344-owner',now()) returning id",
		[ORG, JSON.stringify(config)],
	);
	await admin.query(
		"insert into payroll_access_grant(organization_id,payroll_employee_id,scope,created_by,updated_by,updated_at) values($1,$2,'all','t1344-owner','t1344-owner',now())",
		[ORG, OWNER],
	);
	const evidence: PayrollBaselineEvidence = {
		version: 1,
		destination: {
			configId: rows[0].id,
			mandantennummer: "12345",
			beraternummer: "1234567",
		},
		config,
		filters: {
			dateRange: { start: period.startDate, end: period.endDate },
			employeeIds: [WORKER],
		},
		period,
		employeeIds: [WORKER],
		employeeWindows: [
			{
				employeeId: WORKER,
				timezone: "Europe/Berlin",
				startUtc: "2026-06-30T22:00:00Z",
				endExclusiveUtc: "2026-07-31T22:00:00Z",
			},
		],
		output: {
			version: 1,
			formatId: "datev_lohn",
			formatterVersion: "2024.1",
			excludedLineKinds: ["expense"],
			rows: [],
		},
		fileDigest: "a".repeat(64),
		attemptId: randomUUID(),
	};
	baselineId = randomUUID();
	await insertPayrollBaseline(db, {
		id: baselineId,
		jobId: randomUUID(),
		organizationId: ORG,
		createdAt: new Date(),
		completedAt: new Date(),
		evidence,
	});
}
describe("authorized read-only reviewed payroll comparisons", () => {
	beforeEach(seed);
	afterAll(cleanup);
	it("prepares a valid empty comparison and downloads the same reviewed result", async () => {
		const result = await preparePayrollComparison({
			baselineId,
			...period,
			employeeIds: [WORKER],
		});
		expect(result.status).toBe("ready");
		if (result.status !== "ready") throw new Error("Expected ready");
		expect(result.result.comparison.hasPayrollImpact).toBe(false);
		expect(await getPayrollComparison(result.result.id)).toEqual(result.result);
		expect(
			(await downloadPayrollComparison(result.result.id))?.content,
		).toContain("Expense reimbursements are excluded");
		expect(
			(
				await listCompatiblePayrollBaselines({
					...period,
					employeeIds: [WORKER],
				})
			).map((row) => row.id),
		).toEqual([baselineId]);
	});
	it("erases the reviewed payload with employee erasure and never regenerates its download", async () => {
		const prepared = await preparePayrollComparison({
			baselineId,
			...period,
			employeeIds: [WORKER],
		});
		if (prepared.status !== "ready") throw new Error("Expected ready");
		await eraseEmployeePayrollBaselines(db, {
			organizationId: ORG,
			employeeId: WORKER,
		});
		expect(await getPayrollComparison(prepared.result.id)).toBeNull();
		expect(await downloadPayrollComparison(prepared.result.id)).toBeNull();
		const { rows } = await admin.query(
			"select count(*)::int count from payroll_comparison_result where organization_id=$1",
			[ORG],
		);
		expect(rows[0].count).toBe(0);
	});

	it("blocks unmapped payouts, then preserves reviewed quantities after cancellation until an explicit refresh", async () => {
		const payoutId = randomUUID();
		await admin.query(
			"insert into balance_adjustment(id,organization_id,employee_id,kind,day,minutes,reason,recorded_by) values($1,$2,$3,'overtime_payout','2026-07-15',-60,'Approved payout','t1344-owner')",
			[payoutId, ORG, WORKER],
		);
		expect(
			await preparePayrollComparison({
				baselineId,
				...period,
				employeeIds: [WORKER],
			}),
		).toMatchObject({
			status: "blocked",
			blockers: [{ employeeId: WORKER, reason: "unmapped_overtime_payout" }],
		});
		await admin.query(
			"insert into payroll_wage_type_mapping(organization_id,special_category,wage_type_code,datev_wage_type_code,created_by,updated_at) values($1,'overtime','1900','1900','t1344-owner',now())",
			[ORG],
		);
		const prepared = await preparePayrollComparison({
			baselineId,
			...period,
			employeeIds: [WORKER],
		});
		expect(prepared.status).toBe("ready");
		if (prepared.status !== "ready") throw new Error("Expected ready");
		expect(prepared.result.comparison.rows).toMatchObject([
			{
				status: "added",
				delta: "+1.00",
				newRow: { quantity: "1.00", wageTypeCode: "1900" },
			},
		]);
		expect(prepared.result.explanations).toMatchObject([
			{
				kind: "overtime_payout",
				sourceId: payoutId,
				action: "recorded",
				reason: "Approved payout",
				actorId: "t1344-owner",
			},
		]);
		const csv = await downloadPayrollComparison(prepared.result.id);
		await admin.query(
			"update balance_adjustment set cancelled_at=now(),cancelled_by='t1344-owner',cancellation_reason='Entered twice' where id=$1",
			[payoutId],
		);
		expect(await getPayrollComparison(prepared.result.id)).toEqual(
			prepared.result,
		);
		expect(await downloadPayrollComparison(prepared.result.id)).toEqual(csv);
		const fresh = await preparePayrollComparison({
			baselineId,
			...period,
			employeeIds: [WORKER],
		});
		expect(fresh.status).toBe("ready");
		if (fresh.status !== "ready") throw new Error("Expected ready");
		expect(fresh.result.id).not.toBe(prepared.result.id);
		expect(fresh.result.comparison.hasPayrollImpact).toBe(false);
	});

	it("rechecks the entire scope at view and download after a payroll grant is narrowed or revoked", async () => {
		const prepared = await preparePayrollComparison({
			baselineId,
			...period,
			employeeIds: [WORKER],
		});
		if (prepared.status !== "ready") throw new Error("Expected ready");
		await admin.query(
			"update payroll_access_grant set scope='specific' where organization_id=$1",
			[ORG],
		);
		expect(
			await listCompatiblePayrollBaselines({
				...period,
				employeeIds: [WORKER],
			}),
		).toEqual([]);
		expect(await getPayrollComparison(prepared.result.id)).toBeNull();
		expect(await downloadPayrollComparison(prepared.result.id)).toBeNull();
		expect(
			await preparePayrollComparison({
				baselineId,
				...period,
				employeeIds: [WORKER],
			}),
		).toEqual({ status: "unavailable" });
		await admin.query(
			"update payroll_access_grant set is_active=false where organization_id=$1",
			[ORG],
		);
		await expect(downloadPayrollComparison(prepared.result.id)).rejects.toThrow(
			"Payroll baseline is unavailable",
		);
	});

	it("rejects changed scope, period, destination and employee windows without narrowing the baseline", async () => {
		expect(
			await preparePayrollComparison({
				baselineId,
				...period,
				employeeIds: [],
			}),
		).toMatchObject({
			status: "incompatible",
			reason: "employee_scope_changed",
		});
		expect(
			await preparePayrollComparison({
				baselineId,
				...period,
				startDate: "2026-07-02",
				employeeIds: [WORKER],
			}),
		).toMatchObject({ status: "incompatible", reason: "period_changed" });
		expect(
			(
				await preparePayrollComparison({
					baselineId,
					...period,
					employeeIds: [WORKER, WORKER],
				})
			).status,
		).toBe("ready");
		await admin.query(
			"update organization set timezone='America/New_York' where id=$1",
			[ORG],
		);
		expect(
			await preparePayrollComparison({
				baselineId,
				...period,
				employeeIds: [WORKER],
			}),
		).toMatchObject({
			status: "incompatible",
			reason: "employee_windows_changed",
		});
		await admin.query(
			"update organization set timezone='Europe/Berlin' where id=$1",
			[ORG],
		);
		await admin.query(
			"update payroll_export_config set config=jsonb_set(config,'{mandantennummer}','\"54321\"') where organization_id=$1",
			[ORG],
		);
		expect(
			await preparePayrollComparison({
				baselineId,
				...period,
				employeeIds: [WORKER],
			}),
		).toMatchObject({ status: "incompatible", reason: "destination_changed" });
		expect(
			await listCompatiblePayrollBaselines({
				...period,
				employeeIds: [WORKER],
			}),
		).toEqual([]);
	});
	it("blocks unresolved work without creating exports or mutating payroll source records", async () => {
		const recordId = randomUUID();
		await admin.query(
			"insert into time_record(id,organization_id,employee_id,record_kind,start_at,approval_state,created_by,updated_at) values($1,$2,$3,'work','2026-07-15T08:00:00Z','draft','t1344-owner',now())",
			[recordId, ORG, WORKER],
		);
		const readState = async () =>
			(
				await admin.query(
					"select (select count(*) from payroll_export_job where organization_id=$1)::int jobs,(select count(*) from time_entry where organization_id=$1)::int entries,(select count(*) from work_period where organization_id=$1)::int periods,(select row_to_json(r) from time_record r where id=$2) record",
					[ORG, recordId],
				)
			).rows;
		const before = await readState();
		const prepared = await preparePayrollComparison({
			baselineId,
			...period,
			employeeIds: [WORKER],
		});
		expect(prepared.status).toBe("blocked");
		if (prepared.status !== "blocked") throw new Error("Expected blockers");
		expect(prepared.blockers.length).toBeGreaterThan(0);
		expect(prepared.blockers.every((row) => row.employeeId === WORKER)).toBe(
			true,
		);
		expect(await readState()).toEqual(before);
	});

	it("compares approved absence calendar days using the actual eight-hour DATEV conversion", async () => {
		const category = randomUUID(),
			record = randomUUID();
		await admin.query(
			"insert into absence_category(id,organization_id,type,name,updated_at) values($1,$2,'vacation','Holiday',now())",
			[category, ORG],
		);
		await admin.query(
			"insert into time_record(id,organization_id,employee_id,record_kind,start_at,end_at,approval_state,created_by,updated_at) values($1,$2,$3,'absence','2026-07-15T00:00:00Z','2026-07-16T00:00:00Z','approved','t1344-owner',now())",
			[record, ORG, WORKER],
		);
		await admin.query(
			"insert into time_record_absence(record_id,organization_id,absence_category_id) values($1,$2,$3)",
			[record, ORG, category],
		);
		await admin.query(
			"insert into absence_entry(employee_id,organization_id,category_id,start_date,end_date,status,canonical_record_id,updated_at) values($1,$2,$3,'2026-07-15','2026-07-16','approved',$4,now())",
			[WORKER, ORG, category, record],
		);
		await admin.query(
			"insert into payroll_wage_type_mapping(organization_id,absence_category_id,wage_type_code,datev_wage_type_code,created_by,updated_at) values($1,$2,'1600','1600','t1344-owner',now())",
			[ORG, category],
		);
		const prepared = await preparePayrollComparison({
			baselineId,
			...period,
			employeeIds: [WORKER],
		});
		expect(prepared.status).toBe("ready");
		if (prepared.status !== "ready") throw new Error("Expected ready");
		expect(prepared.result.comparison.rows).toMatchObject([
			{
				status: "added",
				delta: "+8.00",
				newRow: { date: "2026-07-15", quantity: "8.00" },
			},
			{
				status: "added",
				delta: "+8.00",
				newRow: { date: "2026-07-16", quantity: "8.00" },
			},
		]);
		expect(prepared.result.comparison.totals).toMatchObject([
			{ wageTypeCode: "1600", newQuantity: "16.00", delta: "+16.00" },
		]);
	});

	it("prepares all current inputs from one snapshot across a concurrent source and mapping write", async () => {
		concurrent.afterSnapshot = async () => {
			await admin.query(
				"insert into balance_adjustment(organization_id,employee_id,kind,day,minutes,reason,recorded_by) values($1,$2,'overtime_payout','2026-07-15',-60,'Late payout','t1344-owner')",
				[ORG, WORKER],
			);
			await admin.query(
				"insert into payroll_wage_type_mapping(organization_id,special_category,wage_type_code,datev_wage_type_code,created_by,updated_at) values($1,'overtime','1900','1900','t1344-owner',now())",
				[ORG],
			);
		};
		const first = await preparePayrollComparison({
			baselineId,
			...period,
			employeeIds: [WORKER],
		});
		expect(concurrent.afterSnapshot).toBeNull();
		expect(first.status).toBe("ready");
		if (first.status !== "ready") throw new Error("Expected ready");
		expect(first.result.comparison.hasPayrollImpact).toBe(false);
		const next = await preparePayrollComparison({
			baselineId,
			...period,
			employeeIds: [WORKER],
		});
		expect(next.status).toBe("ready");
		if (next.status !== "ready") throw new Error("Expected ready");
		expect(next.result.comparison.totals).toMatchObject([
			{ wageTypeCode: "1900", newQuantity: "1.00" },
		]);
	});

	it("blocks pending absence and absence-change approval instead of presenting omitted current lines as zero", async () => {
		const category = randomUUID(),
			record = randomUUID(),
			absence = randomUUID();
		await admin.query(
			"insert into absence_category(id,organization_id,type,name,updated_at) values($1,$2,'vacation','Holiday',now())",
			[category, ORG],
		);
		await admin.query(
			"insert into time_record(id,organization_id,employee_id,record_kind,start_at,end_at,approval_state,created_by,updated_at) values($1,$2,$3,'absence','2026-07-15T00:00:00Z','2026-07-16T00:00:00Z','pending','t1344-owner',now())",
			[record, ORG, WORKER],
		);
		await admin.query(
			"insert into time_record_absence(record_id,organization_id,absence_category_id) values($1,$2,$3)",
			[record, ORG, category],
		);
		await admin.query(
			"insert into absence_entry(id,employee_id,organization_id,category_id,start_date,end_date,status,canonical_record_id,updated_at) values($1,$2,$3,$4,'2026-07-15','2026-07-16','pending',$5,now())",
			[absence, WORKER, ORG, category, record],
		);
		expect(
			await preparePayrollComparison({
				baselineId,
				...period,
				employeeIds: [WORKER],
			}),
		).toMatchObject({
			status: "blocked",
			blockers: [{ employeeId: WORKER, reason: "pending_absence" }],
		});
		await admin.query(
			"update time_record set approval_state='approved' where id=$1",
			[record],
		);
		await admin.query(
			"update absence_entry set status='approved' where id=$1",
			[absence],
		);
		await admin.query(
			"insert into absence_change_request(organization_id,employee_id,absence_id,kind,status,original,reason,submitted_by) values($1,$2,$3,'cancel','pending',$4,'Leave rescheduled','t1344-owner')",
			[
				ORG,
				WORKER,
				absence,
				JSON.stringify({
					canonicalRecordId: record,
					startDate: "2026-07-15",
					endDate: "2026-07-16",
				}),
			],
		);
		expect(
			await preparePayrollComparison({
				baselineId,
				...period,
				employeeIds: [WORKER],
			}),
		).toMatchObject({
			status: "blocked",
			blockers: [{ employeeId: WORKER, reason: "pending_absence_change" }],
		});
	});

	it("rejects effective filter changes instead of comparing the workspace's full scope with a filtered baseline", async () => {
		expect(
			await preparePayrollComparison({
				baselineId,
				...period,
				employeeIds: [WORKER],
				projectIds: [randomUUID()],
			}),
		).toMatchObject({
			status: "incompatible",
			reason: "effective_filters_changed",
		});
		expect(
			await listCompatiblePayrollBaselines({
				...period,
				employeeIds: [WORKER],
				teamIds: [randomUUID()],
			}),
		).toEqual([]);
	});
	it("refuses duplicate actual identifiers before the formatter can merge employees", async () => {
		await admin.query("update employee set employee_number=null where id=$1", [
			OWNER,
		]);
		await admin.query("update employee set employee_number=$1 where id=$2", [
			OWNER,
			WORKER,
		]);
		for (const id of [OWNER, WORKER])
			await admin.query(
				"insert into balance_adjustment(organization_id,employee_id,kind,day,minutes,reason,recorded_by) values($1,$2,'overtime_payout','2026-07-15',-60,'Approved payout','t1344-owner')",
				[ORG, id],
			);
		await admin.query(
			"insert into payroll_wage_type_mapping(organization_id,special_category,wage_type_code,datev_wage_type_code,created_by,updated_at) values($1,'overtime','1900','1900','t1344-owner',now())",
			[ORG],
		);
		const retained = await readPayrollBaseline({
			organizationId: ORG,
			baselineId,
		});
		if (!retained?.evidence) throw new Error("Baseline missing");
		const evidence = retained.evidence;
		const id = randomUUID();
		await insertPayrollBaseline(db, {
			id,
			jobId: randomUUID(),
			organizationId: ORG,
			createdAt: new Date(),
			completedAt: new Date(),
			evidence: {
				...evidence,
				employeeIds: [OWNER, WORKER],
				filters: { ...evidence.filters, employeeIds: [OWNER, WORKER] },
				employeeWindows: [
					...evidence.employeeWindows,
					{ ...evidence.employeeWindows[0], employeeId: OWNER },
				],
			},
		});
		const result = await preparePayrollComparison({
			baselineId: id,
			...period,
			employeeIds: [WORKER, OWNER],
		});
		expect(result).toMatchObject({
			status: "blocked",
			blockers: [
				{ employeeId: OWNER, reason: "duplicate_personnel_identifier" },
				{ employeeId: WORKER, reason: "duplicate_personnel_identifier" },
			],
		});
	});
	it("returns refresh-required for expired reviewed results and cleans their retained payload", async () => {
		const prepared = await preparePayrollComparison({
			baselineId,
			...period,
			employeeIds: [WORKER],
		});
		if (prepared.status !== "ready") throw new Error("Expected ready");
		const id = randomUUID();
		const expired = {
			...prepared.result,
			id,
			preparedAt: "2026-01-01T00:00:00Z",
			expiresAt: "2026-01-02T00:00:00Z",
		};
		await admin.query(
			"insert into payroll_comparison_result(id,organization_id,baseline_id,digest,result,expires_at) values($1,$2,$3,$4,$5,$6)",
			[
				id,
				ORG,
				baselineId,
				payrollBaselineDigest(expired),
				JSON.stringify(expired),
				expired.expiresAt,
			],
		);
		expect(await getPayrollComparison(id)).toBeNull();
		expect(await downloadPayrollComparison(id)).toBeNull();
		expect(
			(await cleanupExpiredPayrollComparisons()).map((row) => row.id),
		).toContain(id);
		expect(await getPayrollComparison(prepared.result.id)).toEqual(
			prepared.result,
		);
	});
	it("preserves explicit employee scope for absence and payout rows when a team filter narrows work", async () => {
		const teamId = randomUUID();
		await admin.query(
			"insert into team(id,organization_id,name,updated_at) values($1,$2,'Selected team',now())",
			[teamId, ORG],
		);
		await admin.query("update employee set team_id=$1 where id=$2", [
			teamId,
			OWNER,
		]);
		for (const employeeId of [OWNER, WORKER])
			await admin.query(
				"insert into balance_adjustment(organization_id,employee_id,kind,day,minutes,reason,recorded_by) values($1,$2,'overtime_payout','2026-07-15',-60,'Approved payout','t1344-owner')",
				[ORG, employeeId],
			);
		await admin.query(
			"insert into payroll_wage_type_mapping(organization_id,special_category,wage_type_code,datev_wage_type_code,created_by,updated_at) values($1,'overtime','1900','1900','t1344-owner',now())",
			[ORG],
		);
		const retained = await readPayrollBaseline({
			organizationId: ORG,
			baselineId,
		});
		if (!retained?.evidence) throw new Error("Missing baseline");
		const historical = retained.evidence,
			id = randomUUID();
		await insertPayrollBaseline(db, {
			id,
			jobId: randomUUID(),
			organizationId: ORG,
			createdAt: new Date(),
			completedAt: new Date(),
			evidence: {
				...historical,
				employeeIds: [OWNER, WORKER],
				filters: {
					...historical.filters,
					employeeIds: [OWNER, WORKER],
					teamIds: [teamId],
				},
				employeeWindows: [
					...historical.employeeWindows,
					{ ...historical.employeeWindows[0], employeeId: OWNER },
				],
			},
		});
		const result = await preparePayrollComparison({
			baselineId: id,
			...period,
			employeeIds: [WORKER, OWNER],
			teamIds: [teamId],
		});
		expect(result.status).toBe("ready");
		if (result.status !== "ready") throw new Error("Expected complete preview");
		expect(
			result.result.comparison.employees.map((row) => row.employeeId).sort(),
		).toEqual([OWNER, WORKER]);
		expect(result.result.comparison.totals).toMatchObject([
			{ wageTypeCode: "1900", newQuantity: "2.00" },
		]);
	});
	it("uses a caller-bound transaction for baseline access and comparison scope", async () => {
		await db.transaction(async (tx) => {
			await tx
				.update(payrollAccessGrant)
				.set({ scope: "specific" })
				.where(eq(payrollAccessGrant.organizationId, ORG));
			expect(await listPayrollBaselines(period, tx)).toEqual([]);
			expect(
				await preparePayrollComparison(
					{ baselineId, ...period, employeeIds: [WORKER] },
					tx,
				),
			).toEqual({ status: "unavailable" });
		});
	});
	it("loads departed coverage once per period in a baseline list and rechecks it on the next request", async () => {
		const retained = await readPayrollBaseline({
			organizationId: ORG,
			baselineId,
		});
		if (!retained?.evidence) throw new Error("Missing baseline");
		await insertPayrollBaseline(db, {
			id: randomUUID(),
			jobId: randomUUID(),
			organizationId: ORG,
			createdAt: new Date(),
			completedAt: new Date(),
			evidence: retained.evidence,
		});
		await admin.query(
			"update payroll_access_grant set scope='specific' where organization_id=$1",
			[ORG],
		);
		concurrent.departedScopeReads = 0;
		expect(await listPayrollBaselines(period)).toEqual([]);
		expect(concurrent.departedScopeReads).toBe(1);
		expect(await listPayrollBaselines(period)).toEqual([]);
		expect(concurrent.departedScopeReads).toBe(2);
	});
});
