import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { employee, employeeKioskFob, kiosk } from "@/db/schema";
import { employeeEmploymentPeriod } from "@/db/schema/employee-lifecycle";
import { AuditAction } from "@/lib/audit-logger";
import { type AuditTrail, withAuditTrail } from "@/lib/audit-trail";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	departureEndingEmploymentPeriod,
	employeeHasOrganizationAccess,
} from "@/lib/employee-lifecycle/access";
import { resolveCurrentEmploymentPeriod } from "@/lib/employee-lifecycle/employment-periods";
import { employeeCoordinationGuard, holdGuard } from "@/lib/time-tracking/work-transaction/ranks";
import { isUuid } from "@/lib/validations/uuid";
import { KioskFobRefusal } from "./fob-errors";
import { kioskFobLastFour, normalizeKioskFobSerial } from "./fob-serial";

/**
 * The kiosk fob store (#1505, spec #1358, ADR 0014): an employee's link to the
 * NFC card or fob whose serial number selects them at an online kiosk. The
 * serial number is no secret and proves nothing; the kiosk PIN still proves.
 * Every query is filtered by `organizationId`.
 *
 * - `registerKioskFob`: the employee's own registration at a kiosk, once the
 *   caller checked their kiosk PIN. One active link per employee (a new one
 *   replaces the old at once) and one per serial number within an organization.
 * - `resolveActiveKioskFob`: which employee a read serial number selects now.
 * - `endKioskFobLinks`: THE way a link ends (replaced, removed, departure).
 *
 * Every change for an employee holds the employee key (the clocking writers'
 * rank-5 guard, `employeeCoordinationGuard`), as kiosk badges and departures do,
 * so an employee's links change one at a time and a departure sees them whole.
 */

type Database = typeof rootDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type KioskFobEndReason = NonNullable<(typeof employeeKioskFob.$inferSelect)["endedReason"]>;

/** The active link a read serial number selects. */
export type ActiveKioskFob = { fobId: string; employeeId: string; employmentPeriodId: string };

/**
 * What a registration did (decision O3), enough for the registration
 * notification (#1507) to be sent after the commit. Never the full serial.
 * `already_registered`: the serial number was already the employee's active
 * fob; nothing changed and nothing needs to be told.
 */
export type KioskFobRegistration = {
	outcome: "registered" | "already_registered";
	fobId: string;
	organizationId: string;
	employeeId: string;
	/** The registering employee's user, who proved themselves with their kiosk PIN. */
	userId: string;
	kiosk: { id: string; name: string };
	lastFour: string;
	registeredAt: Instant;
	/** The employee's earlier fob this registration ended (reason `replaced`), if any. */
	replacedFobId: string | null;
};

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
	for (let current = error; current; current = (current as { cause?: unknown }).cause) {
		if (typeof current !== "object") return false;
		if ((current as { code?: unknown }).code === PG_UNIQUE_VIOLATION) return true;
	}
	return false;
}

function linkedToOtherEmployee() {
	return new KioskFobRefusal(
		"fob_linked_to_other_employee",
		"This fob is registered to another employee.",
	);
}

function activeFobsOf(input: { organizationId: string; employeeId: string }) {
	return and(
		eq(employeeKioskFob.organizationId, input.organizationId),
		eq(employeeKioskFob.employeeId, input.employeeId),
		isNull(employeeKioskFob.endedAt),
	);
}

/**
 * Ends an employee's active fob links, inside the caller's transaction, which
 * must hold the employee key (`employeeCoordinationGuard`). This is the one
 * ending path every caller uses: a replacement (#1505), a removal (#1508) and a
 * departure (#1509, and a stale link at another employee's registration).
 *
 * - `fobId` narrows it to that link (a removal of the fob the person saw);
 *   `employmentPeriodId` to the links of an ending employment (a departure, so a
 *   delayed retry can never end a link registered after a rehire).
 * - `at` is when the link stopped working, recorded as `ended_at` but never
 *   before the link was registered (a departure passes its cutoff).
 * - `actorUserId` is the audit actor; `endedByUserId` (default: the actor) is
 *   stored on the row, null when nobody ended it on purpose.
 *
 * Each ended link is audited as `kiosk_fob.ended` with `{ reason, ...metadata }`;
 * the caller forwards the entries only after its commit. Returns the ended ids.
 */
