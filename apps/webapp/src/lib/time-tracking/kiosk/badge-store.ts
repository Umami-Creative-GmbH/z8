import "server-only";

import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { employee, employeeKioskBadge } from "@/db/schema";
import { employeeDeparture, employeeEmploymentPeriod } from "@/db/schema/employee-lifecycle";
import { AuditAction } from "@/lib/audit-logger";
import { type AuditTrail, withAuditTrail } from "@/lib/audit-trail";
import { buildDerivedUserName } from "@/lib/auth/derived-user-name";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { resolveCurrentEmploymentPeriod } from "@/lib/employee-lifecycle/employment-periods";
import { employeeCoordinationGuard, holdGuard } from "@/lib/time-tracking/work-transaction/ranks";
import { isUuid } from "@/lib/validations/uuid";
import {
	KIOSK_BADGE_CREDENTIAL_ALPHABET,
	KIOSK_BADGE_CREDENTIAL_PREFIX,
	KIOSK_BADGE_RANDOM_LENGTH,
	normalizeKioskBadgeCredential,
} from "./badge-credential";
import { KioskBadgeRefusal } from "./badge-errors";
import { canManageEmployeeKioskPin, type KioskPinManagementInput } from "./pin-store";

/**
 * The kiosk badge store (#1364, spec #889, ADR 0012): issue, replace and revoke
 * an employee's badge, read its non-secret status, and resolve a scanned
 * credential to the active badge for kiosk verification (#1366).
 *
 * The credential exists in the clear only while it is issued: it is generated
 * here, handed once to the caller's `deliver` (which renders the printable PDF)
 * and dropped. Only its SHA-256 is stored, as for the kiosk device token: with
 * 260 random bits a plain hash is a safe stored form, and a scan can be looked
 * up by it without knowing the employee.
 *
 * Every badge change for an employee holds the employee key (the clocking
 * writers' rank-5 guard, `employeeCoordinationGuard`), so changes for one
 * employee run one at a time, and a badge clock action holding the same key
 * sees the badge either before or after a change, never half of it.
 */

type Database = typeof rootDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type KioskBadgeManagementInput = KioskPinManagementInput;

export type KioskBadgeRevokedReason = NonNullable<
	(typeof employeeKioskBadge.$inferSelect)["revokedReason"]
>;

/** What may be shown about an employee's badge: lifecycle facts, never the credential. */
export type KioskBadgeStatus = {
	/** The active badge, if any. */
	active: { issuedAt: Instant } | null;
	/** The most recent badge when none is active: when and why it stopped working. */
	lastRevoked: { revokedAt: Instant; reason: KioskBadgeRevokedReason } | null;
	/**
	 * Whether a new badge (issued or replacing the active one) can be given now:
	 * the employee has organization access. After a departure that is only once
	 * a rehire started a new employment period; the old badge never returns.
	 */
	canIssue: boolean;
};

/** What a badge's printable PDF is made of; handed to `deliver` once, during issuance. */
export type KioskBadgeDelivery = {
	credential: string;
	employeeName: string;
	organizationName: string;
};

export type IssuedKioskBadge<T> = {
	badgeId: string;
	issuedAt: Instant;
	/** What `deliver` returned (the PDF). */
	delivery: T;
};

/** The badge a credential belongs to, while it may still prove the employee at a kiosk. */
export type ActiveKioskBadge = {
	badgeId: string;
	employeeId: string;
	employmentPeriodId: string;
};

function generateKioskBadgeCredential(): string {
	let random = "";
	for (let index = 0; index < KIOSK_BADGE_RANDOM_LENGTH; index++) {
		random += KIOSK_BADGE_CREDENTIAL_ALPHABET[randomInt(KIOSK_BADGE_CREDENTIAL_ALPHABET.length)];
	}
	return `${KIOSK_BADGE_CREDENTIAL_PREFIX}${random}`;
}

