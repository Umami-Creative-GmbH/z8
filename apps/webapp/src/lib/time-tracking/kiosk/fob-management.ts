import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import type { db as rootDatabase } from "@/db";
import { employee, employeeKioskFob, kiosk } from "@/db/schema";
import { withAuditTrail } from "@/lib/audit-trail";
import {
	type Clock,
	compareInstants,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	departureEndingEmploymentPeriod,
	employeeHasOrganizationAccess,
} from "@/lib/employee-lifecycle/access";
import { employeeCoordinationGuard, holdGuard } from "@/lib/time-tracking/work-transaction/ranks";
import { isUuid } from "@/lib/validations/uuid";
import { KioskFobManagementRefusal } from "./fob-errors";
import { kioskFobLastFour } from "./fob-serial";
import { endKioskFobLinks, type KioskFobEndReason } from "./fob-store";
import { canManageEmployeeKioskPin, type KioskPinManagementInput } from "./pin-store";

/**
 * Viewing and removing kiosk fobs in settings (#1508, spec #1358, ADR 0014).
 * Registration happens only at a kiosk (#1505); here the people who manage an
 * employee's kiosk PIN (owners, admins and the direct manager), and the
 * signed-in employee for their own fob, see when and where it was registered
 * and its last four characters, never the serial number, and can remove it.
 *
 * A removal ends the link through the store's one ending path
 * (`endKioskFobLinks`, reason `removed`) under the employee key, so it
 * serializes with registrations and departures. It never touches the kiosk PIN
 * or kiosk badge. Every query is filtered by `organizationId`.
 */

type Database = typeof rootDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type KioskFobManagementInput = KioskPinManagementInput;

/**
 * A removal names the active fob the person saw, so a fob registered or ended
 * meanwhile is refused (`fob_changed`) instead of removed unseen. Straight from
 * the client: anything but a uuid names no fob.
 */
export type KioskFobRemovalInput = KioskFobManagementInput & { expectedFobId: unknown };

/** An active fob as it may be shown: when and where it was registered, its last four characters. */
export type KioskFobView = {
	fobId: string;
	registeredAt: Instant;
	lastFour: string;
	/** The registering kiosk's current name; null once that kiosk was deleted. */
	kioskName: string | null;
};

/** What may be shown about an employee's fob: lifecycle facts, never the serial number. */
export type KioskFobStatus = {
	active: KioskFobView | null;
	/**
	 * The most recent fob when none is active: when and why it stopped working.
	 * Ended by a departure, also the employee's last working day (the cutoff is
	 * the start of the next day).
	 */
	lastEnded: {
		endedAt: Instant;
		reason: KioskFobEndReason;
		lastWorkingDay?: Temporal.PlainDate;
	} | null;
	/** Whether any kiosk of the organization reads fobs, so one can be registered. */
	fobReaderInUse: boolean;
};

/** `KioskFobView` as server actions return it: the instant as an ISO string. */
export type KioskFobViewState = Omit<KioskFobView, "registeredAt"> & { registeredAt: string };

export function kioskFobViewState(view: KioskFobView): KioskFobViewState {
	return { ...view, registeredAt: instantToCanonicalString(view.registeredAt) };
}

/** The signed-in employee's own fob, and whether any kiosk of the organization reads fobs. */
export type OwnKioskFobStatus = {
	active: KioskFobView | null;
	fobReaderInUse: boolean;
};

/**
 * Refuses an employee outside the organization, then an actor who may not
 * manage the fob: the same people who manage the employee's kiosk PIN and kiosk
 * badge (decision of spec #1358), an owner or admin of the organization or the
 * employee's direct manager.
 */
async function requireKioskFobManager(db: Database, input: KioskFobManagementInput) {
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
		throw new KioskFobManagementRefusal(
			"employee_not_found",
			"Employee not found in this organization.",
		);
	}
	if (!(await canManageEmployeeKioskPin(db, input))) {
		throw new KioskFobManagementRefusal(
			"not_allowed",
			"Only owners, admins and the employee's direct manager can manage kiosk fobs.",
		);
	}
}

