import "server-only";

import { eq } from "drizzle-orm";
import { timeEntry } from "@/db/schema";
import { CompletedWorkCollisionError } from "../close-active-work";
import type { SealedWorkTransactionScope, WorkTransactionAdmission } from "../work-transaction";
import type { ClockCommand } from "./types";

/**
 * A frozen command commits only through the append writer, with its receipt.
 * This is the only place admission shows through to a caller.
 */
export class FrozenCommandNotAcceptedError extends Error {
	constructor() {
		super("Frozen clock commands need append admission");
		this.name = "FrozenCommandNotAcceptedError";
	}
}

export function isFrozen(command: ClockCommand) {
	return command.payload !== undefined;
}

/**
 * The receipt's command: the frozen payload, else the writer's established
 * command. The run checked that the payload names this identity, and its
 * adapter froze the body into it.
 */
export function receiptCommandOf<Receipt extends { version: number; operationId: string }>(
	command: ClockCommand,
	established: Receipt,
): Receipt {
	return (command.payload as Receipt | undefined) ?? established;
}

/** Refuses a frozen command under legacy admission, after its committed replay. */
export function assertFrozenAccepted(command: ClockCommand, admission: WorkTransactionAdmission) {
	if (isFrozen(command) && admission !== "append") throw new FrozenCommandNotAcceptedError();
}

/**
 * A frozen command commits only with its receipt, and its operation ID is the
 * entry ID its operation writes. Without a receipt, any entry under that ID, in
 * any organization, is other work: a collision, never this command's commit.
 * Only the outcome is returned, never the row.
 */
export async function assertFrozenIdentityUnused(
	db: SealedWorkTransactionScope["db"],
	command: ClockCommand,
) {
	const [entry] = await db
		.select({ id: timeEntry.id })
		.from(timeEntry)
		.where(eq(timeEntry.id, command.identity.id))
		.limit(1);
	if (entry) throw new CompletedWorkCollisionError();
}
