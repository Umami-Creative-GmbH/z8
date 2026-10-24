import { and, eq } from "drizzle-orm";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { hasEndedEmploymentWithoutRehire } from "./employment-periods";
import type { LifecycleClient } from "./types";

export type LifecycleTargetEmployee = Pick<
	typeof employee.$inferSelect,
	"id" | "userId" | "isActive"
>;

export type LifecycleTargetCheck =
	| { type: "change"; targetEmployee: LifecycleTargetEmployee }
	/** Already in the requested state. */
	| { type: "unchanged"; targetEmployee: LifecycleTargetEmployee }
	| { type: "not_found" }
	| { type: "actor_membership_missing" }
	| { type: "target_membership_missing" }
	| { type: "self_target" }
	| { type: "admin_targeting_owner" }
	| { type: "final_accessible_owner" }
	| { type: "rehire_required" };

/**
 * Who may switch an employee on or off, as Deactivate and Reactivate check it
 * (and the deactivation preview, #1440): an approved owner or admin of the
 * organization, never on themselves, an admin never on an owner, never the
 * last accessible owner, and an ended employment only through a rehire. Every
 * read is scoped to the organization. Inside the lifecycle transaction the
 * caller holds the organization row, which serializes the owner checks.
 */
export async function checkLifecycleTarget(
	reader: Pick<LifecycleClient, "query" | "select" | "execute">,
	input: { organizationId: string; actorUserId: string; employeeId: string; isActive: boolean },
): Promise<LifecycleTargetCheck> {
	const actorMembership = await reader.query.member.findFirst({
		where: and(
			eq(member.userId, input.actorUserId),
			eq(member.organizationId, input.organizationId),
			eq(member.status, "approved"),
		),
		columns: { role: true, userId: true },
	});
	if (!actorMembership) return { type: "actor_membership_missing" };
	const actorIsOwner = hasOrganizationRole(actorMembership.role, "owner");
	const actorIsAdmin = hasOrganizationRole(actorMembership.role, "admin");
	if (!actorIsOwner && !actorIsAdmin) return { type: "actor_membership_missing" };

	const targetEmployee = await reader.query.employee.findFirst({
		where: and(
			eq(employee.id, input.employeeId),
			eq(employee.organizationId, input.organizationId),
		),
		columns: { id: true, userId: true, isActive: true },
	});
	if (!targetEmployee) return { type: "not_found" };

	const targetMembership = await reader.query.member.findFirst({
		where: and(
			eq(member.userId, targetEmployee.userId),
			eq(member.organizationId, input.organizationId),
			eq(member.status, "approved"),
		),
		columns: { role: true, userId: true },
	});
	if (!targetMembership) return { type: "target_membership_missing" };
	if (targetEmployee.userId === input.actorUserId) return { type: "self_target" };
	const targetIsOwner = hasOrganizationRole(targetMembership.role, "owner");
	if (!actorIsOwner && actorIsAdmin && targetIsOwner) return { type: "admin_targeting_owner" };

	if (targetEmployee.isActive === input.isActive) return { type: "unchanged", targetEmployee };

	// Ended employment is restored only through an explicit rehire.
	if (
		input.isActive &&
		(await hasEndedEmploymentWithoutRehire(reader, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
		}))
	) {
		return { type: "rehire_required" };
	}

	if (!input.isActive && targetIsOwner) {
		const approvedOwners = await reader
			.select({
				userId: member.userId,
				role: member.role,
				employeeIsActive: employee.isActive,
			})
			.from(member)
			.leftJoin(
				employee,
				and(eq(employee.userId, member.userId), eq(employee.organizationId, input.organizationId)),
			)
			.where(and(eq(member.organizationId, input.organizationId), eq(member.status, "approved")));
		const hasAlternativeAccessibleOwner = approvedOwners.some(
			(owner) =>
				owner.userId !== targetEmployee.userId &&
				hasOrganizationRole(owner.role, "owner") &&
				owner.employeeIsActive !== false,
		);
		if (!hasAlternativeAccessibleOwner) return { type: "final_accessible_owner" };
	}

	return { type: "change", targetEmployee };
}