export async function endKioskFobLinks(
	tx: Pick<Transaction, "update" | "insert">,
	audit: AuditTrail,
	input: {
		organizationId: string;
		employeeId: string;
		reason: KioskFobEndReason;
		at: Instant;
		actorUserId: string;
		endedByUserId?: string | null;
		fobId?: string;
		employmentPeriodId?: string;
		auditMetadata?: Record<string, unknown>;
	},
): Promise<string[]> {
	const at = dateFromInstant(input.at);
	const ended = await tx
		.update(employeeKioskFob)
		.set({
			endedAt: sql`greatest(${employeeKioskFob.registeredAt}, ${at}::timestamptz)`,
			endedByUserId: input.endedByUserId === undefined ? input.actorUserId : input.endedByUserId,
			endedReason: input.reason,
		})
		.where(
			and(
				activeFobsOf(input),
				input.fobId ? eq(employeeKioskFob.id, input.fobId) : undefined,
				input.employmentPeriodId
					? eq(employeeKioskFob.employmentPeriodId, input.employmentPeriodId)
					: undefined,
			),
		)
		.returning({ id: employeeKioskFob.id });
	for (const fob of ended) {
		await audit.record(tx, {
			organizationId: input.organizationId,
			targetType: "kiosk_fob",
			targetId: fob.id,
			action: AuditAction.KIOSK_FOB_ENDED,
			actorUserId: input.actorUserId,
			employeeId: input.employeeId,
			metadata: { reason: input.reason, ...input.auditMetadata },
		});
	}
	return ended.map((fob) => fob.id);
}

/**
 * The active links `endKioskFobLinks` ends for an ending employment, for a
 * deactivation's preview (#1509): those of the period, or every active link of
 * the employee when they have no period.
 */
export async function liveKioskFobsOfEmployment(
	client: Pick<Transaction, "select">,
	input: { organizationId: string; employeeId: string; employmentPeriodId: string | null },
): Promise<string[]> {
	const rows = await client
		.select({ id: employeeKioskFob.id })
		.from(employeeKioskFob)
		.where(
			and(
				activeFobsOf(input),
				input.employmentPeriodId
					? eq(employeeKioskFob.employmentPeriodId, input.employmentPeriodId)
					: undefined,
			),
		)
		.orderBy(employeeKioskFob.registeredAt, employeeKioskFob.id);
	return rows.map((row) => row.id);
}

/**
 * The active link a read serial number selects within one organization, or
 * null: an unreadable, unknown or ended serial, one of another organization, an
 * employee without organization access at `now` (inactive, or a departure in
 * effect even when not processed yet) or a link whose employment period ended.
 * It never says which. Whether the employee may clock at a kiosk (its location)
 * is the caller's.
 */
export async function resolveActiveKioskFob(
	client: Pick<Transaction, "select">,
	input: { organizationId: string; serial: unknown; now: Instant },
): Promise<ActiveKioskFob | null> {
	const serial = normalizeKioskFobSerial(input.serial);
	if (!serial) return null;
	const [row] = await client
		.select({
			fobId: employeeKioskFob.id,
			employeeId: employeeKioskFob.employeeId,
			employmentPeriodId: employeeKioskFob.employmentPeriodId,
		})
		.from(employeeKioskFob)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeKioskFob.employeeId),
				eq(employee.organizationId, employeeKioskFob.organizationId),
			),
		)
		.innerJoin(
			employeeEmploymentPeriod,
			and(
				eq(employeeEmploymentPeriod.id, employeeKioskFob.employmentPeriodId),
				eq(employeeEmploymentPeriod.organizationId, employeeKioskFob.organizationId),
				eq(employeeEmploymentPeriod.employeeId, employeeKioskFob.employeeId),
				eq(employeeEmploymentPeriod.status, "open"),
			),
		)
		.where(
			and(
				eq(employeeKioskFob.organizationId, input.organizationId),
				eq(employeeKioskFob.serialNumber, serial),
				isNull(employeeKioskFob.endedAt),
				employeeHasOrganizationAccess(input.now),
			),
		)
		.limit(1);
	return row ?? null;
}