/** The stored form of a canonical badge credential. */
function hashKioskBadgeCredential(credential: string): string {
	return createHash("sha256").update(credential).digest("hex");
}

/**
 * Whether the actor may issue, replace and revoke this employee's badge: the
 * same people who manage the employee's kiosk PIN (ADR 0012), an owner or
 * admin of the organization or the employee's direct manager.
 */
export function canManageEmployeeKioskBadge(
	db: Database,
	input: KioskBadgeManagementInput,
): Promise<boolean> {
	return canManageEmployeeKioskPin(db, input);
}

/** The employee's printed name and organization, once the actor may manage the badge. */
async function requireKioskBadgeManager(
	db: Database,
	input: KioskBadgeManagementInput,
): Promise<{ employeeName: string; organizationName: string }> {
	const [target] = isUuid(input.employeeId)
		? await db
				.select({
					name: user.name,
					firstName: user.firstName,
					lastName: user.lastName,
					organizationName: organization.name,
				})
				.from(employee)
				.innerJoin(user, eq(user.id, employee.userId))
				.innerJoin(organization, eq(organization.id, employee.organizationId))
				.where(
					and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
				)
				.limit(1)
		: [];
	if (!target) {
		throw new KioskBadgeRefusal("employee_not_found", "Employee not found in this organization.");
	}
	if (!(await canManageEmployeeKioskBadge(db, input))) {
		throw new KioskBadgeRefusal(
			"not_allowed",
			"Only owners, admins and the employee's direct manager can manage kiosk badges.",
		);
	}
	return {
		employeeName: buildDerivedUserName(target.firstName ?? "", target.lastName ?? "", target.name),
		organizationName: target.organizationName,
	};
}

function employeeBadges(input: { organizationId: string; employeeId: string }) {
	return and(
		eq(employeeKioskBadge.organizationId, input.organizationId),
		eq(employeeKioskBadge.employeeId, input.employeeId),
	);
}

async function hasActiveBadge(
	client: Pick<Transaction, "select">,
	input: { organizationId: string; employeeId: string },
): Promise<boolean> {
	const [row] = await client
		.select({ id: employeeKioskBadge.id })
		.from(employeeKioskBadge)
		.where(and(employeeBadges(input), isNull(employeeKioskBadge.revokedAt)))
		.limit(1);
	return Boolean(row);
}

/**
 * The employment period a new badge belongs to, under the employee key: the
 * employee must have organization access now (active, no departure in effect)
 * and an open employment period.
 */
async function requireBadgeEmploymentPeriod(
	tx: Transaction,
	input: { organizationId: string; employeeId: string },
	now: Instant,
): Promise<string> {
	const [eligible] = await tx
		.select({ id: employee.id })
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
	if (period?.status !== "open") {
		throw new KioskBadgeRefusal(
			"employee_inactive",
			"Only active employees of this organization can receive a kiosk badge.",
		);
	}
	return period.id;
}

function auditBadge(
	audit: AuditTrail,
	tx: Pick<Transaction, "insert">,
	action: AuditAction,
	input: KioskBadgeManagementInput & { badgeId: string; metadata?: Record<string, unknown> },
) {
	return audit.record(tx, {
		organizationId: input.organizationId,
		targetType: "kiosk_badge",
		targetId: input.badgeId,
		action,
		actorUserId: input.actorUserId,
		employeeId: input.employeeId,
		metadata: input.metadata ?? null,
	});
}

