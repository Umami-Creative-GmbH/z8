"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { runKioskAction } from "@/lib/time-tracking/kiosk/action-runner";
import { kioskOnlyEmailUpgradeDeps } from "@/lib/time-tracking/kiosk/kiosk-only-email-upgrade";
import {
	addEmailToKioskOnlyEmployee,
	createKioskOnlyEmployee,
} from "@/lib/time-tracking/kiosk/kiosk-only-employee";
import type { KioskPinActionResult } from "@/lib/time-tracking/kiosk/pin-errors";
import {
	canManageEmployeeKioskPin,
	issueKioskPin,
	readKioskPinStatus,
	resetKioskPin,
	unlockKioskPin,
} from "@/lib/time-tracking/kiosk/pin-store";

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
	return runKioskAction("kiosk.employeeState", async (db, actor) => {
		const id = employeeIdOf(employeeId);
		const [target] = /^[0-9a-f-]{36}$/i.test(id)
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
		const [canManagePin, principal] = await Promise.all([
			canManageEmployeeKioskPin(db, input),
			loadOrganizationPrincipalContext(db, {
				userId: actor.userId,
				organizationId: actor.organizationId,
			}),
		]);
		const role = principal.orgMembership?.role;
		const isOrganizationAdmin =
			hasOrganizationRole(role, "owner") || hasOrganizationRole(role, "admin");
		const kioskOnly = isReservedEmail(target.email);
		if (!canManagePin && !(kioskOnly && isOrganizationAdmin)) return null;
		const status = canManagePin
			? await readKioskPinStatus(db, input)
			: { hasPin: false, lockedUntil: null };
		return {
			canManagePin,
			hasPin: status.hasPin,
			lockedUntil: status.lockedUntil ? instantToCanonicalString(status.lockedUntil) : null,
			kioskOnly,
			canAddEmail: kioskOnly && isOrganizationAdmin,
		};
	});
}

/** Issues a generated PIN; the PIN is in the result once and nowhere else. */
export async function issueEmployeeKioskPinAction(
	employeeId: string,
): Promise<KioskPinActionResult<{ pin: string }>> {
	return runKioskAction("kiosk.issuePin", (db, actor) =>
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
	return runKioskAction("kiosk.resetPin", (db, actor) =>
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
	return runKioskAction("kiosk.unlockPin", async (db, actor) => {
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
};

/** Creates a kiosk-only employee (no email, no sign-in) in the active organization. */
export async function createKioskOnlyEmployeeAction(
	input: CreateKioskOnlyEmployeeActionInput,
): Promise<KioskPinActionResult<{ employeeId: string }>> {
	return runKioskAction("kiosk.createKioskOnlyEmployee", async (db, actor) => {
		const { employeeId } = await createKioskOnlyEmployee(db, {
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			firstName: typeof input?.firstName === "string" ? input.firstName : "",
			lastName: typeof input?.lastName === "string" ? input.lastName : "",
			teamId: typeof input?.teamId === "string" ? input.teamId : null,
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
	return runKioskAction("kiosk.addKioskOnlyEmployeeEmail", async (db, actor) => {
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
