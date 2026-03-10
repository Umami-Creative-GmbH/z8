import { Effect } from "effect";
import { db } from "@/db";
import { timeRecord, timeRecordAllocation, timeRecordWork } from "@/db/schema";
import {
	DatabaseServiceLive,
} from "@/lib/effect/services/database.service";
import {
	TimeEntryService,
	TimeEntryServiceLive,
} from "@/lib/effect/services/time-entry.service";

export const canonicalTimeEntryClient = {
	createTimeEntry: async (input: {
		employeeId: string;
		organizationId: string;
		type: "clock_in" | "clock_out" | "correction";
		timestamp: Date;
		createdBy: string;
		notes?: string;
		ipAddress?: string;
		deviceInfo?: string;
	}) => {
		const effect = Effect.gen(function* (_) {
			const service = yield* _(TimeEntryService);
			return yield* _(service.createTimeEntry(input));
		}).pipe(
			Effect.provide(TimeEntryServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

		return Effect.runPromise(effect);
	},
	createCorrectionEntry: async (input: {
		employeeId: string;
		organizationId: string;
		replacesEntryId: string;
		timestamp: Date;
		createdBy: string;
		notes: string;
		ipAddress?: string;
		deviceInfo?: string;
	}) => {
		const effect = Effect.gen(function* (_) {
			const service = yield* _(TimeEntryService);
			return yield* _(service.createCorrectionEntry(input));
		}).pipe(
			Effect.provide(TimeEntryServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

		return Effect.runPromise(effect);
	},
};

export const canonicalWorkRecordClient = {
	createForCompletedPeriod: async (input: {
		organizationId: string;
		employeeId: string;
		startAt: Date;
		endAt: Date;
		durationMinutes: number;
		approvalState: "pending" | "approved" | "rejected";
		createdBy: string;
		workCategoryId?: string | null;
		workLocationType?: "office" | "home" | "field" | "other" | null;
		projectId?: string | null;
		origin: "clock" | "manual";
	}) => {
		return db.transaction(async (tx) => {
			const [record] = await tx
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

			await tx.insert(timeRecordWork).values({
				recordId: record.id,
				organizationId: input.organizationId,
				recordKind: "work",
				workCategoryId: input.workCategoryId ?? null,
				workLocationType: input.workLocationType ?? null,
				computationMetadata: null,
			});

			if (input.projectId) {
				await tx.insert(timeRecordAllocation).values({
					organizationId: input.organizationId,
					recordId: record.id,
					allocationKind: "project",
					projectId: input.projectId,
					weightPercent: 100,
				});
			}

			return record;
		});
	},
};