async function issue<T>(
	db: Database,
	input: KioskBadgeManagementInput,
	kind: "issue" | "replace",
	deliver: (badge: KioskBadgeDelivery) => Promise<T>,
	clock: Clock,
): Promise<IssuedKioskBadge<T>> {
	const names = await requireKioskBadgeManager(db, input);
	// Refuse the obvious cases before rendering; the transaction decides.
	const active = await hasActiveBadge(db, input);
	if (kind === "issue" && active) {
		throw new KioskBadgeRefusal(
			"badge_exists",
			"This employee already has a kiosk badge. Replace it instead.",
		);
	}
	if (kind === "replace" && !active) {
		throw new KioskBadgeRefusal("no_badge", "This employee has no kiosk badge. Issue one instead.");
	}

	const credential = generateKioskBadgeCredential();
	// Rendered before anything is stored: if it fails, no badge exists that nobody holds.
	const delivery = await deliver({ credential, ...names });
	const credentialHash = hashKioskBadgeCredential(credential);

	return withAuditTrail((audit) =>
		db.transaction(async (tx) => {
			await holdGuard(tx, employeeCoordinationGuard(input.employeeId));
			const now = clock.nowInstant();
			const employmentPeriodId = await requireBadgeEmploymentPeriod(tx, input, now);

			let replacedBadgeId: string | null = null;
			if (kind === "replace") {
				const [replaced] = await tx
					.update(employeeKioskBadge)
					.set({
						revokedAt: dateFromInstant(now),
						revokedByUserId: input.actorUserId,
						revokedReason: "replaced",
					})
					.where(and(employeeBadges(input), isNull(employeeKioskBadge.revokedAt)))
					.returning({ id: employeeKioskBadge.id });
				if (!replaced) {
					throw new KioskBadgeRefusal(
						"no_badge",
						"This employee has no kiosk badge. Issue one instead.",
					);
				}
				replacedBadgeId = replaced.id;
			} else if (await hasActiveBadge(tx, input)) {
				throw new KioskBadgeRefusal(
					"badge_exists",
					"This employee already has a kiosk badge. Replace it instead.",
				);
			}

			const [created] = await tx
				.insert(employeeKioskBadge)
				.values({
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					employmentPeriodId,
					credentialHash,
					issuedAt: dateFromInstant(now),
					issuedByUserId: input.actorUserId,
				})
				.returning({ id: employeeKioskBadge.id });
			if (!created) throw new Error("Could not store the kiosk badge");

			await auditBadge(
				audit,
				tx,
				kind === "issue" ? AuditAction.KIOSK_BADGE_ISSUED : AuditAction.KIOSK_BADGE_REPLACED,
				{
					...input,
					badgeId: created.id,
					metadata: replacedBadgeId ? { replacedBadgeId } : undefined,
				},
			);
			return { badgeId: created.id, issuedAt: now, delivery };
		}),
	);
}

/**
 * Gives an active employee without an active badge a new one. `deliver` gets
 * the credential once, before anything is stored, and its result (the PDF) is
 * returned; the credential is not kept anywhere.
 */
export function issueKioskBadge<T>(
	db: Database,
	input: KioskBadgeManagementInput,
	deliver: (badge: KioskBadgeDelivery) => Promise<T>,
	clock: Clock = systemClock,
): Promise<IssuedKioskBadge<T>> {
	return issue(db, input, "issue", deliver, clock);
}

/**
 * Replaces the employee's active badge with a new one in one transaction: every
 * copy of the old badge stops working as the new one is stored. `deliver` as
 * for `issueKioskBadge`.
 */
export function replaceKioskBadge<T>(
	db: Database,
	input: KioskBadgeManagementInput,
	deliver: (badge: KioskBadgeDelivery) => Promise<T>,
	clock: Clock = systemClock,
): Promise<IssuedKioskBadge<T>> {
	return issue(db, input, "replace", deliver, clock);
}

/**
 * Revokes the employee's active badge for good, without a replacement. The
 * employee's kiosk PIN is not touched. Works whether or not the employee is
 * still active.
 */
