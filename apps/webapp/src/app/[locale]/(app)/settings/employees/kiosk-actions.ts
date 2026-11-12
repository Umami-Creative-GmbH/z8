"use server";

import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import { employee, location } from "@/db/schema";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { storeStep } from "@/lib/organization-action/store-step";
import { KioskBadgeRefusal } from "@/lib/time-tracking/kiosk/badge-errors";
import { renderKioskBadgePdf } from "@/lib/time-tracking/kiosk/badge-pdf";
import {
	issueKioskBadge,
	type KioskBadgeDelivery,
	type KioskBadgeRevokedReason,
	readKioskBadgeStatus,
	replaceKioskBadge,
	revokeKioskBadge,
} from "@/lib/time-tracking/kiosk/badge-store";
import { KioskFobManagementRefusal } from "@/lib/time-tracking/kiosk/fob-errors";
import {
	type KioskFobViewState,
	kioskFobViewState,
	readKioskFobStatus,
	removeKioskFob,
} from "@/lib/time-tracking/kiosk/fob-management";
import type { KioskFobEndReason } from "@/lib/time-tracking/kiosk/fob-store";
import { kioskOnlyEmailUpgradeDeps } from "@/lib/time-tracking/kiosk/kiosk-only-email-upgrade";
import {
	addEmailToKioskOnlyEmployee,
	createKioskOnlyEmployee,
} from "@/lib/time-tracking/kiosk/kiosk-only-employee";
import { KioskPinRefusal } from "@/lib/time-tracking/kiosk/pin-errors";
import {
	canManageEmployeeKioskPin,
	issueKioskPin,
	readKioskPinStatus,
	resetKioskPin,
	unlockKioskPin,
} from "@/lib/time-tracking/kiosk/pin-store";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { isUuid } from "@/lib/validations/uuid";
import { getTranslate } from "@/tolgee/server";

/**
 * Kiosk PINs, badges, fobs and kiosk-only employees on the employee page. Any
 * org member reaches them (as before); who may manage whose kiosk credentials
 * is the stores' object-level authority (owners, admins, direct managers).
 * Refusals come back as `ValidationError`s whose `refusal` is the store's code.
 */

export type EmployeeKioskState = {
	/** Whether the viewer may issue, reset or unlock this employee's PIN. */
	canManagePin: boolean;
	hasPin: boolean;
	/** ISO instant while the employee is locked out. */
	lockedUntil: string | null;
	kioskOnly: boolean;
	/** Whether the viewer may add a real email (owners and admins, kiosk-only employees only). */
	canAddEmail: boolean;
	/** The employee's kiosk badge, for those who may manage it (#1364); never the credential. */
	badge: EmployeeKioskBadgeState | null;
	/** The employee's kiosk fob, for the same people (#1508); never the serial number. */
	fob: EmployeeKioskFobState | null;
};

/** What may be shown about an employee's kiosk fob (ISO instants and dates). */
export type EmployeeKioskFobState = {
	/** The active fob; removal names its id, so a change made meanwhile is refused. */
	active: KioskFobViewState | null;
	/** The most recent fob when none is active. */
	lastEnded: {
		at: string;
		reason: KioskFobEndReason;
		/** Ended by a departure: the employee's last working day (ISO date), never a viewer-zone date. */
		departureLastWorkingDay: string | null;
	} | null;
	/** Whether any kiosk of the organization reads fobs; without it and without a fob the section hides. */
	fobReaderInUse: boolean;
	/** The organization's zone, in which the instants above are shown. */
	timezone: string;
};

/** Non-secret lifecycle facts about an employee's kiosk badge (ISO instants and dates). */
export type EmployeeKioskBadgeState = {
	/** The active badge's id: replace and revoke name it, so a change made meanwhile is refused. */
	activeBadgeId: string | null;
	activeIssuedAt: string | null;
	lastRevokedAt: string | null;
	lastRevokedReason: KioskBadgeRevokedReason | null;
	/**
	 * When the last badge ended with a departure: the employee's last working day
	 * (ISO date, the departure's own calendar day), never a viewer-zone date.
	 */
	departureLastWorkingDay: string | null;
	/** The organization's zone, in which the instants above are shown. */
	timezone: string;
	/** Whether a new badge can be issued (or the active one replaced) now (#1365). */
	canIssue: boolean;
};

/**
 * A just-issued badge's printable PDF: the only time it exists. Nothing can
 * fetch it, or the credential in its QR code, again.
 */
export type IssuedKioskBadgePdf = {
	filename: string;
	/** The PDF, base64. */
	pdf: string;
};

const EMPLOYEES_PATH = "/settings/employees";

// The stores refuse an unknown or malformed employee themselves, with their own codes.
const employeeIdSchema = z.string();
const employeeBadgeSchema = z.strictObject({
	employeeId: z.string(),
	expectedBadgeId: z.string(),
});

