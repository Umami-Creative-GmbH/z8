import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { amendCompletedWork } from "./amend-completed-work";
import { withCompletedWorkTransaction } from "./completed-work-transaction";

/**
 * Standalone project change of the owner's own work period (#286). Adopted
 * organizations run the completed-work operation: the period, the canonical
 * project allocation and the work revision change together, eligibility is
 * re-checked under the locks and a receipt records the change. Legacy
 * organizations keep the period-only update inside the coordinated transaction.
 *
 * The request carries no identity, so the server generates one: it names the
 * committed operation but cannot prove that a later identical request is a retry.
 */
export async function changeWorkPeriodProject(input: {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	period: Pick<
		typeof workPeriod.$inferSelect,
		"id" | "clockInId" | "clockOutId" | "startTime" | "endTime"
	>;
	projectId: string | null;
}): Promise<void> {
	await withCompletedWorkTransaction(
		{
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			actorUserId: input.actorUserId,
		},
		async (scope) => {
			if (scope.admission === "legacy") {
				await scope.db
					.update(workPeriod)
					.set({ projectId: input.projectId, updatedAt: new Date() })
					.where(
						and(
							eq(workPeriod.id, input.period.id),
							eq(workPeriod.organizationId, input.organizationId),
							isNull(workPeriod.deletedAt),
						),
					);
				return;
			}
			await amendCompletedWork(scope, {
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				actorUserId: input.actorUserId,
				authority: "owner",
				writer: "work_period_attribution_edit",
				command: {
					version: 1,
					operationId: randomUUID(),
					request: { workPeriodId: input.period.id, projectId: input.projectId },
				},
				intent: {
					workPeriodId: input.period.id,
					clockIn: { kind: "preserve" },
					clockOut: { kind: "preserve" },
					project: input.projectId ? { kind: "replace", id: input.projectId } : { kind: "clear" },
					workCategory: { kind: "preserve" },
					workLocation: { kind: "preserve" },
					notes: null,
				},
				expectedSource: {
					clockInId: input.period.clockInId,
					clockOutId: input.period.clockOutId,
					startAt: instantFromDate(input.period.startTime),
					endAt: input.period.endTime ? instantFromDate(input.period.endTime) : null,
				},
				evaluatedAt: systemClock.nowInstant(),
				request: { ipAddress: null, deviceInfo: null },
			});
		},
	);
}
