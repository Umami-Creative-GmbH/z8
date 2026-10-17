"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { user } from "@/db/auth-schema";
import { employee, location } from "@/db/schema";
import type { OrganizationActor } from "@/lib/auth/current-organization-actor";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { isOrganizationAdmin } from "@/lib/authorization/organization-admin";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import type { KioskBadgeActionResult } from "@/lib/time-tracking/kiosk/badge-errors";
import { runKioskBadgeAction } from "@/lib/time-tracking/kiosk/badge-action";
import { renderKioskBadgePdf } from "@/lib/time-tracking/kiosk/badge-pdf";
import {
	issueKioskBadge,
	type KioskBadgeDelivery,
	type KioskBadgeRevokedReason,
	readKioskBadgeStatus,
	replaceKioskBadge,
	revokeKioskBadge,
} from "@/lib/time-tracking/kiosk/badge-store";
import { kioskOnlyEmailUpgradeDeps } from "@/lib/time-tracking/kiosk/kiosk-only-email-upgrade";
import {
	addEmailToKioskOnlyEmployee,
	createKioskOnlyEmployee,
} from "@/lib/time-tracking/kiosk/kiosk-only-employee";
import { runKioskPinAction } from "@/lib/time-tracking/kiosk/kiosk-pin-action";
import { type KioskPinActionResult, KioskPinRefusal } from "@/lib/time-tracking/kiosk/pin-errors";
import {
	canManageEmployeeKioskPin,
	issueKioskPin,
	readKioskPinStatus,
	resetKioskPin,
	unlockKioskPin,
} from "@/lib/time-tracking/kiosk/pin-store";
import { isUuid } from "@/lib/validations/uuid";
import { getTranslate } from "@/tolgee/server";

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
};

