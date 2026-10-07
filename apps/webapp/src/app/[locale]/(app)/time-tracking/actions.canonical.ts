import { Effect, Layer } from "effect";
import type { db } from "@/db";

import { runtime } from "@/lib/effect/runtime";
import { DatabaseService, makeDatabaseService } from "@/lib/effect/services/database.service";
import { TimeEntryService, TimeEntryServiceLive } from "@/lib/effect/services/time-entry.service";
import type { TimeEntryTimezoneSource } from "@/lib/time-tracking/timezone-capture";

type Transaction = Pick<
	Parameters<Parameters<typeof db.transaction>[0]>[0],
	"select" | "insert" | "update" | "query"
>;

function transactionDatabaseLayer(transaction: Transaction) {
	return Layer.succeed(
		DatabaseService,
		DatabaseService.of(makeDatabaseService(transaction as typeof db)),
	);
}

/**
 * Runs a TimeEntryService effect. Without a transaction it runs on the shared runtime,
 * whose AppLayer already holds the service over the global database. Inside a
 * transaction it builds TimeEntryServiceLive locally against that transaction, so the
 * service never binds to the runtime's shared instance.
 */
function runTimeEntryEffect<A, E>(
	effect: Effect.Effect<A, E, TimeEntryService>,
	transaction?: Transaction,
): Promise<A> {
	if (!transaction) return runtime.runPromise(effect);
	return Effect.runPromise(
		effect.pipe(
			Effect.provide(TimeEntryServiceLive, { local: true }),
			Effect.provide(transactionDatabaseLayer(transaction)),
		),
	);
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
		});

		return runTimeEntryEffect(effect, transaction);
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
			return yield* service.createCorrectionEntry(transaction ? { ...input, transaction } : input);
		});

		return runTimeEntryEffect(effect, transaction);
	},
};
