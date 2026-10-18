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
	employeeId: "d1343000-0000-4000-8000-000000000001",
	organizationId: "t1343-org",
}));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => ({
		user: { id: "t1343-owner" },
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
const ORG = "t1343-org";
const OWNER = "d1343000-0000-4000-8000-000000000001";
const WORKER = "d1343000-0000-4000-8000-000000000002";
describe.each(["datev_lohn", "lexware_lohn"] as const)(
	"immutable %s baselines",
	(formatId) => {
		const config = {
			mandantennummer: "12345",
			beraternummer: "1234567",
			personnelNumberType: "employeeNumber",
			includeZeroHours: false,
			includeStunden: true,
			includeStundensatz: true,
		};
		async function cleanup() {
			await admin.query("delete from organization where id=$1", [ORG]);
			await admin.query('delete from "user" where id=any($1::text[])', [
				["t1343-owner", "t1343-worker"],
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
				`insert into "user" (id,name,email,created_at,updated_at) values ('t1343-owner','Owner','t1343-owner@example.test',now(),now()),('t1343-worker','Worker','t1343-worker@example.test',now(),now())`,
			);
			await admin.query(
				"insert into employee(id,user_id,organization_id,role,employee_number,updated_at) values($1,'t1343-owner',$3,'admin','OWN',now()),($2,'t1343-worker',$3,'employee','WRK',now())",
				[OWNER, WORKER, ORG],
			);
			await admin.query(
				"insert into payroll_export_format(id,name,version,updated_at) values('datev_lohn','DATEV','2024.1',now()),('lexware_lohn','Lexware','2024.1',now()) on conflict do nothing",
			);
			await admin.query(
				"insert into payroll_export_config(organization_id,format_id,config,created_by,updated_at) values($1,$3,$2,'t1343-owner',now())",
				[ORG, JSON.stringify(config), formatId],
			);
		}
		async function job() {
			return createExportJob({
				organizationId: ORG,
				formatId,
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

		vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
		beforeEach(seed);
		afterAll(cleanup);
		it("makes successful empty supported output inspectable independently of configuration and requester", async () => {
			const { jobId } = await job();
			expect(
				await readPayrollBaseline({ organizationId: ORG, jobId }),
			).toBeNull();
			await processExportJob({ jobId, organizationId: ORG });
			const first = await readPayrollBaseline({ organizationId: ORG, jobId });
			expect(first?.summary.availability).toBe("empty");
			expect(first?.evidence?.employeeWindows).toEqual([
				{
					employeeId: WORKER,
					timezone: "Europe/Berlin",
					startUtc: "2026-06-30T22:00:00Z",
					endExclusiveUtc: "2026-07-31T22:00:00Z",
				},
			]);
			await admin.query(
				"delete from payroll_export_config where organization_id=$1",
				[ORG],
			);
			await admin.query("delete from employee where id=$1", [OWNER]);
			expect(await readPayrollBaseline({ organizationId: ORG, jobId })).toEqual(
				first,
			);
		});
		it("requires a current payroll grant covering the entire retained employee scope", async () => {
			const { jobId } = await job();
			await processExportJob({ jobId, organizationId: ORG });
			await expect(listPayrollBaselines()).rejects.toThrow();
			await admin.query(
				"insert into payroll_access_grant(organization_id,payroll_employee_id,scope,created_by,updated_by,updated_at) values($1,$2,'specific','t1343-owner','t1343-owner',now())",
				[ORG, OWNER],
			);
			expect(await listPayrollBaselines()).toEqual([]);
			const retained = await readPayrollBaseline({
				organizationId: ORG,
				jobId,
			});
			if (!retained) throw new Error("Baseline was not captured");
			expect(await inspectPayrollBaseline(retained.summary.id)).toBeNull();
			await admin.query(
				"insert into payroll_access_employee(organization_id,grant_id,employee_id,created_by) select $1,id,$2,'t1343-owner' from payroll_access_grant where organization_id=$1",
				[ORG, WORKER],
			);
			expect((await listPayrollBaselines()).map((row) => row.id)).toEqual([
				retained.summary.id,
			]);
			expect(
				(await inspectPayrollBaseline(retained.summary.id))?.summary
					.availability,
			).toBe("empty");
			actor.organizationId = "other-org";
			await expect(
				inspectPayrollBaseline(retained.summary.id),
			).rejects.toThrow();
			actor.organizationId = ORG;
		});
		it("retains collection-time local boundaries when the organization zone changes before delivery", async () => {
			await admin.query(
				"insert into payroll_work_collection_control(organization_id,mode) values($1,'active')",
				[ORG],
			);
			const { jobId } = await job();
			await admin.query(
				"update organization set timezone='America/New_York' where id=$1",
				[ORG],
			);
			await processExportJob({ jobId, organizationId: ORG });
			const retained = await readPayrollBaseline({
				organizationId: ORG,
				jobId,
			});
			if (!retained) throw new Error("Baseline was not captured");
			expect(retained?.evidence?.employeeWindows).toEqual([
				{
					employeeId: WORKER,
					timezone: "Europe/Berlin",
					startUtc: "2026-06-30T22:00:00Z",
					endExclusiveUtc: "2026-07-31T22:00:00Z",
				},
			]);
		});
		it("keeps actual payout rows immutable after cancellation, identity/code edits and a later export", async () => {
			await admin.query(
				"insert into payroll_wage_type_mapping(organization_id,special_category,datev_wage_type_code,lexware_wage_type_code,created_by,updated_at) values($1,'overtime','1900','1900','t1343-owner',now())",
				[ORG],
			);
			await admin.query(
				"insert into balance_adjustment(organization_id,employee_id,kind,day,minutes,reason,recorded_by) values($1,$2,'overtime_payout','2026-07-15',-90,'Paid in July','t1343-owner')",
				[ORG, WORKER],
			);
			const { jobId } = await job();
			const firstOutput = await processExportJob({
				jobId,
				organizationId: ORG,
			});
			expect(String(firstOutput.result?.content)).toContain(
				formatId === "datev_lohn"
					? '"WRK";"1900";1.50;"2026-07-15"'
					: "2026;07;WRK;1900;1,50;1,50;",
			);
			const first = await readPayrollBaseline({ organizationId: ORG, jobId });
			expect(first?.evidence?.output.rows[0]).toMatchObject({
				personnelNumber: "WRK",
				wageTypeCode: "1900",
				quantity: "1.50",
				contributions: [
					{
						kind: "overtime_payout",
						reason: "Paid in July",
						sourceActorId: "t1343-owner",
					},
				],
			});
			await admin.query(
				"update balance_adjustment set cancelled_at=now(),cancelled_by='t1343-owner',cancellation_reason='Recorded twice' where organization_id=$1",
				[ORG],
			);
			await admin.query(
				"update employee set employee_number='WRK-NEW' where id=$1",
				[WORKER],
			);
			await admin.query(
				"update payroll_wage_type_mapping set datev_wage_type_code='2900',lexware_wage_type_code='2900' where organization_id=$1",
				[ORG],
			);
			const next = await job();
			await processExportJob({ jobId: next.jobId, organizationId: ORG });
			expect(
				(await readPayrollBaseline({ organizationId: ORG, jobId: next.jobId }))
					?.summary.availability,
			).toBe("empty");
			expect(
				await readPayrollBaseline({
					organizationId: ORG,
					baselineId: first?.summary.id,
				}),
			).toEqual(first);
			await expect(
				admin.query(
					"update payroll_export_baseline set digest='changed' where id=$1",
					[first?.summary.id],
				),
			).rejects.toThrow("immutable");
		});
		it.each(["interactive", "async", "scheduled"])(
			"retains only successful attempt evidence for %s delivery and never mixes retry file bytes",
			async (mode) => {
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
				expect(retained?.summary.availability).toBe("empty");
				if (mode !== "interactive") {
					const last = storage.uploads.at(-1);
					if (!last) throw new Error("Successful attempt was not uploaded");
					expect(last.key).toContain(`/${retained?.evidence?.attemptId}/`);
					expect(retained?.evidence?.fileDigest).toBe(
						createHash("sha256").update(last.content).digest("hex"),
					);
					expect(storage.uploads[0].key).not.toBe(last.key);
				}
			},
		);
		it("denies evidence exactly at the UTC 24-calendar-month boundary and cleans it idempotently", async () => {
			const { jobId } = await job();
			await processExportJob({ jobId, organizationId: ORG });
			const first = await readPayrollBaseline({ organizationId: ORG, jobId });
			if (!first) throw new Error("missing baseline");
			const boundary = Temporal.Instant.from(first.summary.expiresAt);
			const inside = await readPayrollBaseline({
				organizationId: ORG,
				jobId,
				now: boundary.subtract({ nanoseconds: 1 }),
			});
			expect(inside?.summary.availability).toBe("empty");
			expect(
				(
					await readPayrollBaseline({
						organizationId: ORG,
						jobId,
						now: boundary,
					})
				)?.summary.availability,
			).toBe("expired");
			expect(
				await cleanupExpiredPayrollBaselines({
					now: boundary.subtract({ nanoseconds: 1 }),
				}),
			).toBe(0);
			expect(await cleanupExpiredPayrollBaselines({ now: boundary })).toBe(1);
			expect(await cleanupExpiredPayrollBaselines({ now: boundary })).toBe(0);
			expect(
				(await readPayrollBaseline({ organizationId: ORG, jobId }))?.evidence,
			).toBeNull();
		});
		it("ordinary removal of a requester in scope retains evidence while explicit employee erasure makes it unavailable", async () => {
			const created = await createExportJob({
				organizationId: ORG,
				formatId,
				requestedById: OWNER,
				filters: {
					dateRange: {
						start: DateTime.fromISO("2026-07-01", { zone: "UTC" }),
						end: DateTime.fromISO("2026-07-31", { zone: "UTC" }),
					},
					employeeIds: [OWNER, WORKER],
				},
			});
			await processExportJob({ jobId: created.jobId, organizationId: ORG });
			const retained = await readPayrollBaseline({
				organizationId: ORG,
				jobId: created.jobId,
			});
			await admin.query("delete from employee where id=$1", [OWNER]);
			expect(
				await readPayrollBaseline({
					organizationId: ORG,
					jobId: created.jobId,
				}),
			).toEqual(retained);
			expect(
				await eraseEmployeePayrollBaselines(db, {
					organizationId: ORG,
					employeeId: WORKER,
				}),
			).toBe(1);
			expect(
				(
					await readPayrollBaseline({
						organizationId: ORG,
						jobId: created.jobId,
					})
				)?.summary.availability,
			).toBe("erased");
			expect(
				(
					await readPayrollBaseline({
						organizationId: ORG,
						jobId: created.jobId,
					})
				)?.evidence,
			).toBeNull();
			expect(
				await eraseEmployeePayrollBaselines(db, {
					organizationId: ORG,
					employeeId: WORKER,
				}),
			).toBe(0);
			await admin.query("delete from organization where id=$1", [ORG]);
			expect(
				await readPayrollBaseline({
					organizationId: ORG,
					jobId: created.jobId,
				}),
			).toBeNull();
		});
		it("never retains new comparison evidence when a frozen queued job is erased before first success or replayed afterward", async () => {
			await admin.query(
				"insert into payroll_work_collection_control(organization_id,mode) values($1,'active')",
				[ORG],
			);
			const pending = await job();
			await eraseEmployeePayrollBaselines(db, {
				organizationId: ORG,
				employeeId: WORKER,
			});
			await processExportJob({ jobId: pending.jobId, organizationId: ORG });
			const first = await readPayrollBaseline({
				organizationId: ORG,
				jobId: pending.jobId,
			});
			expect(first?.summary.availability).toBe("erased");
			expect(first?.evidence).toBeNull();
			await processExportJob({ jobId: pending.jobId, organizationId: ORG });
			const retry = await readPayrollBaseline({
				organizationId: ORG,
				jobId: pending.jobId,
			});
			expect(retry?.summary.id).not.toBe(first?.summary.id);
			expect(retry?.summary.availability).toBe("erased");
			expect(retry?.evidence).toBeNull();
			const fresh = await job();
			await processExportJob({ jobId: fresh.jobId, organizationId: ORG });
			expect(
				(await readPayrollBaseline({ organizationId: ORG, jobId: fresh.jobId }))
					?.summary.availability,
			).toBe("empty");
		});
		it.runIf(formatId === "lexware_lohn")(
			"compares monthly corrections and optional columns against the actual export with stable downloads and fresh scope checks",
			async () => {
				await admin.query(
					"insert into payroll_access_grant(organization_id,payroll_employee_id,scope,created_by,updated_by,updated_at) values($1,$2,'all','t1343-owner','t1343-owner',now())",
					[ORG, OWNER],
				);
				await admin.query(
					"insert into payroll_wage_type_mapping(organization_id,special_category,lexware_wage_type_code,created_by,updated_at) values($1,'overtime','190','t1343-owner',now())",
					[ORG],
				);
				await admin.query(
					"insert into balance_adjustment(organization_id,employee_id,kind,day,minutes,reason,recorded_by) values($1,$2,'overtime_payout','2026-07-15',-90,'July payout','t1343-owner')",
					[ORG, WORKER],
				);
				const { jobId } = await job();
				await processExportJob({ jobId, organizationId: ORG });
				const retained = await readPayrollBaseline({
					organizationId: ORG,
					jobId,
				});
				if (!retained?.evidence) throw new Error("Baseline unavailable");
				expect(retained.summary.formatId).toBe("lexware_lohn");
				expect(retained.evidence.output.rows).toMatchObject([
					{
						date: "2026-07",
						quantity: "1.50",
						renderedColumns: { Wert: "1,50", Stunden: "1,50", Stundensatz: "" },
					},
				]);
				const {
					preparePayrollComparison,
					downloadPayrollComparison,
					listCompatiblePayrollBaselines,
				} = await import("./comparison-service");
				const request = {
					baselineId: retained.summary.id,
					startDate: "2026-07-01",
					endDate: "2026-07-31",
					employeeIds: [WORKER],
					formatId: "lexware_lohn" as const,
				};
				expect((await preparePayrollComparison(request)).status).toBe("ready");
				expect(
					await listCompatiblePayrollBaselines({
						...request,
						formatId: "datev_lohn",
					}),
				).toEqual([]);
				await admin.query(
					"update payroll_export_config set config=jsonb_set(config,'{includeStunden}','false') where organization_id=$1",
					[ORG],
				);
				const optional = await preparePayrollComparison(request);
				if (optional.status !== "ready") throw new Error("Expected ready");
				expect(optional.result.comparison.rows).toMatchObject([
					{
						status: "changed",
						delta: "0.00",
						changedFields: ["renderedColumns"],
					},
				]);
				expect(optional.result.comparison.totals).toMatchObject([
					{ oldQuantity: "1.50", newQuantity: "1.50", delta: "0.00" },
				]);
				await admin.query(
					"insert into balance_adjustment(organization_id,employee_id,kind,day,minutes,reason,recorded_by) values($1,$2,'overtime_payout','2026-07-29',-30,'Late July payout','t1343-owner')",
					[ORG, WORKER],
				);
				const prepared = await preparePayrollComparison(request);
				if (prepared.status !== "ready") throw new Error("Expected ready");
				expect(prepared.result.comparison.rows).toMatchObject([
					{
						status: "changed",
						delta: "+0.50",
						oldRow: { date: "2026-07", quantity: "1.50" },
						newRow: {
							date: "2026-07",
							quantity: "2.00",
							renderedColumns: { Wert: "2,00", Stundensatz: "" },
						},
					},
				]);
				const csv = await downloadPayrollComparison(prepared.result.id);
				expect(csv?.content).toContain("2026-07");
				expect(csv?.content).toContain("Wert");
				await admin.query(
					"update balance_adjustment set cancelled_at=now(),cancelled_by='t1343-owner',cancellation_reason='Duplicate' where organization_id=$1",
					[ORG],
				);
				expect(await downloadPayrollComparison(prepared.result.id)).toEqual(
					csv,
				);
				const refreshed = await preparePayrollComparison(request);
				if (refreshed.status !== "ready") throw new Error("Expected ready");
				expect(refreshed.result.id).not.toBe(prepared.result.id);
				expect(refreshed.result.comparison.rows).toMatchObject([
					{ status: "removed", delta: "-1.50", oldRow: { date: "2026-07" } },
				]);
				await admin.query(
					"update payroll_access_grant set scope='specific' where organization_id=$1",
					[ORG],
				);
				expect(await downloadPayrollComparison(prepared.result.id)).toBeNull();
			},
		);
	},
);
