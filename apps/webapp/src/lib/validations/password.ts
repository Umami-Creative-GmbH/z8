import { z } from "zod";

/**
 * Password validation regex patterns
 * These patterns are used for real-time validation feedback and Zod schema validation
 */
export const PASSWORD_PATTERNS = {
	HAS_LOWERCASE: /[a-z]/,
	HAS_UPPERCASE: /[A-Z]/,
	HAS_DIGIT: /\d/,
} as const;

/**
 * Password requirement type for UI display
 */
export type PasswordRequirement = {
	label: string;
	met: boolean;
};

/**
 * Check password requirements against all validation rules
 * Used for real-time UI feedback during password input
 *
 * @param password - The password string to validate
 * @param t - Translation function for internationalization
 * @returns Array of password requirements with their met status
 */
export function checkPasswordRequirements(
	password: string,
	t: (key: string, fallback: string) => string,
): PasswordRequirement[] {
	return [
		{
			label: t("setup:setup.password.min_length", "12+ characters"),
			met: password.length >= 12,
		},
		{
			label: t("setup:setup.password.uppercase", "Uppercase letter"),
			met: PASSWORD_PATTERNS.HAS_UPPERCASE.test(password),
		},
		{
			label: t("setup:setup.password.lowercase", "Lowercase letter"),
			met: PASSWORD_PATTERNS.HAS_LOWERCASE.test(password),
		},
		{
			label: t("setup:setup.password.number", "Number"),
			met: PASSWORD_PATTERNS.HAS_DIGIT.test(password),
		},
	];
}

/**
 * Zod schema for password validation
 * Enforces all password requirements:
 * - Minimum 12 characters
 * - At least 1 lowercase letter
 * - At least 1 uppercase letter
 * - At least 1 digit
 */
export const passwordSchema = z
	.string()
	.min(12, "Password must be at least 12 characters")
	.max(128, "Password must be at most 128 characters")
	.refine(
		(password) => PASSWORD_PATTERNS.HAS_LOWERCASE.test(password),
		"Password must contain at least one lowercase letter",
	)
	.refine(
		(password) => PASSWORD_PATTERNS.HAS_UPPERCASE.test(password),
		"Password must contain at least one uppercase letter",
	)
	.refine(
		(password) => PASSWORD_PATTERNS.HAS_DIGIT.test(password),
		"Password must contain at least one digit",
	);

/**
 * Zod schema for password confirmation
 * Validates that two passwords match
 */
export const passwordWithConfirmSchema = z
	.object({
		password: passwordSchema,
		confirmPassword: z.string().min(1, "Please confirm your password"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});
