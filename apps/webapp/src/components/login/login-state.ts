// zod's `z.email()` pattern, inlined: importing zod (even zod/mini) adds ~80-110 KB to the sign-in page.
const EMAIL_PATTERN =
	/^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export function isValidLoginEmail(value: string): boolean {
	return EMAIL_PATTERN.test(value);
}

/** Field errors for the credentials form; empty when both fields are valid. */
export function validateLoginCredentials(values: {
	email: string;
	password: string;
}): Record<string, string> {
	const errors: Record<string, string> = {};
	if (!isValidLoginEmail(values.email)) errors.email = "Invalid email address";
	if (values.password.length === 0) errors.password = "Password is required";
	return errors;
}
