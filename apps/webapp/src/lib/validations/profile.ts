import { z } from "zod";

// Password validation patterns (reused from signup-form.tsx)
const HAS_LOWERCASE = /[a-z]/;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_DIGIT = /\d/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

export const passwordSchema = z
	.string()
	.min(8, "Password must be at least 8 characters")
	.refine(
		(password) => HAS_LOWERCASE.test(password),
		"Password must contain at least one lowercase letter",
	)
	.refine(
		(password) => HAS_UPPERCASE.test(password),
		"Password must contain at least one uppercase letter",
	)
	.refine((password) => HAS_DIGIT.test(password), "Password must contain at least one digit")
	.refine(
		(password) => HAS_SPECIAL.test(password),
		"Password must contain at least one special character",
	);

export const profileUpdateSchema = z.object({
	name: z.string().min(1, "Name is required"),
	image: z.string().url("Invalid image URL").optional().or(z.literal("")),
});

export const passwordChangeSchema = z
	.object({
		currentPassword: z.string().min(1, "Current password is required"),
		newPassword: passwordSchema,
		confirmPassword: z.string().min(1, "Please confirm your password"),
	})
	.refine((data) => data.newPassword === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});
