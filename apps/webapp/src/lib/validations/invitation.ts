import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { engagementKinds } from "@/lib/engagement/engagement-kind";

/** Trimmed optional text; empty becomes null. */
const optionalText = (max: number, message: string) =>
	z
		.string()
		.trim()
		.max(max, message)
		.nullish()
		.transform((value) => (value ? value : null));

/**
 * What an External Contractor invitation prepares (#1995): optional
 * contracting details, projects to assign and a planned engagement end, an
 * org-local calendar date that becomes a scheduled departure once they joined.
 */
export const contractorInvitationSchema = z.object({
	companyName: optionalText(200, "Company name cannot exceed 200 characters"),
	vatId: optionalText(50, "VAT ID cannot exceed 50 characters"),
	referenceCode: optionalText(100, "PO or cost center cannot exceed 100 characters"),
	projectIds: z
		.array(z.uuid({ message: "Invalid project" }))
		.max(50)
		.default([]),
	plannedEndDate: z.iso.date({ message: "Invalid planned end date" }).nullish().default(null),
});

export type ContractorInvitation = z.infer<typeof contractorInvitationSchema>;

export const PLANNED_END_NOT_FUTURE_MESSAGE = "The planned engagement end must be after today";

/**
 * A planned engagement end is a later day than the organization's today
 * (#1995). Only such a day can still be scheduled as a leaving date when the
 * contractor joins; both are org-local ISO calendar dates.
 */
export function isPlannedEndAfterOrganizationToday(
	plannedEndDate: string,
	organizationToday: Temporal.PlainDate,
): boolean {
	return Temporal.PlainDate.compare(Temporal.PlainDate.from(plannedEndDate), organizationToday) > 0;
}

/**
 * Contracting details belong only to an External Contractor invitation. Shared
 * with the server action's stricter object, which spreads `invitationSchema.shape`.
 */
export function refineInvitationEngagement(
	value: { engagementKind?: string; contractor?: unknown },
	context: z.RefinementCtx,
) {
	if (value.engagementKind !== "contractor" && value.contractor != null) {
		context.addIssue({
			code: "custom",
			path: ["contractor"],
			message: "Contracting details apply only to External Contractors",
		});
	}
}

/**
 * Validation schema for sending member invitations. Kiosk-only placeholder
 * addresses are never invited (ADR 0006, #857). An invitation brings in an
 * employee unless it names an External Contractor (#1995).
 */
export const invitationSchema = z
	.object({
		email: z
			.email("Invalid email address")
			.refine((email) => !isReservedEmail(email), "This address cannot receive invitations"),
		role: z.enum(["owner", "admin", "member"], {
			message: "Role must be owner, admin, or member",
		}),
		canCreateOrganizations: z.boolean().default(false).optional(),
		targetTeamId: z.uuid({ message: "Invalid target team" }).nullable().optional(),
		engagementKind: z.enum(engagementKinds).default("employee"),
		contractor: contractorInvitationSchema.nullish(),
	})
	.superRefine(refineInvitationEngagement);

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
