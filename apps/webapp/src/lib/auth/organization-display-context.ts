import type { OrganizationSettingsBootstrap } from "@/stores/organization-settings-store";

export const ORGANIZATION_CONTEXT_HEADERS = {
	user: "x-z8-context-user",
	organization: "x-z8-context-organization",
} as const;

/** Presentation only. Every server read and command still authorizes its request. */
export interface OrganizationDisplayContext {
	userId: string;
	organizationId: string | null;
	employee: {
		employeeId: string;
		organizationId: string;
		role: "admin" | "manager" | "employee";
	} | null;
	organizationSettings: OrganizationSettingsBootstrap | null;
	updatedAt: number;
}
