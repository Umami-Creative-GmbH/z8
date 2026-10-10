import "server-only";

import { db } from "@/db";
import { timeRecord, timeRecordAllocation, timeRecordWork } from "@/db/schema";
import type { WorkLocationType } from "./work-location";

type CanonicalWorkRecordDbClient = Pick<typeof db, "insert">;

/**
 * Writes the canonical record of a completed work period: its base record, work
 * facts and optional project allocation. The approval write boundary pins these
 * inserts to `createForCompletedPeriodInTransaction`.
 */
export const canonicalWorkRecordClient = {
	createForCompletedPeriod: async (
		input: {
			organizationId: string;
			employeeId: string;
			startAt: Date;
			endAt: Date;
			durationMinutes: number;
			approvalState: "pending" | "approved" | "rejected";
			createdBy: string;
			workCategoryId?: string | null;
			workLocationType?: WorkLocationType | null;
			projectId?: string | null;
			/** Carried on the project allocation (#900); ignored without a project. */
			isBillable?: boolean;
			/** A task of `projectId` (#873); only recorded with the project. */
			taskId?: string | null;
			computationMetadata?: string | null;
			origin: "clock" | "manual";
		},
		client?: CanonicalWorkRecordDbClient,
	) => {
		const createForCompletedPeriodInTransaction = async (
			writeClient: CanonicalWorkRecordDbClient,
		) => {
			const [record] = await writeClient
				.insert(timeRecord)
				.values({
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					recordKind: "work",
					startAt: input.startAt,
					endAt: input.endAt,
					durationMinutes: input.durationMinutes,
					approvalState: input.approvalState,
					origin: input.origin,
					createdBy: input.createdBy,
					updatedBy: input.createdBy,
				})
				.returning({ id: timeRecord.id });

			await writeClient.insert(timeRecordWork).values({
				recordId: record.id,
				organizationId: input.organizationId,
				recordKind: "work",
				workCategoryId: input.workCategoryId ?? null,
				workLocationType: input.workLocationType ?? null,
				computationMetadata: input.computationMetadata ?? null,
			});

			if (input.projectId) {
				await writeClient.insert(timeRecordAllocation).values({
					organizationId: input.organizationId,
					recordId: record.id,
					allocationKind: "project",
					projectId: input.projectId,
					taskId: input.taskId ?? null,
					weightPercent: 100,
					isBillable: input.isBillable ?? false,
				});
			}

			return record;
		};

		return client
			? createForCompletedPeriodInTransaction(client)
			: db.transaction(createForCompletedPeriodInTransaction);
	},
};