function employeeFobs(input: { organizationId: string; employeeId: string }) {
	return and(
		eq(employeeKioskFob.organizationId, input.organizationId),
		eq(employeeKioskFob.employeeId, input.employeeId),
	);
}

/** Whether a non-revoked kiosk of the organization has its NFC fob reader on. */
async function kioskFobReaderInUse(db: Database, organizationId: string): Promise<boolean> {
	const [reader] = await db
		.select({ id: kiosk.id })
		.from(kiosk)
		.where(
			and(
				eq(kiosk.organizationId, organizationId),
				eq(kiosk.nfcFobReaderEnabled, true),
				isNull(kiosk.revokedAt),
			),
		)
		.limit(1);
	return Boolean(reader);
}

/**
 * The employee's most recent fob. One whose employee's departure is past its
 * cutoff shows as ended by the departure even before the departure is
 * processed, because kiosks already stop recognising it
 * (`departureEndingEmploymentPeriod`, the live access rule they apply).
 */
async function readFobStatus(
	db: Database,
	input: { organizationId: string; employeeId: string },
	now: Instant,
): Promise<Omit<KioskFobStatus, "fobReaderInUse">> {
	const [latest] = await db
		.select({
			id: employeeKioskFob.id,
			serialNumber: employeeKioskFob.serialNumber,
			registeredAt: employeeKioskFob.registeredAt,
			employmentPeriodId: employeeKioskFob.employmentPeriodId,
			endedAt: employeeKioskFob.endedAt,
			endedReason: employeeKioskFob.endedReason,
			kioskName: kiosk.name,
		})
		.from(employeeKioskFob)
		.leftJoin(
			kiosk,
			and(
				eq(kiosk.id, employeeKioskFob.registeredKioskId),
				eq(kiosk.organizationId, employeeKioskFob.organizationId),
			),
		)
		.where(employeeFobs(input))
		.orderBy(desc(employeeKioskFob.registeredAt), desc(employeeKioskFob.id))
		.limit(1);
	if (!latest) return { active: null, lastEnded: null };
	const ending =
		latest.endedReason === null || latest.endedReason === "departure"
			? await departureEndingEmploymentPeriod(db, {
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					employmentPeriodId: latest.employmentPeriodId,
					now,
				})
			: null;
	if (latest.endedAt && latest.endedReason) {
		return {
			active: null,
			lastEnded: {
				endedAt: instantFromDate(latest.endedAt),
				reason: latest.endedReason,
				...(ending && latest.endedReason === "departure"
					? { lastWorkingDay: ending.lastWorkingDay }
					: {}),
			},
		};
	}
	const registeredAt = instantFromDate(latest.registeredAt);
	if (ending) {
		return {
			active: null,
			lastEnded: {
				endedAt: compareInstants(ending.cutoff, registeredAt) > 0 ? ending.cutoff : registeredAt,
				reason: "departure",
				lastWorkingDay: ending.lastWorkingDay,
			},
		};
	}
	return {
		active: {
			fobId: latest.id,
			registeredAt,
			// Only the last four characters ever leave the server (decision O4).
			lastFour: kioskFobLastFour(latest.serialNumber),
			kioskName: latest.kioskName,
		},
		lastEnded: null,
	};
}

/** The employee's fob status, for those who may manage it. */
export async function readKioskFobStatus(
	db: Database,
	input: KioskFobManagementInput,
	clock: Clock = systemClock,
): Promise<KioskFobStatus> {
	await requireKioskFobManager(db, input);
	const [status, fobReaderInUse] = await Promise.all([
		readFobStatus(db, input, clock.nowInstant()),
		kioskFobReaderInUse(db, input.organizationId),
	]);
	return { ...status, fobReaderInUse };
}

