import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import type { AutoClockOutDecision } from "./types";

/** The confirmed policy decision, independent of scan timing and capture preferences. */
export function deriveAutoClockOutOperationId(
	decision: Omit<AutoClockOutDecision, "operationId">,
): string {
	const identity = canonicalJson({
		organizationId: decision.organizationId,
		employeeId: decision.employeeId,
		workPeriodId: decision.workPeriodId,
		start: decision.start.toString(),
		cutoff: decision.cutoff.toString(),
		revision: decision.settings.revision,
	});
	const bytes = new Uint8Array(
		createHash("sha1").update(`z8:automatic-clock-out:v1\0${identity}`).digest().subarray(0, 16),
	);
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