/** The active link of a serial number in the organization, whoever holds it, and whether they still may. */
async function holderOf(
	tx: Pick<Transaction, "select">,
	input: { organizationId: string; serial: string; now: Instant; lock?: boolean },
) {
	const query = tx
		.select({
			fobId: employeeKioskFob.id,
			employeeId: employeeKioskFob.employeeId,
			employmentPeriodId: employeeKioskFob.employmentPeriodId,
			hasAccess: sql<boolean>`${employeeHasOrganizationAccess(input.now)}`,
		})
		.from(employeeKioskFob)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeKioskFob.employeeId),
				eq(employee.organizationId, employeeKioskFob.organizationId),
			),
		)
		.where(
			and(
				eq(employeeKioskFob.organizationId, input.organizationId),
				eq(employeeKioskFob.serialNumber, input.serial),
				isNull(employeeKioskFob.endedAt),
			),
		)
		.limit(1);
	const [row] = input.lock ? await query.for("update", { of: employeeKioskFob }) : await query;
	return row ?? null;
}

/**
 * Frees a serial number held by an employee who no longer has organization
 * access (decision O7): their link would never select again, so it must not
 * block another employee's registration. Under that employee's key it is ended
 * as the departure would end it, at the departure's cutoff; an employee who is
 * inactive without a departure (deactivated) has it ended as removed, now. The
 * registering employee is the audit actor; nobody is stored as having ended it.
 * Returns whether the serial number is free now.
 */
async function freeStaleLink(
	tx: Transaction,
	audit: AuditTrail,
	input: {
		organizationId: string;
		serial: string;
		now: Instant;
		actorUserId: string;
		kioskId: string;
	},
	holder: { employeeId: string },
): Promise<boolean> {
	await holdGuard(tx, employeeCoordinationGuard(holder.employeeId));
	const current = await holderOf(tx, { ...input, lock: true });
	if (!current) return true;
	if (current.employeeId !== holder.employeeId || current.hasAccess) return false;
	const ending = await departureEndingEmploymentPeriod(tx, {
		organizationId: input.organizationId,
		employeeId: current.employeeId,
		employmentPeriodId: current.employmentPeriodId,
		now: input.now,
	});
	await endKioskFobLinks(tx, audit, {
		organizationId: input.organizationId,
		employeeId: current.employeeId,
		fobId: current.fobId,
		reason: ending ? "departure" : "removed",
		at: ending ? ending.cutoff : input.now,
		actorUserId: input.actorUserId,
		endedByUserId: null,
		auditMetadata: { endedAtRegistrationOnKioskId: input.kioskId },
	});
	return true;
}

/** The registering employee's user and current open employment period, or the refusal. */
async function requireEligibleEmployee(
	tx: Transaction,
	input: { organizationId: string; employeeId: string },
	now: Instant,
): Promise<{ userId: string; employmentPeriodId: string }> {
	const notEligible = new KioskFobRefusal(
		"employee_not_eligible",
		"Only active employees assigned to this kiosk can register a fob here.",
	);
	if (!isUuid(input.employeeId)) throw notEligible;
	const [eligible] = await tx
		.select({ userId: employee.userId })
		.from(employee)
		.where(
			and(
				eq(employee.id, input.employeeId),
				eq(employee.organizationId, input.organizationId),
				employeeHasOrganizationAccess(now),
			),
		)
		.limit(1);
	const period = eligible ? await resolveCurrentEmploymentPeriod(tx, input) : null;
	if (!eligible || period?.status !== "open") throw notEligible;
	return { userId: eligible.userId, employmentPeriodId: period.id };
}

