/**
 * Completes an employee's live work through work records, as every clock-out does
 * (#1222), for suites that need completed work without driving a clock command.
 * Runs in its own completed-work transaction.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { withCompletedWorkTransaction } from "../../completed-work-transaction";
import type { TimeEntryTimezoneCapture } from "../../timezone-capture";
import { applyWorkRecordChange, orRefuse, readWorkRecord, type WorkCreation } from "..";

export async function completeLiveWork(input: {
	organizationId: string;
	employeeId: string;
	/** Records the completed work and its clock-out entry. */
	actorUserId: string;
	at: Instant;
	/** The live work to complete; the employee's open work when omitted. */
	workPeriodId?: string;
	capture?: TimeEntryTimezoneCapture;
	deviceInfo?: string;
}): Promise<WorkCreation> {
	const { organizationId, employeeId } = input;
	return withCompletedWorkTransaction(
		{ organizationId, employeeId, actorUserId: input.actorUserId },
		async (scope) => {
			const [live] = await scope.db
				.select({ id: workPeriod.id })
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.employeeId, employeeId),
						isNull(workPeriod.endTime),
						isNull(workPeriod.deletedAt),
						...(input.workPeriodId ? [eq(workPeriod.id, input.workPeriodId)] : []),
					),
				)
				.orderBy(desc(workPeriod.startTime))
				.limit(1);
			if (!live) throw new Error("No live work to complete");
			const completing = await readWorkRecord(
				scope,
				{ organizationId, employeeId, workPeriodId: live.id },
				{ lock: true },
			);
			if (!completing) throw new Error("No live work to complete");
			return orRefuse(
				await applyWorkRecordChange(scope, {
					kind: "create",
					organizationId,
					employeeId,
					expected: completing.expected,
					completing,
					at: input.at,
					recordedBy: input.actorUserId,
					actorUserId: input.actorUserId,
					entries: {
						createdBy: input.actorUserId,
						ipAddress: null,
						deviceInfo: input.deviceInfo ?? "test",
						capture: input.capture ?? {
							utcOffsetMinutes: 0,
							timezone: "UTC",
							timezoneSource: "user_setting",
						},
					},
					appendOperation: "live_clock_out",
				}),
			);
		},
	);
}