/** Non-secret lifecycle facts about an employee's kiosk badge (ISO instants). */
export type EmployeeKioskBadgeState = {
	activeIssuedAt: string | null;
	lastRevokedAt: string | null;
	lastRevokedReason: KioskBadgeRevokedReason | null;
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

function employeeIdOf(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** What the employee detail page's kiosk card shows. Hidden when the viewer may do nothing. */
export async function getEmployeeKioskStateAction(
	employeeId: string,
): Promise<KioskPinActionResult<EmployeeKioskState | null>> {
	return runKioskPinAction("kiosk.employeeState", async (db, actor) => {
		const id = employeeIdOf(employeeId);
		const [target] = isUuid(id)
			? await db
					.select({ email: user.email })
					.from(employee)
					.innerJoin(user, eq(user.id, employee.userId))
					.where(and(eq(employee.id, id), eq(employee.organizationId, actor.organizationId)))
					.limit(1)
			: [];
		if (!target) return null;
		const input = {
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			employeeId: id,
		};
		const [canManagePin, isAdmin] = await Promise.all([
			canManageEmployeeKioskPin(db, input),
			isOrganizationAdmin(db, actor),
		]);
		const kioskOnly = isReservedEmail(target.email);
		if (!canManagePin && !(kioskOnly && isAdmin)) return null;
		const [status, badge] = canManagePin
			? await Promise.all([readKioskPinStatus(db, input), readKioskBadgeStatus(db, input)])
			: [{ hasPin: false, lockedUntil: null }, null];
		return {
			canManagePin,
			hasPin: status.hasPin,
			lockedUntil: status.lockedUntil ? instantToCanonicalString(status.lockedUntil) : null,
			kioskOnly,
			canAddEmail: kioskOnly && isAdmin,
			badge: badge && {
				activeIssuedAt: badge.active ? instantToCanonicalString(badge.active.issuedAt) : null,
				lastRevokedAt: badge.lastRevoked
					? instantToCanonicalString(badge.lastRevoked.revokedAt)
					: null,
				lastRevokedReason: badge.lastRevoked?.reason ?? null,
				canIssue: badge.canIssue,
			},
		};
	});
}

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

function badgeInput(actor: OrganizationActor, employeeId: unknown) {
	return {
		organizationId: actor.organizationId,
		actorUserId: actor.userId,
		employeeId: employeeIdOf(employeeId),
	};
}

/**
 * Issues a kiosk badge (#1364). The printable PDF is in the result once and
 * nowhere else: the server keeps only a hash of the credential.
 */
export async function issueEmployeeKioskBadgeAction(
	employeeId: string,
): Promise<KioskBadgeActionResult<IssuedKioskBadgePdf>> {
	return runKioskBadgeAction("kiosk.issueBadge", async (db, actor) => {
		const issued = await issueKioskBadge(db, badgeInput(actor, employeeId), renderBadgeFor);
		return issued.delivery;
	});
}

/**
 * Replaces the employee's kiosk badge: every copy of the old one stops working.
 * The new badge's PDF is in the result once and nowhere else.
 */
export async function replaceEmployeeKioskBadgeAction(
	employeeId: string,
): Promise<KioskBadgeActionResult<IssuedKioskBadgePdf>> {
	return runKioskBadgeAction("kiosk.replaceBadge", async (db, actor) => {
		const issued = await replaceKioskBadge(db, badgeInput(actor, employeeId), renderBadgeFor);
		return issued.delivery;
	});
}

/** Revokes the employee's kiosk badge without a replacement; their kiosk PIN is unchanged. */
export async function revokeEmployeeKioskBadgeAction(
	employeeId: string,
): Promise<KioskBadgeActionResult<{ revoked: true }>> {
	return runKioskBadgeAction("kiosk.revokeBadge", async (db, actor) => {
		await revokeKioskBadge(db, badgeInput(actor, employeeId));
		return { revoked: true as const };
	});
}

/** Issues a generated PIN; the PIN is in the result once and nowhere else. */
export async function issueEmployeeKioskPinAction(
	employeeId: string,
): Promise<KioskPinActionResult<{ pin: string }>> {
	return runKioskPinAction("kiosk.issuePin", (db, actor) =>
		issueKioskPin(db, {
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			employeeId: employeeIdOf(employeeId),
		}),
	);
}

/** Replaces the PIN with a generated one; the PIN is in the result once and nowhere else. */
export async function resetEmployeeKioskPinAction(
	employeeId: string,
): Promise<KioskPinActionResult<{ pin: string }>> {
	return runKioskPinAction("kiosk.resetPin", (db, actor) =>
		resetKioskPin(db, {
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			employeeId: employeeIdOf(employeeId),
		}),
	);
}

export async function unlockEmployeeKioskPinAction(
	employeeId: string,
): Promise<KioskPinActionResult<{ unlocked: true }>> {
	return runKioskPinAction("kiosk.unlockPin", async (db, actor) => {
		await unlockKioskPin(db, {
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			employeeId: employeeIdOf(employeeId),
		});
		return { unlocked: true as const };
	});
}

export type CreateKioskOnlyEmployeeActionInput = {
	firstName: string;
	lastName: string;
	teamId: string | null;
	/** Assigned locations, whose kiosks accept the employee. */
	locationIds: string[];
};

export type KioskOnlyEmployeeLocationOption = { id: string; name: string };

/** The active locations an owner or admin can assign a new kiosk-only employee to. */
export async function getKioskOnlyEmployeeLocationsAction(): Promise<
	KioskPinActionResult<KioskOnlyEmployeeLocationOption[]>
> {
	return runKioskPinAction("kiosk.kioskOnlyEmployeeLocations", async (db, actor) => {
		if (!(await isOrganizationAdmin(db, actor))) {
			throw new KioskPinRefusal(
				"not_allowed",
				"Only organization owners and admins can manage kiosk-only employees.",
			);
		}
		return db
			.select({ id: location.id, name: location.name })
			.from(location)
			.where(and(eq(location.organizationId, actor.organizationId), eq(location.isActive, true)))
			.orderBy(asc(location.name));
	});
}

/** Creates a kiosk-only employee (no email, no sign-in) in the active organization. */
export async function createKioskOnlyEmployeeAction(
	input: CreateKioskOnlyEmployeeActionInput,
): Promise<KioskPinActionResult<{ employeeId: string }>> {
	return runKioskPinAction("kiosk.createKioskOnlyEmployee", async (db, actor) => {
		const { employeeId } = await createKioskOnlyEmployee(db, {
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			firstName: typeof input?.firstName === "string" ? input.firstName : "",
			lastName: typeof input?.lastName === "string" ? input.lastName : "",
			teamId: typeof input?.teamId === "string" ? input.teamId : null,
			locationIds: Array.isArray(input?.locationIds)
				? input.locationIds.filter((id): id is string => typeof id === "string")
				: [],
		});
		revalidatePath(EMPLOYEES_PATH);
		return { employeeId };
	});
}

/** Gives a kiosk-only employee a real email and sends them the invitation to choose a password. */
export async function addKioskOnlyEmployeeEmailAction(input: {
	employeeId: string;
	email: string;
}): Promise<KioskPinActionResult<{ invitationSent: boolean }>> {
	return runKioskPinAction("kiosk.addKioskOnlyEmployeeEmail", async (db, actor) => {
		const result = await addEmailToKioskOnlyEmployee(
			db,
			{
				organizationId: actor.organizationId,
				actorUserId: actor.userId,
				employeeId: employeeIdOf(input?.employeeId),
				email: typeof input?.email === "string" ? input.email : "",
			},
			kioskOnlyEmailUpgradeDeps,
		);
		revalidatePath(EMPLOYEES_PATH);
		return result;
	});
}
