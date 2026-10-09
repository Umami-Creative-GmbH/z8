import "server-only";

import { and, eq } from "drizzle-orm";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { customRole, customRolePermission, employeeCustomRole } from "@/db/schema/custom-role";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import type { PositionCaptureClient } from "./store";

/**
 * Who may see position stamps (#831, spec #766, decision D3). Decided here,
 * explicitly, never through `ability.can`: a platform admin's CASL
 * `manage all` would otherwise imply it, and no employee role (manager or
 * employee-level admin) ever grants it.
 *
 * - the employee themselves, for their own stamps (never logged);
 * - an approved org member whose Better Auth `member.role` is owner or admin;
 * - an employee holding an active custom role with the `read PositionStamp`
 *   permission in that organization.
 *
 * The loader reads only the database, not the session, so a scheduled export
 * (#835) can load the schedule owner's viewer the same way a request does.
 */
export type PositionStampViewer = {
	organizationId: string;
	userId: string;
	/** The viewer's own employee profile in the organization, if it grants access. */
	ownEmployeeId: string | null;
	/** Why the viewer may see every employee's stamps in the organization, if they may. */
	organizationWide: "owner" | "admin" | "permission" | null;
};

export type PositionStampAccess =
	| { allowed: false }
	| {
			allowed: true;
			basis: "self" | "owner" | "admin" | "permission";
			/** Whether showing the stamps must write a position stamp access-log entry. */
			logged: boolean;
	  };

export const POSITION_STAMP_PERMISSION = { action: "read", subject: "PositionStamp" } as const;

export async function loadPositionStampViewer(
	db: Pick<PositionCaptureClient, "select">,
	input: { organizationId: string; userId: string },
): Promise<PositionStampViewer> {
	const { organizationId, userId } = input;
	const none: PositionStampViewer = {
		organizationId,
		userId,
		ownEmployeeId: null,
		organizationWide: null,
	};
	const [[membership], [profile]] = await Promise.all([
		db
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.userId, userId),
					eq(member.organizationId, organizationId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		db
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(
					eq(employee.userId, userId),
					eq(employee.organizationId, organizationId),
					employeeHasOrganizationAccess(),
				),
			)
			.limit(1),
	]);
	if (!membership) return none;

	const ownEmployeeId = profile?.id ?? null;
	if (membership.role === "owner" || membership.role === "admin") {
		return { ...none, ownEmployeeId, organizationWide: membership.role };
	}
	if (!ownEmployeeId) return none;

	const [grant] = await db
		.select({ roleId: customRole.id })
		.from(employeeCustomRole)
		.innerJoin(customRole, eq(employeeCustomRole.customRoleId, customRole.id))
		.innerJoin(customRolePermission, eq(customRolePermission.customRoleId, customRole.id))
		.where(
			and(
				eq(employeeCustomRole.employeeId, ownEmployeeId),
				eq(customRole.organizationId, organizationId),
				eq(customRole.isActive, true),
				eq(customRolePermission.action, POSITION_STAMP_PERMISSION.action),
				eq(customRolePermission.subject, POSITION_STAMP_PERMISSION.subject),
			),
		)
		.limit(1);
	return { ...none, ownEmployeeId, organizationWide: grant ? "permission" : null };
}

/** May this viewer see the stamps of the given employee (of the viewer's organization)? */
export function positionStampAccess(
	viewer: PositionStampViewer,
	subjectEmployeeId: string,
): PositionStampAccess {
	if (viewer.ownEmployeeId !== null && viewer.ownEmployeeId === subjectEmployeeId) {
		return { allowed: true, basis: "self", logged: false };
	}
	if (viewer.organizationWide) {
		return { allowed: true, basis: viewer.organizationWide, logged: true };
	}
	return { allowed: false };
}

/** For organization-wide reads such as the data export (#835): every employee's stamps. */
export function mayViewEveryonesPositionStamps(viewer: PositionStampViewer): boolean {
	return viewer.organizationWide !== null;
}
