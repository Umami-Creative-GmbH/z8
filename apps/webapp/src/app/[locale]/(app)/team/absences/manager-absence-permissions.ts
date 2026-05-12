import type {
	ManagerAbsenceActor,
	ManagerAbsenceEmployeeTarget,
	ManagerAbsenceRole,
} from "./manager-absence-types";

export function canUseManagerAbsencePage(role: ManagerAbsenceRole): boolean {
	return role === "admin" || role === "manager";
}

export function canActorManageTarget(input: {
	actor: Pick<ManagerAbsenceActor, "id" | "organizationId" | "role">;
	target: ManagerAbsenceEmployeeTarget;
	managerIdsForTarget: string[];
}): boolean {
	const { actor, target, managerIdsForTarget } = input;

	if (!target.isActive || actor.organizationId !== target.organizationId) {
		return false;
	}

	if (actor.role === "admin") {
		return true;
	}

	if (actor.role === "manager") {
		return managerIdsForTarget.includes(actor.id);
	}

	return false;
}
