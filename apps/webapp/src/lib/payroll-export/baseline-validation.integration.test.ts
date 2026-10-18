import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";
import {
	insertPayrollBaseline,
	payrollBaselineDigest,
	readPayrollBaseline,
} from "./baseline-evidence";
import type { PayrollBaselineEvidence } from "./baseline-types";

const admin = integrationAdminPool();
const ORG = "baseline-validation-org";
const ID = "d1343000-0000-4000-8000-000000000101";
const EMPLOYEE = "d1343000-0000-4000-8000-000000000102";
const now = parseInstant("2026-10-19T00:00:00Z");
function evidence(): PayrollBaselineEvidence {
	return {
		version: 1,
		destination: {
			configId: "config-1",
			mandantennummer: "12345",
			beraternummer: "1234567",
		},
		config: { personnelNumberType: "employeeNumber", includeZeroHours: false },
		filters: {
			dateRange: { start: "2026-09-01", end: "2026-09-30" },
			employeeIds: [EMPLOYEE],
		},
		period: { startDate: "2026-09-01", endDate: "2026-09-30" },
		employeeIds: [EMPLOYEE],
		employeeWindows: [
			{
				employeeId: EMPLOYEE,
				timezone: "Europe/Berlin",
				startUtc: "2026-08-31T22:00:00Z",
				endExclusiveUtc: "2026-09-30T22:00:00Z",
			},
		],
		output: {
			version: 1,
			formatId: "datev_lohn",
			formatterVersion: "2024.1",
			excludedLineKinds: ["expense"],
			rows: [
				{
					personnelNumber: "P-1",
					wageTypeCode: "1900",
					quantity: "0.50",
					unit: "hours",
					date: "2026-09-15",
					note: "Payout",
					contributions: [
						{
							kind: "overtime_payout",
							sourceId: "payout-1",
							sourceRevision: null,
							employeeId: EMPLOYEE,
							firstName: "Ada",
							lastName: "Lovelace",
							hours: 0.5,
							reason: "Approved payout",
							sourceActorId: null,
							facts: { day: "2026-09-15", minutes: 30, mappingId: "mapping-1" },
						},
					],
				},
			],
		},
		fileDigest: "a".repeat(64),
		attemptId: "attempt-1",
	};
}
async function cleanup() {
	await admin.query("delete from organization where id=$1", [ORG]);
}
async function seed() {
	await cleanup();
	await admin.query(
		"insert into organization(id,name,slug,created_at) values($1,$1,$1,now())",
		[ORG],
	);
	await insertPayrollBaseline(db, {
		id: ID,
		jobId: ID,
		organizationId: ORG,
		createdAt: new Date("2026-10-18T00:00:00Z"),
		completedAt: new Date("2026-10-18T00:01:00Z"),
		evidence: evidence(),
	});
}
async function corrupt(
	payload: unknown,
	metadata?: { descriptor?: unknown; scope?: unknown; expiresAt?: string },
) {
	const client = await admin.connect();
	try {
		await client.query("begin");
		await client.query(
			"alter table payroll_export_baseline disable trigger payroll_export_baseline_immutable",
		);
		await client.query(
			"update payroll_export_baseline set evidence=$1,digest=$2,descriptor=coalesce($3::jsonb,descriptor),scope_employee_ids=coalesce($4::jsonb,scope_employee_ids),expires_at=coalesce($5::timestamptz,expires_at) where id=$6",
			[
				JSON.stringify(payload),
				payrollBaselineDigest(payload),
				metadata?.descriptor ? JSON.stringify(metadata.descriptor) : null,
				metadata?.scope ? JSON.stringify(metadata.scope) : null,
				metadata?.expiresAt ?? null,
				ID,
			],
		);
		await client.query(
			"alter table payroll_export_baseline enable trigger payroll_export_baseline_immutable",
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}
async function read(at = now) {
	return readPayrollBaseline({ organizationId: ORG, baselineId: ID, now: at });
}

describe("DATEV baseline validation through retained reads", () => {
	beforeEach(seed);
	afterAll(cleanup);
	it("reads a complete baseline with the exact supported row", async () => {
		expect((await read())?.summary.availability).toBe("available");
		expect((await read())?.evidence).toEqual(evidence());
	});
	it("denies malformed output instead of throwing even if its digest matches", async () => {
		await corrupt({ ...evidence(), output: null });
		expect(await read()).toMatchObject({
			summary: { availability: "corrupt" },
			evidence: null,
		});
	});
	it("denies malformed contributions even if their enclosing output looks valid", async () => {
		const payload = evidence();
		await corrupt({
			...payload,
			output: {
				...payload.output,
				rows: [
					{
						...payload.output.rows[0],
						contributions: [
							{ kind: "overtime_payout", employeeId: EMPLOYEE, facts: {} },
						],
					},
				],
			},
		});
		expect(await read()).toMatchObject({
			summary: { availability: "corrupt" },
			evidence: null,
		});
	});
	it("distinguishes a future output version from corrupted version fields", async () => {
		await corrupt({
			...evidence(),
			output: { ...evidence().output, version: 2 },
		});
		expect(await read()).toMatchObject({
			summary: { availability: "unsupported_version" },
			evidence: null,
		});
		await corrupt({ ...evidence(), version: "1" });
		expect(await read()).toMatchObject({
			summary: { availability: "corrupt" },
			evidence: null,
		});
	});
	it("denies descriptor drift without trusting the undigested summary", async () => {
		await corrupt(evidence(), {
			descriptor: {
				destination: { ...evidence().destination, mandantennummer: "999" },
				period: evidence().period,
			},
		});
		expect(await read()).toMatchObject({
			summary: { availability: "corrupt" },
			evidence: null,
		});
	});
	it("denies output contributors outside the complete resolved scope", async () => {
		const payload = evidence();
		payload.output.rows[0].contributions[0].employeeId = "outside-scope";
		await corrupt(payload);
		expect(await read()).toMatchObject({
			summary: { availability: "corrupt" },
			evidence: null,
		});
	});
	it("requires complete windows and stored scope to agree", async () => {
		await corrupt(evidence(), { scope: [EMPLOYEE, "another-employee"] });
		expect(await read()).toMatchObject({
			summary: { availability: "corrupt" },
			evidence: null,
		});
	});
	it("keeps legacy missing-window evidence unavailable without inventing windows", async () => {
		await corrupt({
			...evidence(),
			employeeWindows: [],
			employeeWindowsUnavailable: true,
		});
		expect(await read()).toMatchObject({
			summary: { availability: "legacy" },
			evidence: null,
		});
	});
	it("denies changed expiry metadata and always expires at completion plus 24 months", async () => {
		await corrupt(evidence(), { expiresAt: "2029-10-18T00:01:00Z" });
		expect(await read()).toMatchObject({
			summary: { availability: "corrupt" },
			evidence: null,
		});
		expect(await read(parseInstant("2028-10-18T00:01:00Z"))).toMatchObject({
			summary: { availability: "expired" },
			evidence: null,
		});
	});
	it("retains a leap-day completion for 24 calendar months through the last February day", async () => {
		const leapId = "d1343000-0000-4000-8000-000000000103";
		const payload = evidence();
		payload.period = { startDate: "2024-02-01", endDate: "2024-02-29" };
		payload.filters.dateRange = { start: "2024-02-01", end: "2024-02-29" };
		payload.employeeWindows = [
			{
				employeeId: EMPLOYEE,
				timezone: "Europe/Berlin",
				startUtc: "2024-01-31T23:00:00Z",
				endExclusiveUtc: "2024-02-29T23:00:00Z",
			},
		];
		for (const row of payload.output.rows) {
			row.date = "2024-02-15";
			for (const contribution of row.contributions) {
				if (contribution.kind === "overtime_payout")
					contribution.facts.day = "2024-02-15";
			}
		}
		await insertPayrollBaseline(db, {
			id: leapId,
			jobId: leapId,
			organizationId: ORG,
			createdAt: new Date("2024-02-29T14:14:00Z"),
			completedAt: new Date("2024-02-29T14:15:00Z"),
			evidence: payload,
		});
		const retained = await readPayrollBaseline({
			organizationId: ORG,
			baselineId: leapId,
			now: parseInstant("2026-02-28T14:14:59.999Z"),
		});
		expect(retained?.summary).toMatchObject({
			availability: "available",
			expiresAt: "2026-02-28T14:15:00.000Z",
		});
		expect(
			await readPayrollBaseline({
				organizationId: ORG,
				baselineId: leapId,
				now: parseInstant("2026-02-28T14:15:00Z"),
			}),
		).toMatchObject({ summary: { availability: "expired" }, evidence: null });
	});
});
