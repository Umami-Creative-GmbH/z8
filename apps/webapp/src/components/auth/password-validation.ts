type Translate = (key: string, fallback: string) => string;

const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const NUMBER_REGEX = /[0-9]/;

function validateStrongPassword(value: string, t: Translate): string | undefined {
	if (!value) {
		return t("setup:setup.error.password_required", "Password is required");
	}
	if (value.length < 12) {
		return t("setup:setup.error.password_min_length", "Password must be at least 12 characters");
	}
	if (value.length > 128) {
		return t("setup:setup.error.password_max_length", "Password must be at most 128 characters");
	}
	if (!UPPERCASE_REGEX.test(value)) {
		return t("setup:setup.error.password_uppercase", "Password must contain at least one uppercase letter");
	}
	if (!LOWERCASE_REGEX.test(value)) {
		return t("setup:setup.error.password_lowercase", "Password must contain at least one lowercase letter");
	}
	if (!NUMBER_REGEX.test(value)) {
		return t("setup:setup.error.password_number", "Password must contain at least one number");
	}
	return undefined;
}

function validatePasswordConfirmation(
	value: string,
	password: string,
	t: Translate,
): string | undefined {
	if (!value.trim()) {
		return t("auth.confirm-password-required", "Please confirm your password");
	}
	if (value !== password) {
		return t("setup:setup.error.passwords_mismatch", "Passwords do not match");
	}
	return undefined;
}

export {
	LOWERCASE_REGEX,
	NUMBER_REGEX,
	UPPERCASE_REGEX,
	validatePasswordConfirmation,
	validateStrongPassword,
};
