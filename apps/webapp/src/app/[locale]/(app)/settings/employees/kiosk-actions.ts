"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { user } from "@/db/auth-schema";
import { employee, location } from "@/db/schema";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { isOrganizationAdmin } from "@/lib/authorization/organization-admin";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
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

export type EmployeeKioskState = {
	/** Whether the viewer may issue, reset or unlock this employee's PIN. */
	canManagePin: boolean;
	hasPin: boolean;
	/** ISO instant while the employee is locked out. */
	lockedUntil: string | null;
	kioskOnly: boolean;
	/** Whether the viewer may add a real email (owners and admins, kiosk-only employees only). */
	canAddEmail: boolean;
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
		const status = canManagePin
			? await readKioskPinStatus(db, input)
			: { hasPin: false, lockedUntil: null };
		return {
			canManagePin,
			hasPin: status.hasPin,
			lockedUntil: status.lockedUntil ? instantToCanonicalString(status.lockedUntil) : null,
			kioskOnly,
			canAddEmail: kioskOnly && isAdmin,
		};
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
