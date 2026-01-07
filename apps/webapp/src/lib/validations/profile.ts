import { z } from "zod";
import { passwordSchema } from "./password";

// Re-export passwordSchema for convenience
export { passwordSchema } from "./password";

export const profileUpdateSchema = z.object({
	name: z.string().min(1, "Name is required"),
	image: z
		.string()
		.refine(
			(val) => {
				// Allow empty string, relative paths, or valid URLs
				if (val === "" || val === undefined) return true;
				// Allow paths starting with /
				if (val.startsWith("/")) return true;
				// Allow valid URLs
				try {
					new URL(val);
					return true;
				} catch {
					return false;
				}
			},
			{ message: "Invalid image URL or path" },
		)
		.optional()
		.nullable(),
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
