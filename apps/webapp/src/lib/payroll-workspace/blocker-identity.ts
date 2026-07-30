import type { PayrollBlocker, PayrollBlockerType } from "./types";

export type PayrollBlockerIdentity = `${PayrollBlockerType}:${string}`;

export function payrollBlockerIdentity(
	blocker: Pick<PayrollBlocker, "id" | "type">,
): PayrollBlockerIdentity {
	return `${blocker.type}:${blocker.id}`;
}
