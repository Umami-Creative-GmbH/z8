const SCOPED_MANAGER_EDITABLE_EMPLOYEE_FIELDS = [
	"gender",
	"pronouns",
	"position",
	"startDate",
] as const;

type ScopedManagerEditableEmployeeField = (typeof SCOPED_MANAGER_EDITABLE_EMPLOYEE_FIELDS)[number];

export function filterEmployeeUpdateForScopedManager<T extends Record<string, unknown>>(data: T) {
	const result = {} as Partial<Pick<T, ScopedManagerEditableEmployeeField>>;

	for (const key of SCOPED_MANAGER_EDITABLE_EMPLOYEE_FIELDS) {
		if (key in data) {
			(result as Record<string, unknown>)[key] = data[key];
		}
	}

	return result;
}
