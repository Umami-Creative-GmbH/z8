export interface StructuredUserNameInput {
	firstName?: string | null;
	lastName?: string | null;
	fallbackName?: string | null;
}

export interface AuthStructuredNameInput {
	firstName: string;
	lastName: string;
	fallbackName?: string;
}

export interface AuthUserDisplayNameInput {
	firstName?: string | null;
	lastName?: string | null;
	name?: string | null;
	email?: string | null;
}

export function trimStructuredNamePart(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function deriveUserName({ firstName, lastName, fallbackName }: StructuredUserNameInput): string {
	const normalizedFirstName = trimStructuredNamePart(firstName);
	const normalizedLastName = trimStructuredNamePart(lastName);
	const normalizedFallbackName = trimStructuredNamePart(fallbackName);
	const derivedName = [normalizedFirstName, normalizedLastName].filter(Boolean).join(" ");

	return derivedName || normalizedFallbackName || "";
}

export function buildDerivedUserName(
	firstName: string,
	lastName: string,
	fallbackName?: string,
): string {
	return deriveUserName({ firstName, lastName, fallbackName });
}

export function buildAuthUserDisplayName(user: AuthUserDisplayNameInput): string {
	return (
		deriveUserName({
			firstName: user.firstName,
			lastName: user.lastName,
			fallbackName: user.name,
		}) ||
		trimStructuredNamePart(user.email) ||
		""
	);
}

export function toAuthStructuredName({
	firstName,
	lastName,
	fallbackName,
}: AuthStructuredNameInput): {
	firstName: string | undefined;
	lastName: string | undefined;
	name: string;
} {
	const normalizedFirstName = trimStructuredNamePart(firstName);
	const normalizedLastName = trimStructuredNamePart(lastName);

	return {
		firstName: normalizedFirstName,
		lastName: normalizedLastName,
		name: buildDerivedUserName(firstName, lastName, fallbackName),
	};
}
