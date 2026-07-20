export type OrganizationRoleValue =
	| string
	| readonly unknown[]
	| null
	| undefined;

export function getOrganizationRoleTokens(value: unknown): string[] {
	const values = Array.isArray(value) ? value : [value];

	return values.flatMap((item) =>
		typeof item === "string"
			? item
					.split(",")
					.map((role) => role.trim())
					.filter(Boolean)
			: [],
	);
}

export function hasOrganizationRole(value: unknown, role: string): boolean {
	return getOrganizationRoleTokens(value).includes(role);
}
