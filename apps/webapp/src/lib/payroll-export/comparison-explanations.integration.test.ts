import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import type { PayrollBaselineEvidence } from "./baseline-types";
import { readPayrollComparisonExplanations } from "./comparison-explanations";
import type { SupportedPayrollContribution } from "./supported-output-evidence";

const admin = integrationAdminPool();
const org = "t1344-source-explanations";
const userId = "t1344-source-actor";
const employeeId = randomUUID();
const payoutId = randomUUID();
const unchangedPayoutId = randomUUID();
const absenceId = randomUUID();
const pendingAbsenceId = randomUUID();
async function cleanup() {
	await admin.query("delete from organization where id=$1", [org]);
	await admin.query('delete from "user" where id=$1', [userId]);
}
beforeAll(async () => {
	await cleanup();
	await admin.query(
		"insert into organization(id,name,slug,created_at) values($1,$1,$1,now())",
		[org],
	);
	await admin.query(
		'insert into "user"(id,name,email,created_at,updated_at) values($1,$1,$2,now(),now())',
		[userId, `${userId}@example.test`],
	);
	await admin.query(
		"insert into employee(id,user_id,organization_id,role,employee_number,updated_at) values($1,$2,$3,'employee','001',now())",
		[employeeId, userId, org],
	);
	await admin.query(
		"insert into balance_adjustment(id,organization_id,employee_id,kind,day,minutes,reason,recorded_by,recorded_at,cancelled_at,cancelled_by,cancellation_reason) values($1,$3,$4,'overtime_payout','2026-09-15',-60,'Original payout request',$5,'2026-09-20T00:00:00Z','2026-10-02T00:00:00Z',$5,'Paid through another route'),($2,$3,$4,'overtime_payout','2026-09-15',-60,'Unchanged original reason',$5,'2026-09-20T00:00:00Z',null,null,null)",
		[payoutId, unchangedPayoutId, org, employeeId, userId],
	);
	for (const [canonicalId, status] of [
		[absenceId, "approved"],
		[pendingAbsenceId, "pending"],
	]) {
		await admin.query(
			"insert into absence_change_request(organization_id,employee_id,absence_id,kind,status,original,reason,submitted_by,decided_at,decided_by) values($1,$2,$3,'cancel',$4,$5,'Leave rescheduled',$6,'2026-10-02T00:00:00Z',$6)",
			[
				org,
				employeeId,
				randomUUID(),
				status,
				JSON.stringify({
					canonicalRecordId: canonicalId,
					startDate: "2026-09-15",
					endDate: "2026-09-15",
					startPeriod: "full_day",
					endPeriod: "full_day",
					categoryId: randomUUID(),
					updatedAt: "2026-09-15T00:00:00Z",
					canonical: null,
				}),
				userId,
			],
		);
	}
});
afterAll(cleanup);

function baseline(): PayrollBaselineEvidence {
	const payout = (sourceId: string): SupportedPayrollContribution => ({
		kind: "overtime_payout",
		sourceId,
		sourceRevision: null,
		employeeId,
		firstName: null,
		lastName: null,
		hours: 1,
		reason: "Original source reason",
		facts: { day: "2026-09-15", minutes: 60, mappingId: null },
	});
	const absence = (sourceId: string): SupportedPayrollContribution => ({
		kind: "absence",
		sourceId,
		sourceRevision: null,
		employeeId,
		firstName: null,
		lastName: null,
		hours: 8,
		reason: "Original source note",
		facts: {
			startDate: "2026-09-15",
			endDate: "2026-09-15",
			absenceCategoryId: randomUUID(),
			absenceCategoryName: null,
			absenceType: null,
			status: "approved",
			mappingId: randomUUID(),
		},
	});
	return {
		version: 1,
		destination: {
			configId: randomUUID(),
			mandantennummer: "123",
			beraternummer: "123",
		},
		config: {},
		filters: { dateRange: { start: "2026-09-01", end: "2026-09-30" } },
		period: { startDate: "2026-09-01", endDate: "2026-09-30" },
		employeeIds: [employeeId],
		employeeWindows: [],
		output: {
			version: 1,
			formatId: "datev_lohn",
			formatterVersion: "2024.1",
			excludedLineKinds: ["expense"],
			rows: [
				{
					personnelNumber: "001",
					date: "2026-09-15",
					wageTypeCode: "1900",
					quantity: "18.00",
					unit: "hours",
					note: "",
					contributions: [
						payout(payoutId),
						payout(unchangedPayoutId),
						absence(absenceId),
						absence(pendingAbsenceId),
					],
				},
			],
		},
		fileDigest: "a".repeat(64),
		attemptId: randomUUID(),
	};
}

it("reads explicit post-baseline cancellations with actors while ignoring unchanged reasons and unapproved proposals", async () => {
	const evidence = baseline();
	const explanations = await db.transaction(
		(reader) =>
			readPayrollComparisonExplanations(reader, {
				organizationId: org,
				baseline: evidence,
				baselineCompletedAt: "2026-10-01T00:00:00Z",
				current: { ...evidence.output, rows: [] },
			}),
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
	expect(explanations).toEqual(
		expect.arrayContaining([
			{
				kind: "overtime_payout",
				sourceId: payoutId,
				employeeId,
				action: "cancelled",
				actorId: userId,
				reason: "Paid through another route",
			},
			{
				kind: "absence",
				sourceId: absenceId,
				employeeId,
				action: "absence_cancel_approved",
				actorId: userId,
				reason: "Leave rescheduled",
			},
		]),
	);
	expect(explanations).toHaveLength(2);
	const otherOrg = await readPayrollComparisonExplanations(db, {
		organizationId: "another-org",
		baseline: evidence,
		baselineCompletedAt: "2026-10-01T00:00:00Z",
		current: evidence.output,
	});
	expect(otherOrg).toEqual([]);
	const noScope = await readPayrollComparisonExplanations(db, {
		organizationId: org,
		baseline: { ...evidence, employeeIds: [randomUUID()] },
		baselineCompletedAt: "2026-10-01T00:00:00Z",
		current: evidence.output,
	});
	expect(noScope).toEqual([]);
});