/** What the employee detail page's kiosk card shows. Hidden when the viewer may do nothing. */
export const getEmployeeKioskStateAction = organizationAction(
	{ name: "kiosk.employeeState", requires: "member", schema: employeeIdSchema },
	({ actor, organizationId, input: id }) =>
		storeStep(
			"kiosk.employeeState",
			async (db) => {
				const [target] = isUuid(id)
					? await db
							.select({ email: user.email })
							.from(employee)
							.innerJoin(user, eq(user.id, employee.userId))
							.where(and(eq(employee.id, id), eq(employee.organizationId, organizationId)))
							.limit(1)
					: [];
				if (!target) return null;
				const input = { organizationId, actorUserId: actor.userId, employeeId: id };
				const canManagePin = await canManageEmployeeKioskPin(db, input);
				const isAdmin = meetsSettingsAccess(actor.settingsAccess, "orgAdmin");
				const kioskOnly = isReservedEmail(target.email);
				if (!canManagePin && !(kioskOnly && isAdmin)) return null;
				const [status, badge, fob, timezone] = canManagePin
					? await Promise.all([
							readKioskPinStatus(db, input),
							readKioskBadgeStatus(db, input),
							readKioskFobStatus(db, input),
							loadOrganizationTimezone(db, organizationId),
						])
					: [{ hasPin: false, lockedUntil: null }, null, null, "UTC"];
				return {
					canManagePin,
					hasPin: status.hasPin,
					lockedUntil: status.lockedUntil ? instantToCanonicalString(status.lockedUntil) : null,
					kioskOnly,
					canAddEmail: kioskOnly && isAdmin,
					badge: badge && {
						activeBadgeId: badge.active?.badgeId ?? null,
						activeIssuedAt: badge.active ? instantToCanonicalString(badge.active.issuedAt) : null,
						lastRevokedAt: badge.lastRevoked
							? instantToCanonicalString(badge.lastRevoked.revokedAt)
							: null,
						lastRevokedReason: badge.lastRevoked?.reason ?? null,
						departureLastWorkingDay: badge.lastRevoked?.lastWorkingDay?.toString() ?? null,
						timezone,
						canIssue: badge.canIssue,
					},
					fob: fob && {
						active: fob.active && kioskFobViewState(fob.active),
						lastEnded: fob.lastEnded && {
							at: instantToCanonicalString(fob.lastEnded.endedAt),
							reason: fob.lastEnded.reason,
							departureLastWorkingDay: fob.lastEnded.lastWorkingDay?.toString() ?? null,
						},
						fobReaderInUse: fob.fobReaderInUse,
						timezone,
					},
				} satisfies EmployeeKioskState;
			},
			{ refusal: KioskPinRefusal },
		),
);

/**
 * Removes the employee's kiosk fob the viewer saw (`expectedFobId`, #1508):
 * kiosks stop recognising it and anyone may register it again. The kiosk PIN
 * and kiosk badge are unchanged. Refused with `fob_changed` when the employee's
 * fob changed meanwhile.
 */
export const removeEmployeeKioskFobAction = organizationAction(
	{
		name: "kiosk.removeFob",
		requires: "member",
		schema: z.strictObject({ employeeId: z.string(), expectedFobId: z.string() }),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"kiosk.removeFob",
			async (db) => {
				await removeKioskFob(db, {
					organizationId,
					actorUserId: actor.userId,
					employeeId: input.employeeId,
					expectedFobId: input.expectedFobId,
				});
				return { removed: true as const };
			},
			{ refusal: KioskFobManagementRefusal },
		),
);

