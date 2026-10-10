import "server-only";

import { randomInt } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { employee, employeeKioskPin } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import {
	type Clock,
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	GENERATED_KIOSK_PIN_LENGTH,
	isValidKioskPin,
	KIOSK_PIN_LOCK_MINUTES,
	KIOSK_PIN_MAX_FAILED_ATTEMPTS,
} from "./pin";
import { KioskPinRefusal } from "./pin-errors";

type Database = typeof rootDatabase;

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
	const role = principal.orgMembership?.role;
	if (hasOrganizationRole(role, "owner") || hasOrganizationRole(role, "admin")) return true;
	return principal.managedEmployeeIds.includes(input.employeeId);
}

async function requireKioskPinManager(db: Database, input: KioskPinManagementInput) {
	const [target] = UUID_PATTERN.test(input.employeeId)
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

function auditPin(action: AuditAction, input: KioskPinManagementInput) {
	return logAudit({
		action,
		actorId: input.actorUserId,
		employeeId: input.employeeId,
		targetId: input.employeeId,
		targetType: "kiosk_pin",
		organizationId: input.organizationId,
		timestamp: new Date(),
	});
}

/** Gives an employee without a PIN a generated one. The PIN is returned once and never stored. */
export async function issueKioskPin(
	db: Database,
	input: KioskPinManagementInput,
): Promise<{ pin: string }> {
	await requireKioskPinManager(db, input);
	const pin = generateKioskPin();
	const inserted = await db
		.insert(employeeKioskPin)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			pinHash: await hashPassword(pin),
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
	await auditPin(AuditAction.KIOSK_PIN_ISSUED, input);
	return { pin };
}

/** Replaces an employee's PIN with a generated one and clears any lockout. Returned once. */
export async function resetKioskPin(
	db: Database,
	input: KioskPinManagementInput,
): Promise<{ pin: string }> {
	await requireKioskPinManager(db, input);
	const pin = generateKioskPin();
	const updated = await db
		.update(employeeKioskPin)
		.set({
			pinHash: await hashPassword(pin),
			failedAttempts: 0,
			lockedUntil: null,
			setByUserId: input.actorUserId,
			updatedAt: new Date(),
		})
		.where(employeePin(input.organizationId, input.employeeId))
		.returning({ id: employeeKioskPin.id });
	if (updated.length === 0) {
		throw new KioskPinRefusal("no_pin", "This employee has no kiosk PIN yet. Issue one instead.");
	}
	await auditPin(AuditAction.KIOSK_PIN_RESET, input);
	return { pin };
}

/** Lifts a lockout and starts the failure count again. */
export async function unlockKioskPin(db: Database, input: KioskPinManagementInput): Promise<void> {
	await requireKioskPinManager(db, input);
	const updated = await db
		.update(employeeKioskPin)
		.set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
		.where(employeePin(input.organizationId, input.employeeId))
		.returning({ id: employeeKioskPin.id });
	if (updated.length === 0) {
		throw new KioskPinRefusal("no_pin", "This employee has no kiosk PIN.");
	}
	await auditPin(AuditAction.KIOSK_PIN_UNLOCKED, input);
}

/** Whether the employee has a PIN and is locked out, for those who may manage it. */
export async function readKioskPinStatus(
	db: Database,
	input: KioskPinManagementInput,
	clock: Clock = systemClock,
): Promise<KioskPinStatus> {
	await requireKioskPinManager(db, input);
	const [row] = await db
		.select({ lockedUntil: employeeKioskPin.lockedUntil })
		.from(employeeKioskPin)
		.where(employeePin(input.organizationId, input.employeeId))
		.limit(1);
	if (!row) return { hasPin: false, lockedUntil: null };
	const lockedUntil = row.lockedUntil ? instantFromDate(row.lockedUntil) : null;
	return {
		hasPin: true,
		lockedUntil:
			lockedUntil && compareInstants(lockedUntil, clock.nowInstant()) > 0 ? lockedUntil : null,
	};
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
	await db
		.insert(employeeKioskPin)
		.values({
			organizationId: input.organizationId,
			employeeId: own.id,
			pinHash,
			setByUserId: input.userId,
		})
		.onConflictDoUpdate({
			target: employeeKioskPin.employeeId,
			set: {
				pinHash,
				failedAttempts: 0,
				lockedUntil: null,
				setByUserId: input.userId,
				updatedAt: new Date(),
			},
		});
	await logAudit({
		action: AuditAction.KIOSK_PIN_CHANGED,
		actorId: input.userId,
		employeeId: own.id,
		targetId: own.id,
		targetType: "kiosk_pin",
		organizationId: input.organizationId,
		timestamp: new Date(),
	});
}

/**
 * Verifies a PIN entered at a kiosk and records the outcome under the PIN
 * row's lock, so failures from several kiosks count once each. A success
 * resets the count; the fifth consecutive failure locks the employee for 15
 * minutes and starts the count again. While locked, the PIN is not checked.
 */
export async function verifyEmployeeKioskPin(
	db: Database,
	input: { organizationId: string; employeeId: string; pin: string },
	clock: Clock = systemClock,
): Promise<KioskPinVerification> {
	if (!UUID_PATTERN.test(input.employeeId)) return { status: "no_pin" };
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({
				id: employeeKioskPin.id,
				pinHash: employeeKioskPin.pinHash,
				failedAttempts: employeeKioskPin.failedAttempts,
				lockedUntil: employeeKioskPin.lockedUntil,
			})
			.from(employeeKioskPin)
			.where(employeePin(input.organizationId, input.employeeId))
			.for("update");
		if (!row) return { status: "no_pin" } as const;

		const now = clock.nowInstant();
		const lockedUntil = row.lockedUntil ? instantFromDate(row.lockedUntil) : null;
		if (lockedUntil && compareInstants(lockedUntil, now) > 0) {
			return { status: "locked", until: lockedUntil } as const;
		}

		const matches =
			isValidKioskPin(input.pin) &&
			(await verifyPassword({ hash: row.pinHash, password: input.pin }));
		if (matches) {
			if (row.failedAttempts > 0 || row.lockedUntil) {
				await tx
					.update(employeeKioskPin)
					.set({ failedAttempts: 0, lockedUntil: null })
					.where(eq(employeeKioskPin.id, row.id));
			}
			return { status: "verified" } as const;
		}

		const failures = row.failedAttempts + 1;
		if (failures >= KIOSK_PIN_MAX_FAILED_ATTEMPTS) {
			const until = now.add({ minutes: KIOSK_PIN_LOCK_MINUTES });
			await tx
				.update(employeeKioskPin)
				.set({ failedAttempts: 0, lockedUntil: dateFromInstant(until) })
				.where(eq(employeeKioskPin.id, row.id));
			return { status: "locked", until } as const;
		}
		await tx
			.update(employeeKioskPin)
			.set({ failedAttempts: failures })
			.where(eq(employeeKioskPin.id, row.id));
		return { status: "wrong_pin" } as const;
	});
}
