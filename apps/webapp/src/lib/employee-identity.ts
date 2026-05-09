export type EmployeeIdentityInput = {
	firstName?: string | null;
	lastName?: string | null;
	pronouns?: string | null;
	user: {
		name?: string | null;
		email: string;
	};
};

export function normalizePronouns(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed || null;
}

export function getEmployeeBaseDisplayName(employee: EmployeeIdentityInput): string {
	const structuredName = [employee.firstName, employee.lastName]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(" ");

	if (structuredName) return structuredName;

	const userName = employee.user.name?.trim();
	if (userName) return userName;

	return employee.user.email.split("@")[0] || employee.user.email;
}

export function formatEmployeeIdentityName(employee: EmployeeIdentityInput): string {
	const name = getEmployeeBaseDisplayName(employee);
	const pronouns = normalizePronouns(employee.pronouns);

	return pronouns ? `${name} (${pronouns})` : name;
}
