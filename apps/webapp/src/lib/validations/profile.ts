import { z } from "zod";
import { trimStructuredNamePart } from "../auth/derived-user-name";
import { genderSchema } from "./employee";
import { passwordSchema } from "./password";

// Re-export passwordSchema for convenience
export { passwordSchema } from "./password";

const profileImageSchema = z
	.string()
	.refine(
		(val) => {
			if (val === "" || val === undefined) return true;
			if (val.startsWith("/") && !val.startsWith("//")) return true;

			try {
				const url = new URL(val);
				return url.protocol === "http:" || url.protocol === "https:";
			} catch {
				return false;
			}
		},
		{ message: "Invalid image URL or path" },
	)
	.optional()
	.nullable();

const structuredNamePartSchema = z.string();

export const profileStructuredNameRequiredMessage = "Enter a first or last name";

function hasStructuredProfileName(firstName: string, lastName: string): boolean {
	return Boolean(trimStructuredNamePart(firstName) || trimStructuredNamePart(lastName));
}

export function validateStructuredProfileNameField(
	fieldName: "firstName" | "lastName",
	data: {
		firstName: string;
		lastName: string;
	},
): string | undefined {
	if (hasStructuredProfileName(data.firstName, data.lastName)) {
		return undefined;
	}

	return profileStructuredNameRequiredMessage;
}

export const profileDetailsUpdateSchema = z.object({
	firstName: structuredNamePartSchema,
	lastName: structuredNamePartSchema,
	gender: genderSchema.optional().nullable(),
	birthday: z.date().max(new Date(), "Birthday must be in the past").optional().nullable(),
	image: profileImageSchema,
}).superRefine((data, ctx) => {
	if (hasStructuredProfileName(data.firstName, data.lastName)) {
		return;
	}

	ctx.addIssue({
		code: z.ZodIssueCode.custom,
		message: profileStructuredNameRequiredMessage,
		path: ["firstName"],
	});
	ctx.addIssue({
		code: z.ZodIssueCode.custom,
		message: profileStructuredNameRequiredMessage,
		path: ["lastName"],
	});
});

export const profileImageUpdateSchema = z.object({
	image: profileImageSchema,
});

export const profileUpdateSchema = profileDetailsUpdateSchema;

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
