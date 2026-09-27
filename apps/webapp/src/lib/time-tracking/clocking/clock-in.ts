import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { type employee, timeEntry, workPeriod } from "@/db/schema";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { clockingService } from "../clocking-service";
import {
	type ClockChannel,
	CompletedWorkCollisionError,
	clockSource,
	liveClockOutWriter,
} from "../close-active-work";
import {
	findLiveWorkOccupant,
	replayStartLiveWork,
	type StartLiveWorkOperationCommand,
	type StartLiveWorkWriter,
	startLiveWork,
} from "../start-live-work";
import type { TimeEntryTimezoneCapture } from "../timezone-capture";
import type { SealedWorkTransactionScope } from "../work-transaction";
import type { ClockInCommand, ClockInRefusal, ClockInResult } from "./types";

type Employee = typeof employee.$inferSelect;

const CLOCK_IN_COMMAND_VERSION = 1;

/** The receipt's frozen command; a retry must carry exactly the same value. */
export type ClockInReceiptCommand = StartLiveWorkOperationCommand & {
	version: typeof CLOCK_IN_COMMAND_VERSION;
	/** Device-captured event instant; null when the server sampled it. */
	requestedInstant: string | null;
	browserTimezone: string | null;
	deviceInfo: ClockChannel;
};

/** One clock-in command, resolved against its subject. */
export type ClockInPlan = {
	command: ClockInCommand;
	employee: Employee;
	receiptCommand: ClockInReceiptCommand;
	writer: StartLiveWorkWriter;
};

/** Inside the work transaction: the start committed, replayed, or refused without writes. */
export type ClockInStart =
	| { disposition: "executed" | "replayed"; entry: ClockInResult }
	| { disposition: "refused"; refusal: ClockInRefusal };

export function planClockIn(command: ClockInCommand, employee: Employee): ClockInPlan {
	const { body, identity, at, zone, channel } = command;
	return {
		command,
		employee,
		receiptCommand: {
			version: CLOCK_IN_COMMAND_VERSION,
			operationId: identity.id,
			workLocationType: body.workLocationType,
			requestedInstant: at.kind === "occurred" ? instantToCanonicalString(at.instant) : null,
			browserTimezone: zone.device,
			deviceInfo: channel,
		},
		// The live channel's writer names the channel, not the kind, as for web breaks.
		writer: liveClockOutWriter(channel),
	};
}

/**
 * A receipt-less start committed under this identity by the legacy writer, whose
 * clock-in entry takes the operation ID. Another entry of the employee under the
 * ID, or a different start, is a collision. The read stays in the organization:
 * a foreign entry with the ID only makes the start's own insert fail.
 */
async function replayLegacyClockIn(
	scope: SealedWorkTransactionScope,
	plan: ClockInPlan,
): Promise<ClockInResult | null> {
	const { command, employee } = plan;
	const [entry] = await scope.db
		.select()
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.id, command.identity.id),
				eq(timeEntry.organizationId, employee.organizationId),
				eq(timeEntry.employeeId, employee.id),
			),
		)
		.limit(1);
	if (!entry) return null;
	const [period] = await scope.db
		.select({ workLocationType: workPeriod.workLocationType, deletedAt: workPeriod.deletedAt })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, employee.organizationId),
				eq(workPeriod.employeeId, employee.id),
				eq(workPeriod.clockInId, entry.id),
			),
		)
		.limit(1);
	const { at } = command;
	if (
		entry.type !== "clock_in" ||
		entry.isSuperseded ||
		entry.deviceInfo !== command.channel ||
		(at.kind === "occurred" &&
			compareInstants(instantFromDate(entry.timestamp), at.instant) !== 0) ||
		!period ||
		period.deletedAt !== null ||
		period.workLocationType !== command.body.workLocationType
	) {
		throw new CompletedWorkCollisionError();
	}
	return entry;
}

/**
 * The committed start for this identity, or null. Receipts precede the legacy
 * matcher in every admission, so a later admission change still replays exactly.
 */
export async function replayClockIn(
	scope: SealedWorkTransactionScope,
	plan: ClockInPlan,
): Promise<ClockInResult | null> {
	const receipt = await replayStartLiveWork(scope, {
		organizationId: plan.employee.organizationId,
		employeeId: plan.employee.id,
		command: plan.receiptCommand,
		writer: plan.writer.writer,
	});
	if (receipt) return receipt.entry as ClockInResult;
	return replayLegacyClockIn(scope, plan);
}

/**
 * Starts live work inside the work transaction, through the admission's writer.
 * Replayable identities re-check replay first, since a matching command may have
 * committed after the first replay read. Live work and completed-work occupancy
 * refuse the start under both admissions.
 */
export async function startClockIn(
	scope: SealedWorkTransactionScope,
	input: {
		plan: ClockInPlan;
		replayable: boolean;
		eventInstant: Instant;
		capture: TimeEntryTimezoneCapture;
	},
): Promise<ClockInStart> {
	const { plan, eventInstant, capture } = input;
	const { command, employee } = plan;
	if (input.replayable) {
		const replay = await replayClockIn(scope, plan);
		if (replay) return { disposition: "replayed", entry: replay };
	}
	const [live] = await scope.db
		.select({ startTime: workPeriod.startTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, employee.organizationId),
				eq(workPeriod.employeeId, employee.id),
				isNull(workPeriod.endTime),
			),
		)
		.limit(1);
	if (live) {
		return {
			disposition: "refused",
			refusal: { code: "already_clocked_in", since: instantFromDate(live.startTime) },
		};
	}
	const scopeIds = { organizationId: employee.organizationId, employeeId: employee.id };
	if (await findLiveWorkOccupant(scope.db, scopeIds, dateFromInstant(eventInstant))) {
		return { disposition: "refused", refusal: { code: "occupancy_conflict" } };
	}
	if (scope.admission === "append") {
		const started = await startLiveWork(scope, {
			...scopeIds,
			actorUserId: command.principal.userId,
			command: plan.receiptCommand,
			writer: plan.writer,
			eventInstant,
			capture,
		});
		return { disposition: "executed", entry: started.entry as ClockInResult };
	}
	// The legacy hash-chained writer: its clock-in entry takes the operation ID.
	const { entry } = await clockingService.clockIn({
		coordination: scope,
		actionId: command.identity.id,
		...scopeIds,
		createdBy: command.principal.userId,
		action: { instant: eventInstant, ...capture },
		source: clockSource(command.channel),
		workLocationType: command.body.workLocationType,
	});
	return { disposition: "executed", entry: entry as ClockInResult };
}
