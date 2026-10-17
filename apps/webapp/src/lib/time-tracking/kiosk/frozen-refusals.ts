import "server-only";

import type { Instant } from "@/lib/datetime/temporal-core";
import type { KioskTimeSource } from "../clocking/types";
import type {
	KioskFrozenAction,
	KioskFrozenCommand,
	KioskFrozenRefusalReason,
} from "./frozen-command";

/**
 * A refused frozen kiosk command (#1289): the one place a refusal leaves the
 * frozen kiosk command pipeline. #1290 records it (organization-scoped, once per
 * kiosk and operation), notifies the employee or, for a kiosk-only employee,
 * their managers, and lists it in the kiosk's settings. Nothing about the
 * refused command was written to work or receipts; a wrong PIN's failure is
 * already stored for the lockout (#1288).
 */
export type KioskFrozenRefusal = {
	organizationId: string;
	kioskId: string;
	operationId: string;
	/** The employee the command names, as it names them. */
	employeeId: string;
	/** That employee in the kiosk's organization, or null when they are none of its employees. */
	employee: { id: string; userId: string } | null;
	action: KioskFrozenAction;
	/** The instant the command claims. */
	claimedAt: Instant;
	/** The zone the kiosk recorded the command in: its claimed time is shown in it. */
	timezone: string;
	timeSource: KioskTimeSource;
	reason: KioskFrozenRefusalReason;
	/** The reason's details as the kiosk was answered, e.g. `{ lockedUntil }`, `{ month }`, `{ reason }`. */
	detail: Record<string, unknown>;
	/** The frozen command's bytes: a resend with the same bytes is the same refused command. */
	command: KioskFrozenCommand;
	/** When Z8 refused it. */
	refusedAt: Instant;
};

/** What telling people about a refusal reads of it. */
export type KioskFrozenRefusalNotice = Pick<
	KioskFrozenRefusal,
	| "organizationId"
	| "kioskId"
	| "operationId"
	| "employee"
	| "action"
	| "claimedAt"
	| "timezone"
	| "reason"
>;

/** A refusal recorded earlier for this kiosk's operation. */
export type RecordedKioskFrozenRefusal = {
	reason: KioskFrozenRefusalReason;
	detail: Record<string, unknown>;
	/** The bytes that were refused; other bytes under the identity are a collision. */
	command: unknown;
};

/**
 * Where refusals go. `record` is called exactly once for each refused
 * judgment, before the kiosk is answered; if it throws, the kiosk is answered
 * `unknown` and asks again. `recall` answers a resend (and the lookup) from the
 * record instead of judging the command, and its PIN, again; it may throw too
 * (e.g. a notification owed for the record still cannot be sent), and the kiosk
 * then asks again later.
 */
export type KioskFrozenRefusalLedger = {
	recall(input: {
		organizationId: string;
		kioskId: string;
		operationId: string;
	}): Promise<RecordedKioskFrozenRefusal | null>;
	record(refusal: KioskFrozenRefusal): Promise<void>;
};

/**
 * Keeps nothing, so a resend is judged again (tests that need no record).
 * Production uses `createKioskFrozenRefusalLedger` in `frozen-refusal-store.ts` (#1290).
 */
export const unrecordedKioskFrozenRefusals: KioskFrozenRefusalLedger = {
	recall: async () => null,
	record: async () => {},
};
