import type {
	FormAsyncValidateOrFn,
	FormValidateOrFn,
	ReactFormExtendedApi,
} from "@tanstack/react-form";
import type { CompensationFormValues } from "@/components/settings/contracts/contractor-compensation-form-values";
import type { EngagementKind } from "@/lib/engagement/engagement-kind";

/** The invite dialog's values: an invitation, or a kiosk-only employee (#857). */
export interface InviteMemberFormValues {
	email: string;
	role: "owner" | "admin" | "member";
	canCreateOrganizations: boolean;
	targetTeamId: string;
	// Kiosk-only employees (#857): no email, no sign-in, clock only at kiosks.
	kioskOnly: boolean;
	firstName: string;
	lastName: string;
	locationIds: string[];
	// An External Contractor skips employee-only setup (#1995).
	engagementKind: EngagementKind;
	contractorCompanyName: string;
	contractorVatId: string;
	contractorReferenceCode: string;
	contractorProjectIds: string[];
	plannedEndDate: string;
	// The engagement's first rate, written from its start once they join (#1935).
	contractorCompensationEnabled: boolean;
	contractorCompensation: CompensationFormValues;
}

/** What a submit carries: the dialog's activation, so a stale submit is ignored. */
export type InviteMemberSubmitMeta = { activation: { arrival: object } | null };

export type InviteMemberFormApi = ReactFormExtendedApi<
	InviteMemberFormValues,
	FormValidateOrFn<InviteMemberFormValues> | undefined,
	FormValidateOrFn<InviteMemberFormValues> | undefined,
	FormAsyncValidateOrFn<InviteMemberFormValues> | undefined,
	FormValidateOrFn<InviteMemberFormValues> | undefined,
	FormAsyncValidateOrFn<InviteMemberFormValues> | undefined,
	FormValidateOrFn<InviteMemberFormValues> | undefined,
	FormAsyncValidateOrFn<InviteMemberFormValues> | undefined,
	FormValidateOrFn<InviteMemberFormValues> | undefined,
	FormAsyncValidateOrFn<InviteMemberFormValues> | undefined,
	FormAsyncValidateOrFn<InviteMemberFormValues> | undefined,
	InviteMemberSubmitMeta
>;
