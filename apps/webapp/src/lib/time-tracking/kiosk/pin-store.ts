import "server-only";

import { randomInt } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, asc, eq, lt, lte } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { employee, employeeKioskPin, employeeKioskPinEvent } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { type AuditTrail, withAuditTrail } from "@/lib/audit-trail";
import { isOrganizationAdminPrincipal } from "@/lib/authorization/organization-admin";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { CLOCK_COMMAND_ADMISSION_WINDOWS } from "@/lib/time-tracking/clock-command";
import { isUuid } from "@/lib/validations/uuid";
import { GENERATED_KIOSK_PIN_LENGTH, isValidKioskPin, KIOSK_PIN_LOCK_MINUTES } from "./pin";
import { KioskPinRefusal } from "./pin-errors";
import { type KioskPinLockout, type KioskPinLockoutEvent, kioskPinLockoutAt } from "./pin-lockout";

type Database = typeof rootDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * What a kiosk PIN verification answers, and nothing more: the PIN matched,
 * it did not, the employee is locked out until `until`, or has no PIN. An
 * employee outside the organization reads as `no_pin`.
 */
export type KioskPinVerification =
	| { status: "verified" }
	| { status: "wrong_pin" }
	| { status: "locked"; until: Instant }
	| { status: "no_pin" };

export type KioskPinManagementInput = {
	organizationId: string;
	/** The owner, admin or direct manager acting. */
	actorUserId: string;
	employeeId: string;
};

export type KioskPinStatus = {
	hasPin: boolean;
	/** Set only while the employee is locked out. */
	lockedUntil: Instant | null;
};

function generateKioskPin(): string {
	return String(randomInt(0, 10 ** GENERATED_KIOSK_PIN_LENGTH)).padStart(
		GENERATED_KIOSK_PIN_LENGTH,
		"0",
	);
}

function employeePin(organizationId: string, employeeId: string) {
	return and(
		eq(employeeKioskPin.employeeId, employeeId),
		eq(employeeKioskPin.organizationId, organizationId),
	);
}

/**
 * Whether the actor may issue, reset or unlock this employee's PIN: an owner or
 * admin of the organization, or the employee's direct manager. The employee
 * must belong to the organization (checked by the caller).
 */
export async function canManageEmployeeKioskPin(
	db: Database,
	input: KioskPinManagementInput,
): Promise<boolean> {
	const principal = await loadOrganizationPrincipalContext(db, {
		userId: input.actorUserId,
		organizationId: input.organizationId,
	});
	return (
		isOrganizationAdminPrincipal(principal) ||
		principal.managedEmployeeIds.includes(input.employeeId)
	);
}

async function requireKioskPinManager(db: Database, input: KioskPinManagementInput) {
	const [target] = isUuid(input.employeeId)
		? await db
				.select({ id: employee.id })
				.from(employee)
				.where(
					and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
				)
				.limit(1)
		: [];
	if (!target) {
		throw new KioskPinRefusal("employee_not_found", "Employee not found in this organization.");
	}
	if (!(await canManageEmployeeKioskPin(db, input))) {
		throw new KioskPinRefusal(
			"not_allowed",
			"Only owners, admins and the employee's direct manager can manage kiosk PINs.",
		);
	}
}

/**
 * The PIN change's audit entry, written in the change's own transaction like
 * every other kiosk write (kiosks, assigned locations), so both commit together;
 * `withAuditTrail` forwards it to the external audit service after the commit.
 */
function auditPin(
	audit: AuditTrail,
	tx: Pick<Transaction, "insert">,
	action: AuditAction,
	input: { organizationId: string; actorUserId: string; employeeId: string },
) {
	return audit.record(tx, {
		organizationId: input.organizationId,
		targetType: "kiosk_pin",
		targetId: input.employeeId,
		action,
		actorUserId: input.actorUserId,
		employeeId: input.employeeId,
	});
}