export async function revokeKioskBadge(
	db: Database,
	input: KioskBadgeManagementInput,
	clock: Clock = systemClock,
): Promise<void> {
	await requireKioskBadgeManager(db, input);
	await withAuditTrail((audit) =>
		db.transaction(async (tx) => {
			await holdGuard(tx, employeeCoordinationGuard(input.employeeId));
			const [revoked] = await tx
				.update(employeeKioskBadge)
				.set({
					revokedAt: dateFromInstant(clock.nowInstant()),
					revokedByUserId: input.actorUserId,
					revokedReason: "revoked",
				})
				.where(and(employeeBadges(input), isNull(employeeKioskBadge.revokedAt)))
				.returning({ id: employeeKioskBadge.id });
			if (!revoked) {
				throw new KioskBadgeRefusal("no_badge", "This employee has no kiosk badge.");
			}
			await auditBadge(audit, tx, AuditAction.KIOSK_BADGE_REVOKED, {
				...input,
				badgeId: revoked.id,
			});
		}),
	);
}

/**
 * Ends the badges of the employment period a departure closes (#1365), inside
 * the departure's work transaction, which already holds the employee key. Only
 * badges bound to that period are touched, so a delayed or retried departure
 * can never end a badge issued after a rehire. The badge stopped proving the
 * employee at the cutoff (the access rule denies it from then on), so that is
 * when it is recorded as ended, never before it was issued. Audited under the
 * departure's initiator; the caller does not forward the entries, because the
 * work transaction may be retried.
 */
export async function revokeKioskBadgesForDeparture(
	tx: Pick<Transaction, "update" | "insert">,
	audit: AuditTrail,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		departureId: string;
		actorUserId: string;
		cutoff: Instant;
	},
): Promise<void> {
	const cutoff = dateFromInstant(input.cutoff);
	const revoked = await tx
		.update(employeeKioskBadge)
		.set({
			revokedAt: sql`greatest(${employeeKioskBadge.issuedAt}, ${cutoff}::timestamptz)`,
			revokedByUserId: input.actorUserId,
			revokedReason: "employee_departure",
		})
		.where(
			and(
				employeeBadges(input),
				eq(employeeKioskBadge.employmentPeriodId, input.employmentPeriodId),
				isNull(employeeKioskBadge.revokedAt),
			),
		)
		.returning({ id: employeeKioskBadge.id });
	for (const badge of revoked) {
		await auditBadge(audit, tx, AuditAction.KIOSK_BADGE_REVOKED, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			employeeId: input.employeeId,
			badgeId: badge.id,
			metadata: {
				reason: "employee_departure",
				departureId: input.departureId,
				employmentPeriodId: input.employmentPeriodId,
			},
		});
	}
}

/**
 * The cutoff of the departure that already ended this badge's employment
 * period, even when the departure has not been processed yet: a pending one
 * past its cutoff (which the access rule enforces) or an effective one.
 */
async function departureCutoffEndingBadge(
	db: Pick<Database, "select">,
	input: { organizationId: string; employeeId: string; employmentPeriodId: string; now: Instant },
): Promise<Date | null> {
	const [departure] = await db
		.select({ cutoffAt: employeeDeparture.cutoffAt })
		.from(employeeDeparture)
		.where(
			and(
				eq(employeeDeparture.organizationId, input.organizationId),
				eq(employeeDeparture.employeeId, input.employeeId),
				eq(employeeDeparture.employmentPeriodId, input.employmentPeriodId),
				or(
					eq(employeeDeparture.status, "effective"),
					and(eq(employeeDeparture.status, "pending"), isNull(employeeDeparture.blockedReason)),
				),
				lte(employeeDeparture.cutoffAt, dateFromInstant(input.now)),
			),
		)
		.orderBy(desc(employeeDeparture.cutoffAt))
		.limit(1);
	return departure?.cutoffAt ?? null;
}

/**
 * The employee's badge status for those who may manage it: lifecycle facts
 * only. A badge whose employee's departure is past its cutoff shows as ended
 * by the departure even before the departure is processed, because kiosks
 * already refuse it. `canIssue` says whether a new badge can be issued now:
 * only while the employee has organization access, so after a departure only
 * once a rehire opened a new employment period.
 */
