export type EmployeeSettingsActorRole = "admin" | "manager" | "employee";

const SCOPED_MANAGER_EDITABLE_EMPLOYEE_FIELDS = [
	"firstName",
	"lastName",
	"gender",
	"position",
] as const;

type ScopedManagerEditableEmployeeField =
	(typeof SCOPED_MANAGER_EDITABLE_EMPLOYEE_FIELDS)[number];

export function canAccessManagedEmployeeSettingsTarget(input: {
	actorRole: EmployeeSettingsActorRole;
	isManagedEmployee: boolean;
}) {
	if (input.actorRole === "admin") {
		return true;
	}

	return input.actorRole === "manager" && input.isManagedEmployee;
}

export function filterEmployeeUpdateForScopedManager<T extends Record<string, unknown>>(data: T) {
	const result = {} as Partial<Pick<T, ScopedManagerEditableEmployeeField>>;

	for (const key of SCOPED_MANAGER_EDITABLE_EMPLOYEE_FIELDS) {
		if (key in data) {
			(result as Record<string, unknown>)[key] = data[key];
		}
	}

	return result;
}