/** Gives an employee without a PIN a generated one. The PIN is returned once and never stored. */
export async function issueKioskPin(
	db: Database,
	input: KioskPinManagementInput,
): Promise<{ pin: string }> {
	await requireKioskPinManager(db, input);
	const pin = generateKioskPin();
	const pinHash = await hashPassword(pin);
	await withAuditTrail((audit) =>
		db.transaction(async (tx) => {
			const inserted = await tx
				.insert(employeeKioskPin)
				.values({
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					pinHash,
					setByUserId: input.actorUserId,
				})
				.onConflictDoNothing({ target: employeeKioskPin.employeeId })
				.returning({ id: employeeKioskPin.id });
			if (inserted.length === 0) {
				throw new KioskPinRefusal(
					"pin_exists",
					"This employee already has a kiosk PIN. Reset it instead.",
				);
			}
			await auditPin(audit, tx, AuditAction.KIOSK_PIN_ISSUED, input);
		}),
	);
	return { pin };
}

/** Replaces an employee's PIN with a generated one and clears any lockout. Returned once. */
export async function resetKioskPin(
	db: Database,
	input: KioskPinManagementInput,
	clock: Clock = systemClock,
): Promise<{ pin: string }> {
	await requireKioskPinManager(db, input);
	const pin = generateKioskPin();
	const pinHash = await hashPassword(pin);
	await withAuditTrail((audit) =>
		db.transaction(async (tx) => {
			const updated = await tx
				.update(employeeKioskPin)
				.set({ pinHash, setByUserId: input.actorUserId, updatedAt: new Date() })
				.where(employeePin(input.organizationId, input.employeeId))
				.returning({ id: employeeKioskPin.id });
			if (updated.length === 0) {
				throw new KioskPinRefusal(
					"no_pin",
					"This employee has no kiosk PIN yet. Issue one instead.",
				);
			}
			await recordCleared(tx, input, clock);
			await auditPin(audit, tx, AuditAction.KIOSK_PIN_RESET, input);
		}),
	);
	return { pin };
}

/** Lifts a lockout and starts the failure count again, from now on. */
export async function unlockKioskPin(
	db: Database,
	input: KioskPinManagementInput,
	clock: Clock = systemClock,
): Promise<void> {
	await requireKioskPinManager(db, input);
	await withAuditTrail((audit) =>
		db.transaction(async (tx) => {
			const updated = await tx
				.update(employeeKioskPin)
				.set({ updatedAt: new Date() })
				.where(employeePin(input.organizationId, input.employeeId))
				.returning({ id: employeeKioskPin.id });
			if (updated.length === 0) {
				throw new KioskPinRefusal("no_pin", "This employee has no kiosk PIN.");
			}
			await recordCleared(tx, input, clock);
			await auditPin(audit, tx, AuditAction.KIOSK_PIN_UNLOCKED, input);
		}),
	);
}

/** Whether the employee has a PIN and is locked out now, for those who may manage it. */
export async function readKioskPinStatus(
	db: Database,
	input: KioskPinManagementInput,
	clock: Clock = systemClock,
): Promise<KioskPinStatus> {
	await requireKioskPinManager(db, input);
	const [row] = await db
		.select({ id: employeeKioskPin.id })
		.from(employeeKioskPin)
		.where(employeePin(input.organizationId, input.employeeId))
		.limit(1);
	if (!row) return { hasPin: false, lockedUntil: null };
	const { lockedUntil } = await readKioskPinLockout(db, input, clock.nowInstant());
	return { hasPin: true, lockedUntil };
}

/** Whether the signed-in user has a kiosk PIN as an employee of the organization. */
export async function readOwnKioskPinStatus(
	db: Database,
	input: { organizationId: string; userId: string },
): Promise<{ hasEmployee: boolean; hasPin: boolean }> {
	const [row] = await db
		.select({ employeeId: employee.id, pinId: employeeKioskPin.id })
		.from(employee)
		.leftJoin(
			employeeKioskPin,
			and(
				eq(employeeKioskPin.employeeId, employee.id),
				eq(employeeKioskPin.organizationId, employee.organizationId),
			),
		)
		.where(
			and(
				eq(employee.userId, input.userId),
				eq(employee.organizationId, input.organizationId),
				employeeHasOrganizationAccess(),
			),
		)
		.limit(1);
	return { hasEmployee: Boolean(row), hasPin: Boolean(row?.pinId) };
}