/** Why a removal of the fob the person saw ended nothing. */
async function removalRefusal(
	tx: Pick<Transaction, "select">,
	input: { organizationId: string; employeeId: string; expectedFobId: unknown },
): Promise<KioskFobManagementRefusal> {
	const changed = new KioskFobManagementRefusal(
		"fob_changed",
		"The kiosk fob changed meanwhile. Reload and try again.",
	);
	const [active] = await tx
		.select({ id: employeeKioskFob.id })
		.from(employeeKioskFob)
		.where(and(employeeFobs(input), isNull(employeeKioskFob.endedAt)))
		.limit(1);
	if (active) return changed;
	const [seen] = isUuid(input.expectedFobId)
		? await tx
				.select({ id: employeeKioskFob.id })
				.from(employeeKioskFob)
				.where(and(employeeFobs(input), eq(employeeKioskFob.id, input.expectedFobId)))
				.limit(1)
		: [];
	if (seen) return changed;
	return new KioskFobManagementRefusal("no_fob", "There is no kiosk fob to remove.");
}

/**
 * Ends the employee's fob the person saw (`expectedFobId`), if it is still
 * active, as `removed` by the actor. Otherwise `fob_changed` (another fob is
 * active, or the seen one ended meanwhile) or `no_fob`.
 */
async function removeSeenFob(
	db: Database,
	input: {
		organizationId: string;
		employeeId: string;
		expectedFobId: unknown;
		actorUserId: string;
	},
	clock: Clock,
): Promise<void> {
	const { expectedFobId } = input;
	await withAuditTrail((audit) =>
		db.transaction(async (tx) => {
			await holdGuard(tx, employeeCoordinationGuard(input.employeeId));
			// Without a valid id there is nothing to name: never end "every" link.
			const [removed] = isUuid(expectedFobId)
				? await endKioskFobLinks(tx, audit, {
						organizationId: input.organizationId,
						employeeId: input.employeeId,
						fobId: expectedFobId,
						reason: "removed",
						at: clock.nowInstant(),
						actorUserId: input.actorUserId,
					})
				: [];
			if (!removed) throw await removalRefusal(tx, input);
		}),
	);
}

/**
 * Removes the employee's fob for an owner, admin or direct manager: kiosks stop
 * recognising it at once and anyone may register it again. Works whether or not
 * the employee is still active.
 */
export async function removeKioskFob(
	db: Database,
	input: KioskFobRemovalInput,
	clock: Clock = systemClock,
): Promise<void> {
	await requireKioskFobManager(db, input);
	await removeSeenFob(db, input, clock);
}

/** The signed-in user's employee in the organization, while they have organization access. */
async function ownEmployee(
	db: Database,
	input: { organizationId: string; userId: string },
	now: Instant,
): Promise<{ id: string } | null> {
	const [own] = await db
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.userId, input.userId),
				eq(employee.organizationId, input.organizationId),
				employeeHasOrganizationAccess(now),
			),
		)
		.limit(1);
	return own ?? null;
}

/**
 * The signed-in user's own fob, or null when they are no employee of the
 * organization with access now. The employee is the session's; no employee id
 * comes from the client.
 */
export async function readOwnKioskFobStatus(
	db: Database,
	input: { organizationId: string; userId: string },
	clock: Clock = systemClock,
): Promise<OwnKioskFobStatus | null> {
	const now = clock.nowInstant();
	const own = await ownEmployee(db, input, now);
	if (!own) return null;
	const [status, fobReaderInUse] = await Promise.all([
		readFobStatus(db, { organizationId: input.organizationId, employeeId: own.id }, now),
		kioskFobReaderInUse(db, input.organizationId),
	]);
	return { active: status.active, fobReaderInUse };
}

/**
 * Removes the signed-in employee's own fob, for example after losing it, if it
 * is still the one they saw (`expectedFobId`). Refused with `employee_not_found`
 * for a user who is no employee of the organization with access now.
 */
export async function removeOwnKioskFob(
	db: Database,
	input: { organizationId: string; userId: string; expectedFobId: unknown },
	clock: Clock = systemClock,
): Promise<void> {
	const own = await ownEmployee(db, input, clock.nowInstant());
	if (!own) {
		throw new KioskFobManagementRefusal("employee_not_found", "You have no employee profile here.");
	}
	await removeSeenFob(
		db,
		{
			organizationId: input.organizationId,
			employeeId: own.id,
			expectedFobId: input.expectedFobId,
			actorUserId: input.userId,
		},
		clock,
	);
}