export async function readKioskBadgeStatus(
	db: Database,
	input: KioskBadgeManagementInput,
	clock: Clock = systemClock,
): Promise<KioskBadgeStatus> {
	await requireKioskBadgeManager(db, input);
	const now = clock.nowInstant();
	const [[latest], [eligible]] = await Promise.all([
		db
			.select({
				issuedAt: employeeKioskBadge.issuedAt,
				employmentPeriodId: employeeKioskBadge.employmentPeriodId,
				revokedAt: employeeKioskBadge.revokedAt,
				revokedReason: employeeKioskBadge.revokedReason,
			})
			.from(employeeKioskBadge)
			.where(employeeBadges(input))
			.orderBy(desc(employeeKioskBadge.issuedAt), desc(employeeKioskBadge.id))
			.limit(1),
		db
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(
					eq(employee.id, input.employeeId),
					eq(employee.organizationId, input.organizationId),
					employeeHasOrganizationAccess(now),
				),
			)
			.limit(1),
	]);
	const canIssue = Boolean(eligible);
	if (!latest) return { active: null, lastRevoked: null, canIssue };
	if (latest.revokedAt && latest.revokedReason) {
		return {
			active: null,
			lastRevoked: { revokedAt: instantFromDate(latest.revokedAt), reason: latest.revokedReason },
			canIssue,
		};
	}
	const endedAt = await departureCutoffEndingBadge(db, { ...input, ...latest, now });
	if (endedAt) {
		const revokedAt = endedAt.getTime() > latest.issuedAt.getTime() ? endedAt : latest.issuedAt;
		return {
			active: null,
			lastRevoked: { revokedAt: instantFromDate(revokedAt), reason: "employee_departure" },
			canIssue,
		};
	}
	return { active: { issuedAt: instantFromDate(latest.issuedAt) }, lastRevoked: null, canIssue };
}

/**
 * The active badge a scanned credential belongs to within one organization, or
 * null: for an unreadable, unknown, replaced or revoked credential, one of
 * another organization, an employee without organization access at `now`
 * (inactive, or a departure in effect even when not processed yet) or a badge
 * whose employment period has ended. It never says which.
 *
 * Kiosk verification (#1366) calls it once to identify the employee, and again
 * at the protected write boundary with `lock: true` inside the clocking
 * transaction, after it holds the employee key: the badge row is then locked
 * `FOR UPDATE`, so no replacement or revocation can commit between the check
 * and the write. Badge changes take the employee key first and the row second,
 * the same order.
 */
export async function resolveActiveKioskBadge(
	client: Pick<Transaction, "select">,
	input: { organizationId: string; credential: unknown; now: Instant; lock?: boolean },
): Promise<ActiveKioskBadge | null> {
	const credential = normalizeKioskBadgeCredential(input.credential);
	if (!credential) return null;
	const query = client
		.select({
			badgeId: employeeKioskBadge.id,
			employeeId: employeeKioskBadge.employeeId,
			employmentPeriodId: employeeKioskBadge.employmentPeriodId,
		})
		.from(employeeKioskBadge)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeKioskBadge.employeeId),
				eq(employee.organizationId, employeeKioskBadge.organizationId),
			),
		)
		.innerJoin(
			employeeEmploymentPeriod,
			and(
				eq(employeeEmploymentPeriod.id, employeeKioskBadge.employmentPeriodId),
				eq(employeeEmploymentPeriod.organizationId, employeeKioskBadge.organizationId),
				eq(employeeEmploymentPeriod.employeeId, employeeKioskBadge.employeeId),
				eq(employeeEmploymentPeriod.status, "open"),
			),
		)
		.where(
			and(
				eq(employeeKioskBadge.credentialHash, hashKioskBadgeCredential(credential)),
				eq(employeeKioskBadge.organizationId, input.organizationId),
				isNull(employeeKioskBadge.revokedAt),
				employeeHasOrganizationAccess(input.now),
			),
		)
		.limit(1);
	const [row] = input.lock ? await query.for("update", { of: employeeKioskBadge }) : await query;
	return row ?? null;
}
