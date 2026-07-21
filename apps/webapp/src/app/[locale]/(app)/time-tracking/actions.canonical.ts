import { Effect, Layer } from "effect";
import { db } from "@/db";
import { timeRecord, timeRecordAllocation, timeRecordWork } from "@/db/schema";
import { DatabaseError } from "@/lib/effect/errors";
import {
	DatabaseService,
	DatabaseServiceLive,
} from "@/lib/effect/services/database.service";
import {
	TimeEntryService,
	TimeEntryServiceLive,
} from "@/lib/effect/services/time-entry.service";
import type { TimeEntryTimezoneSource } from "@/lib/time-tracking/timezone-capture";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CanonicalWorkRecordDbClient = Pick<typeof db, "insert">;

function transactionDatabaseLayer(transaction: Transaction) {
	return Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: transaction as unknown as typeof db,
			query: (name, fn) =>
				Effect.tryPromise({
					try: fn,
					catch: (error) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause: error,
						}),
				}),
		}),
	);
}

function timeEntryDatabaseLayer(transaction?: Transaction) {
	return transaction
		? transactionDatabaseLayer(transaction)
		: DatabaseServiceLive;
}

export const canonicalTimeEntryClient = {
	createTimeEntry: async (
		input: {
			employeeId: string;
			organizationId: string;
			type: "clock_in" | "clock_out" | "correction";
			timestamp: Date;
			createdBy: string;
			notes?: string;
			ipAddress?: string;
			deviceInfo?: string;
			utcOffsetMinutes: number;
			timezone: string;
			timezoneSource: TimeEntryTimezoneSource;
		},
		transaction?: Transaction,
	) => {
		const effect = Effect.gen(function* (_) {
			const service = yield* _(TimeEntryService);
			return yield* _(service.createTimeEntry(input));
		}).pipe(
			Effect.provide(TimeEntryServiceLive),
			Effect.provide(timeEntryDatabaseLayer(transaction)),
		);

		return Effect.runPromise(effect);
	},
	createCorrectionEntry: async (
		input: {
			employeeId: string;
			organizationId: string;
			replacesEntryId: string;
			timestamp: Date;
			createdBy: string;
			notes: string;
			ipAddress?: string;
			deviceInfo?: string;
			workPeriodId: string;
			utcOffsetMinutes: number;
			timezone: string;
			timezoneSource: TimeEntryTimezoneSource;
		},
		transaction?: Transaction,
	) => {
		const effect = Effect.gen(function* (_) {
			const service = yield* _(TimeEntryService);
			return yield* _(
				service.createCorrectionEntry(
					transaction ? { ...input, transaction } : input,
				),
			);
		}).pipe(
			Effect.provide(TimeEntryServiceLive),
			Effect.provide(timeEntryDatabaseLayer(transaction)),
		);

		return Effect.runPromise(effect);
	},
};

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
			origin: "clock" | "manual";
		},
		client?: CanonicalWorkRecordDbClient,
	) => {
		const createRecord = async (writeClient: CanonicalWorkRecordDbClient) => {
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
				computationMetadata: null,
			});

			if (input.projectId) {
				await writeClient.insert(timeRecordAllocation).values({
					organizationId: input.organizationId,
					recordId: record.id,
					allocationKind: "project",
					projectId: input.projectId,
					weightPercent: 100,
				});
			}

			return record;
		};

		return client ? createRecord(client) : db.transaction(createRecord);
	},
};
