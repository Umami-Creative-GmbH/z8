/**
 * Seeds a historical policy clock-out approval for PostgreSQL integration tests.
 *
 * Live clock-outs never route approval (#361), but `policy_clock_out` requests
 * submitted before that stay decidable, replayable and finalizable. This turns an
 * already closed period into such a request: it records the pending clock-out
 * evidence a policy clock-out carried, then submits it through the real ordinary
 * work-period submission. Only used against the label-owned disposable database.
 */
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { db } from "@/db";
import { timeRecord, workPeriod } from "@/db/schema";
import { executeOrdinaryWorkPeriodSubmissionInTransaction } from "@/lib/approvals/server/work-period-submission";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { POLICY_CLOCK_OUT_APPROVAL_REASON } from "@/lib/approvals/time-request-kind";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { createOrdinaryApprovalRuntime } from "@/app/[locale]/(app)/time-tracking/actions/clocking";
import { resolvePolicyClockOutBreakSnapshotInTransaction } from "../policy-clock-out-break-snapshot";
import { resolvePolicyClockOutSurchargeSnapshotInTransaction } from "../policy-clock-out-surcharge-snapshot";

export type HistoricalPolicyClockOut = Awaited<
	ReturnType<typeof executeOrdinaryWorkPeriodSubmissionInTransaction>
>;

/**
 * Submits the closed `workPeriodId` as a pending policy clock-out. The submission
 * identity is the period's clock-out entry, as a live policy clock-out used. A
 * repeated call leaves the submitted evidence untouched and replays the submission.
 */
export async function submitHistoricalPolicyClockOut(input: {
	organizationId: string;
	employeeId: string;
	userId: string;
	teamId?: string | null;
	workPeriodId: string;
}): Promise<HistoricalPolicyClockOut> {
	const runtime = createOrdinaryApprovalRuntime();
	return runtime.repository.withTransaction(async (context) => {
		const tx = context.dbService.db as typeof db;
		const [period] = await tx
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, input.workPeriodId),
					eq(workPeriod.organizationId, input.organizationId),
					eq(workPeriod.employeeId, input.employeeId),
				),
			)
			.for("update")
			.limit(1);
		if (!period?.endTime || !period.clockOutId || period.durationMinutes === null) {
			throw new Error("A historical policy clock-out needs a closed period");
		}
		// `pending_changes` is a text column: it reads back as the stored JSON string.
		const pending: unknown =
			typeof period.pendingChanges === "string"
				? JSON.parse(period.pendingChanges)
				: period.pendingChanges;
		const submitted =
			(pending as { ordinarySubmission?: unknown } | null)?.ordinarySubmission !== undefined;
		const start = instantFromDate(period.startTime);
		const end = instantFromDate(period.endTime);
		const dbService = { db: tx };
		if (!submitted) {
			const breakPolicySnapshot = await resolvePolicyClockOutBreakSnapshotInTransaction({
				dbService,
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				endTime: end,
			});
			const surchargeSnapshot = await resolvePolicyClockOutSurchargeSnapshotInTransaction({
				dbService,
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				startTime: start,
				endTime: end,
			});
			await tx
				.update(workPeriod)
				.set({
					approvalStatus: "pending",
					pendingChanges: {
						originalStartTime: period.startTime.toISOString(),
						originalEndTime: period.endTime.toISOString(),
						originalDurationMinutes: period.durationMinutes,
						requestedAt: period.endTime.toISOString(),
						requestedBy: input.userId,
						isNewClockOut: true,
						ordinarySubmission: {
							submissionId: period.clockOutId,
							kind: "policy_clock_out" as const,
						},
						breakPolicySnapshot,
						surchargeSnapshot,
					},
				})
				.where(eq(workPeriod.id, period.id));
			if (period.canonicalRecordId) {
				await tx
					.update(timeRecord)
					.set({ approvalState: "pending" })
					.where(
						and(
							eq(timeRecord.id, period.canonicalRecordId),
							eq(timeRecord.organizationId, input.organizationId),
						),
					);
			}
		}
		const approvalDbService: ApprovalDbService = {
			db: tx as unknown as ApprovalDbService["db"],
			query: <T>(_name: string, operation: () => Promise<T>) => Effect.promise(operation),
		};
		return executeOrdinaryWorkPeriodSubmissionInTransaction({
			dbService: approvalDbService,
			context,
			organizationId: input.organizationId,
			workPeriodId: period.id,
			submissionId: period.clockOutId,
			requesterEmployeeId: input.employeeId,
			requesterUserId: input.userId,
			teamId: input.teamId ?? null,
			defaultApproverId: null,
			reason: POLICY_CLOCK_OUT_APPROVAL_REASON,
			overtimeRisk: "warning",
			kind: "policy_clock_out",
			metadata: {},
		});
	});
}
