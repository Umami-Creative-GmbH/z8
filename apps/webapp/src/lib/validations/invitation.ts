import { z } from "zod";
import { isReservedEmail } from "@/lib/auth/reserved-email";

/**
 * Validation schema for sending member invitations. Kiosk-only placeholder
 * addresses are never invited (ADR 0006, #857).
 */
export const invitationSchema = z.object({
	email: z
		.email("Invalid email address")
		.refine((email) => !isReservedEmail(email), "This address cannot receive invitations"),
	role: z.enum(["owner", "admin", "member"], {
		message: "Role must be owner, admin, or member",
	}),
	canCreateOrganizations: z.boolean().default(false).optional(),
	targetTeamId: z.uuid({ message: "Invalid target team" }).nullable().optional(),
});

/**
 * Validation schema for updating organization details
 */
export const updateOrganizationSchema = z.object({
	name: z
		.string()
		.min(2, "Name must be at least 2 characters")
		.max(100, "Name cannot exceed 100 characters")
		.optional(),
	slug: z
		.string()
		.min(2, "Slug must be at least 2 characters")
		.max(50, "Slug cannot exceed 50 characters")
		.regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens")
		.optional(),
	metadata: z.string().optional(), // JSON string for additional data
});

/**
 * Validation schema for updating member roles
 */
export const updateMemberRoleSchema = z.object({
	role: z.enum(["owner", "admin", "member"], {
		message: "Role must be owner, admin, or member",
	}),
});

// Type exports
export type InvitationData = z.infer<typeof invitationSchema>;
export type UpdateOrganizationData = z.infer<typeof updateOrganizationSchema>;
export type UpdateMemberRoleData = z.infer<typeof updateMemberRoleSchema>;
