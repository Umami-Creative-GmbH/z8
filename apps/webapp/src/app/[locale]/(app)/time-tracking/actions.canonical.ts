import { Effect, Layer } from "effect";
import { db } from "@/db";
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

type Transaction = Pick<
	Parameters<Parameters<typeof db.transaction>[0]>[0],
	"select" | "insert" | "update" | "query"
>;

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

// TimeEntryServiceLive is also in the v4 AppLayer. Callers build it locally so it
// always binds to this call's database layer, never to one shared for global db.
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
		const effect = Effect.gen(function* () {
			const service = yield* TimeEntryService;
			return yield* service.createTimeEntry(input);
		}).pipe(
			Effect.provide(TimeEntryServiceLive, { local: true }),
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
		const effect = Effect.gen(function* () {
			const service = yield* TimeEntryService;
			return yield* service.createCorrectionEntry(
				transaction ? { ...input, transaction } : input,
			);
		}).pipe(
			Effect.provide(TimeEntryServiceLive, { local: true }),
			Effect.provide(timeEntryDatabaseLayer(transaction)),
		);

		return Effect.runPromise(effect);
	},
};