/**
 * Sets or changes the signed-in employee's own PIN (4 to 6 digits) and clears
 * any lockout: signing in already proved who they are.
 */
export async function setOwnKioskPin(
	db: Database,
	input: { organizationId: string; userId: string; pin: string },
	clock: Clock = systemClock,
): Promise<void> {
	if (!isValidKioskPin(input.pin)) {
		throw new KioskPinRefusal("invalid_pin", "A kiosk PIN has 4 to 6 digits.");
	}
	const [own] = await db
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.userId, input.userId),
				eq(employee.organizationId, input.organizationId),
				employeeHasOrganizationAccess(),
			),
		)
		.limit(1);
	if (!own) {
		throw new KioskPinRefusal("employee_not_found", "You have no employee profile here.");
	}
	const pinHash = await hashPassword(input.pin);
	await withAuditTrail((audit) =>
		db.transaction(async (tx) => {
			await tx
				.insert(employeeKioskPin)
				.values({
					organizationId: input.organizationId,
					employeeId: own.id,
					pinHash,
					setByUserId: input.userId,
				})
				.onConflictDoUpdate({
					target: employeeKioskPin.employeeId,
					set: { pinHash, setByUserId: input.userId, updatedAt: new Date() },
				});
			await recordCleared(tx, { organizationId: input.organizationId, employeeId: own.id }, clock);
			await auditPin(audit, tx, AuditAction.KIOSK_PIN_CHANGED, {
				organizationId: input.organizationId,
				actorUserId: input.userId,
				employeeId: own.id,
			});
		}),
	);
}

/**
 * A PIN attempt to judge at the instant it happened. `pin` may be a function,
 * called only when the employee is not locked out at `at`, so a sealed PIN is
 * opened only when it will be checked.
 */
export type KioskPinAttempt = {
	organizationId: string;
	employeeId: string;
	/** When the PIN was entered: now online, the claimed instant for a queued command. */
	at: Instant;
	/** Entered at a kiosk while offline and judged on arrival. */
	offline: boolean;
	pin: string | (() => string | Promise<string>);
};

/** What `judgeKioskPinAttempt` needs: the caller's transaction (or one of its clients). */
export type KioskPinClient = Pick<Transaction, "select" | "insert" | "delete">;
export type KioskPinReadClient = Pick<Transaction, "select">;

/**
 * Stored PIN events older than this before now can no longer affect any
 * check: a queued command is admitted at most 7 days late, and a lock that
 * started before then has ended by then.
 */
export const KIOSK_PIN_EVENT_RETENTION_MILLISECONDS =
	CLOCK_COMMAND_ADMISSION_WINDOWS.delayed.pastMilliseconds + KIOSK_PIN_LOCK_MINUTES * 60_000;

function pruneHorizon(now: Instant): Date {
	return dateFromInstant(now.subtract({ milliseconds: KIOSK_PIN_EVENT_RETENTION_MILLISECONDS }));
}

/** Records an unlock, reset or own PIN change, in the change's transaction. */
function recordCleared(
	tx: Pick<Transaction, "insert">,
	input: { organizationId: string; employeeId: string },
	clock: Clock,
) {
	return tx.insert(employeeKioskPinEvent).values({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		kind: "cleared",
		occurredAt: dateFromInstant(clock.nowInstant()),
	});
}

async function loadLockoutEvents(
	client: KioskPinReadClient,
	input: { organizationId: string; employeeId: string },
	at: Instant,
): Promise<KioskPinLockoutEvent[]> {
	const rows = await client
		.select({ kind: employeeKioskPinEvent.kind, occurredAt: employeeKioskPinEvent.occurredAt })
		.from(employeeKioskPinEvent)
		.where(
			and(
				eq(employeeKioskPinEvent.organizationId, input.organizationId),
				eq(employeeKioskPinEvent.employeeId, input.employeeId),
				lte(employeeKioskPinEvent.occurredAt, dateFromInstant(at)),
			),
		)
		.orderBy(asc(employeeKioskPinEvent.occurredAt), asc(employeeKioskPinEvent.sequence));
	return rows.map((row) => ({ kind: row.kind, at: instantFromDate(row.occurredAt) }));
}