/**
 * Links a fob to an employee who registered it at a kiosk (#1505). The caller
 * has checked the kiosk (its fob reader switch), the employee's eligibility at
 * the kiosk's location and their kiosk PIN; this checks again, under the
 * employee key, that the employee has organization access and an open
 * employment period (`employee_not_eligible`). Then:
 *
 * - the serial number already the employee's active fob: `already_registered`,
 *   nothing changes;
 * - linked to another employee who still has access: refused with
 *   `fob_linked_to_other_employee`, naming nobody and moving nothing;
 * - linked to an employee who no longer has access: that link is ended first
 *   (decision O7);
 * - the employee's earlier fob is ended as `replaced` at once, and the new link
 *   is stored, bound to the current employment period.
 *
 * Two registrations of one serial number for different employees at once:
 * the second meets the unique index and is refused the same way.
 */
export async function registerKioskFob(
	db: Database,
	input: { organizationId: string; kioskId: string; employeeId: string; serial: unknown },
	clock: Clock = systemClock,
): Promise<KioskFobRegistration> {
	const serial = normalizeKioskFobSerial(input.serial);
	if (!serial) {
		throw new KioskFobRefusal("invalid_serial", "That is not a fob serial number.");
	}
	try {
		return await withAuditTrail((audit) =>
			db.transaction(async (tx) => {
				await holdGuard(tx, employeeCoordinationGuard(input.employeeId));
				const now = clock.nowInstant();
				const { userId, employmentPeriodId } = await requireEligibleEmployee(tx, input, now);
				const [site] = await tx
					.select({ name: kiosk.name })
					.from(kiosk)
					.where(and(eq(kiosk.organizationId, input.organizationId), eq(kiosk.id, input.kioskId)))
					.limit(1);
				if (!site) throw new Error("The registering kiosk is not in this organization");
				const registration = {
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					userId,
					kiosk: { id: input.kioskId, name: site.name },
					lastFour: kioskFobLastFour(serial),
				};

				const holder = await holderOf(tx, { organizationId: input.organizationId, serial, now });
				if (holder?.employeeId === input.employeeId) {
					const [own] = await tx
						.select({ registeredAt: employeeKioskFob.registeredAt })
						.from(employeeKioskFob)
						.where(eq(employeeKioskFob.id, holder.fobId))
						.limit(1);
					return {
						...registration,
						outcome: "already_registered" as const,
						fobId: holder.fobId,
						registeredAt: own ? instantFromDate(own.registeredAt) : now,
						replacedFobId: null,
					};
				}
				if (holder) {
					const freed =
						!holder.hasAccess &&
						(await freeStaleLink(
							tx,
							audit,
							{
								organizationId: input.organizationId,
								serial,
								now,
								actorUserId: userId,
								kioskId: input.kioskId,
							},
							holder,
						));
					if (!freed) throw linkedToOtherEmployee();
				}

				const [replacedFobId = null] = await endKioskFobLinks(tx, audit, {
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					reason: "replaced",
					at: now,
					actorUserId: userId,
					auditMetadata: { kioskId: input.kioskId },
				});
				const [created] = await tx
					.insert(employeeKioskFob)
					.values({
						organizationId: input.organizationId,
						employeeId: input.employeeId,
						employmentPeriodId,
						serialNumber: serial,
						registeredAt: dateFromInstant(now),
						registeredKioskId: input.kioskId,
					})
					.returning({ id: employeeKioskFob.id });
				if (!created) throw new Error("Could not store the kiosk fob");
				await audit.record(tx, {
					organizationId: input.organizationId,
					targetType: "kiosk_fob",
					targetId: created.id,
					action: AuditAction.KIOSK_FOB_REGISTERED,
					actorUserId: userId,
					employeeId: input.employeeId,
					metadata: { kioskId: input.kioskId, ...(replacedFobId ? { replacedFobId } : {}) },
				});
				return {
					...registration,
					outcome: "registered" as const,
					fobId: created.id,
					registeredAt: now,
					replacedFobId,
				};
			}),
		);
	} catch (error) {
		if (!(error instanceof KioskFobRefusal) && isUniqueViolation(error)) {
			throw linkedToOtherEmployee();
		}
		throw error;
	}
}
