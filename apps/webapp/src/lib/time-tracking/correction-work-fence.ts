/**
 * Adoption fence for the approval engine's time-correction adapter (#301). Any
 * approval runtime can drive a correction terminal; outside the coordinated work
 * transaction an organization whose append control is active is refused rather
 * than written with the legacy rules. Kept free of completed-work imports so the
 * approval runtime can load it without a cycle.
 */
import {
	readAppendAdmission,
	type WorkTransactionClient,
	workTransactionScopeFor,
} from "./work-transaction";

export class TimeCorrectionWorkScopeError extends Error {
	constructor() {
		super("Adopted correction lifecycles must run inside the coordinated work transaction");
		this.name = "TimeCorrectionWorkScopeError";
	}
}

export async function assertCorrectionWorkCoordinated(
	client: object,
	organizationId: string,
): Promise<void> {
	if (workTransactionScopeFor(client)) return;
	const admission = await readAppendAdmission(
		client as Pick<WorkTransactionClient, "select">,
		organizationId,
	);
	if (admission === "append") throw new TimeCorrectionWorkScopeError();
}