/**
 * How the employee's kiosk PIN lockout stood at `at`, replayed from the stored
 * events (see `pin-lockout.ts`). Read without the PIN row's lock: to judge an
 * attempt, use `judgeKioskPinAttempt`.
 */
export async function readKioskPinLockout(
	client: KioskPinReadClient,
	input: { organizationId: string; employeeId: string },
	at: Instant,
): Promise<KioskPinLockout> {
	if (!isUuid(input.employeeId)) return { lockedUntil: null, failures: 0 };
	return kioskPinLockoutAt(await loadLockoutEvents(client, input, at), at);
}

/**
 * Judges a kiosk PIN attempt at the instant it happened, in the caller's
 * transaction, as the lockout stood then (#1288). Under the PIN row's lock, so
 * attempts from every kiosk, online or arriving late, are judged one at a
 * time: if the employee was locked out at `at`, answers `locked` without
 * reading or checking the PIN and stores nothing; otherwise checks the PIN
 * against the employee's current one, stores the outcome at `at` and answers
 * how the lockout stands with it (the fifth failure answers `locked`). Prunes
 * the employee's events that can no longer affect a check.
 */
export async function judgeKioskPinAttempt(
	tx: KioskPinClient,
	attempt: KioskPinAttempt,
	clock: Clock = systemClock,
): Promise<KioskPinVerification> {
	if (!isUuid(attempt.employeeId)) return { status: "no_pin" };
	const [row] = await tx
		.select({ pinHash: employeeKioskPin.pinHash })
		.from(employeeKioskPin)
		.where(employeePin(attempt.organizationId, attempt.employeeId))
		.for("update");
	if (!row) return { status: "no_pin" };

	const employeeEvents = and(
		eq(employeeKioskPinEvent.organizationId, attempt.organizationId),
		eq(employeeKioskPinEvent.employeeId, attempt.employeeId),
	);
	await tx
		.delete(employeeKioskPinEvent)
		.where(
			and(employeeEvents, lt(employeeKioskPinEvent.occurredAt, pruneHorizon(clock.nowInstant()))),
		);

	const before = await readKioskPinLockout(tx, attempt, attempt.at);
	if (before.lockedUntil) return { status: "locked", until: before.lockedUntil };

	const pin = typeof attempt.pin === "function" ? await attempt.pin() : attempt.pin;
	const matches =
		isValidKioskPin(pin) && (await verifyPassword({ hash: row.pinHash, password: pin }));
	await tx.insert(employeeKioskPinEvent).values({
		organizationId: attempt.organizationId,
		employeeId: attempt.employeeId,
		kind: matches ? "success" : "failure",
		offline: attempt.offline,
		occurredAt: dateFromInstant(attempt.at),
	});
	if (matches) return { status: "verified" };

	const after = await readKioskPinLockout(tx, attempt, attempt.at);
	return after.lockedUntil
		? { status: "locked", until: after.lockedUntil }
		: { status: "wrong_pin" };
}

/**
 * Verifies a PIN entered at a kiosk now (#857): `judgeKioskPinAttempt` at the
 * current instant in its own transaction. Five consecutive failures across all
 * kiosks lock the employee for 15 minutes; while locked, the PIN is not checked.
 */
export async function verifyEmployeeKioskPin(
	db: Database,
	input: { organizationId: string; employeeId: string; pin: string },
	clock: Clock = systemClock,
): Promise<KioskPinVerification> {
	if (!isUuid(input.employeeId)) return { status: "no_pin" };
	return db.transaction((tx) =>
		judgeKioskPinAttempt(tx, { ...input, at: clock.nowInstant(), offline: false }, clock),
	);
}

/**
 * Deletes the kiosk PIN events of every organization that can no longer affect
 * any check (older than the delayed admission window plus the lock). Returns
 * the number deleted.
 */
export async function pruneKioskPinEvents(
	client: Pick<Transaction, "delete">,
	now: Instant,
): Promise<number> {
	const deleted = await client
		.delete(employeeKioskPinEvent)
		.where(lt(employeeKioskPinEvent.occurredAt, pruneHorizon(now)))
		.returning({ id: employeeKioskPinEvent.id });
	return deleted.length;
}