/** The PDF's file name: ASCII letters and digits of the employee's name. */
function badgeFilename(employeeName: string): string {
	const slug = employeeName
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/[^A-Za-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase()
		.slice(0, 60);
	return slug ? `kiosk-badge-${slug}.pdf` : "kiosk-badge.pdf";
}

async function renderBadgeFor(badge: KioskBadgeDelivery): Promise<IssuedKioskBadgePdf> {
	const t = await getTranslate();
	const pdf = await renderKioskBadgePdf({
		...badge,
		labels: {
			title: t("settings.employees.kioskBadge.pdf.title", "Kiosk badge"),
			instructions: t(
				"settings.employees.kioskBadge.pdf.instructions",
				"Cut out the badge along the dashed line. Whoever holds a copy can clock as this employee at the organization's kiosks, so keep it like a key. If it is lost, ask for a replacement: every copy of this badge then stops working.",
			),
		},
	});
	return { filename: badgeFilename(badge.employeeName), pdf: pdf.toString("base64") };
}

/**
 * Issues a kiosk badge (#1364). The printable PDF is in the result once and
 * nowhere else: the server keeps only a hash of the credential.
 */
export const issueEmployeeKioskBadgeAction = organizationAction(
	{ name: "kiosk.issueBadge", requires: "member", schema: employeeIdSchema },
	({ actor, organizationId, input: employeeId }) =>
		storeStep(
			"kiosk.issueBadge",
			async (db) => {
				const issued = await issueKioskBadge(
					db,
					{ organizationId, actorUserId: actor.userId, employeeId },
					renderBadgeFor,
				);
				return issued.delivery;
			},
			{ refusal: KioskBadgeRefusal },
		),
);

/**
 * Replaces the employee's kiosk badge the issuer saw (`expectedBadgeId`): every
 * copy of it stops working. Refused with `badge_changed` when another change
 * got there first. The new badge's PDF is in the result once and nowhere else.
 */
export const replaceEmployeeKioskBadgeAction = organizationAction(
	{ name: "kiosk.replaceBadge", requires: "member", schema: employeeBadgeSchema },
	({ actor, organizationId, input }) =>
		storeStep(
			"kiosk.replaceBadge",
			async (db) => {
				const issued = await replaceKioskBadge(
					db,
					{ organizationId, actorUserId: actor.userId, ...input },
					renderBadgeFor,
				);
				return issued.delivery;
			},
			{ refusal: KioskBadgeRefusal },
		),
);

/**
 * Revokes the employee's kiosk badge the issuer saw (`expectedBadgeId`) without
 * a replacement; their kiosk PIN is unchanged. `badge_changed` as for replace.
 */
export const revokeEmployeeKioskBadgeAction = organizationAction(
	{ name: "kiosk.revokeBadge", requires: "member", schema: employeeBadgeSchema },
	({ actor, organizationId, input }) =>
		storeStep(
			"kiosk.revokeBadge",
			async (db) => {
				await revokeKioskBadge(db, { organizationId, actorUserId: actor.userId, ...input });
				return { revoked: true as const };
			},
			{ refusal: KioskBadgeRefusal },
		),
);

/** Issues a generated PIN; the PIN is in the result once and nowhere else. */
export const issueEmployeeKioskPinAction = organizationAction(
	{ name: "kiosk.issuePin", requires: "member", schema: employeeIdSchema },
	({ actor, organizationId, input: employeeId }) =>
		storeStep(
			"kiosk.issuePin",
			(db) => issueKioskPin(db, { organizationId, actorUserId: actor.userId, employeeId }),
			{ refusal: KioskPinRefusal },
		),
);

/** Replaces the PIN with a generated one; the PIN is in the result once and nowhere else. */
export const resetEmployeeKioskPinAction = organizationAction(
	{ name: "kiosk.resetPin", requires: "member", schema: employeeIdSchema },
	({ actor, organizationId, input: employeeId }) =>
		storeStep(
			"kiosk.resetPin",
			(db) => resetKioskPin(db, { organizationId, actorUserId: actor.userId, employeeId }),
			{ refusal: KioskPinRefusal },
		),
);

export const unlockEmployeeKioskPinAction = organizationAction(
	{ name: "kiosk.unlockPin", requires: "member", schema: employeeIdSchema },
	({ actor, organizationId, input: employeeId }) =>
		storeStep(
			"kiosk.unlockPin",
			async (db) => {
				await unlockKioskPin(db, { organizationId, actorUserId: actor.userId, employeeId });
				return { unlocked: true as const };
			},
			{ refusal: KioskPinRefusal },
		),
);

const createKioskOnlyEmployeeSchema = z.strictObject({
	firstName: z.string(),
	lastName: z.string(),
	teamId: z.string().nullable(),
	/** Assigned locations, whose kiosks accept the employee. */
	locationIds: z.array(z.string()),
});

export type CreateKioskOnlyEmployeeActionInput = z.input<typeof createKioskOnlyEmployeeSchema>;

export type KioskOnlyEmployeeLocationOption = { id: string; name: string };

/** The active locations an owner or admin can assign a new kiosk-only employee to. */
export const getKioskOnlyEmployeeLocationsAction = organizationAction(
	{ name: "kiosk.kioskOnlyEmployeeLocations", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"kiosk.kioskOnlyEmployeeLocations",
				(): Promise<KioskOnlyEmployeeLocationOption[]> =>
					dbService.db
						.select({ id: location.id, name: location.name })
						.from(location)
						.where(and(eq(location.organizationId, organizationId), eq(location.isActive, true)))
						.orderBy(asc(location.name)),
			);
		}),
);

/** Creates a kiosk-only employee (no email, no sign-in) in the active organization. */
export const createKioskOnlyEmployeeAction = organizationAction(
	{
		name: "kiosk.createKioskOnlyEmployee",
		requires: "member",
		schema: createKioskOnlyEmployeeSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"kiosk.createKioskOnlyEmployee",
			async (db) => {
				const { employeeId } = await createKioskOnlyEmployee(db, {
					organizationId,
					actorUserId: actor.userId,
					...input,
				});
				revalidatePath(EMPLOYEES_PATH);
				return { employeeId };
			},
			{ refusal: KioskPinRefusal },
		),
);

/** Gives a kiosk-only employee a real email and sends them the invitation to choose a password. */
export const addKioskOnlyEmployeeEmailAction = organizationAction(
	{
		name: "kiosk.addKioskOnlyEmployeeEmail",
		requires: "member",
		schema: z.strictObject({ employeeId: z.string(), email: z.string() }),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"kiosk.addKioskOnlyEmployeeEmail",
			async (db) => {
				const result = await addEmailToKioskOnlyEmployee(
					db,
					{ organizationId, actorUserId: actor.userId, ...input },
					kioskOnlyEmailUpgradeDeps,
				);
				revalidatePath(EMPLOYEES_PATH);
				return result;
			},
			{ refusal: KioskPinRefusal },
		),
);
