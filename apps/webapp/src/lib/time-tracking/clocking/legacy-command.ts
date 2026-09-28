import "server-only";

import type { WorkTransactionAdmission } from "../work-transaction";
import type { ClockCommand } from "./types";

/**
 * A legacy command commits only through the legacy writer. Its old consumers
 * never adopted replay-safe commands, so an adopted organization refuses them
 * (#327). Besides frozen commands, the only place admission shows through.
 */
export class LegacyCommandNotAcceptedError extends Error {
	constructor() {
		super("Legacy clock commands need legacy admission");
		this.name = "LegacyCommandNotAcceptedError";
	}
}

/**
 * Refuses a legacy command under append admission, after every committed replay,
 * so its committed actions are still answered.
 */
export function assertLegacyAccepted(command: ClockCommand, admission: WorkTransactionAdmission) {
	if (command.legacy && admission === "append") throw new LegacyCommandNotAcceptedError();
}
