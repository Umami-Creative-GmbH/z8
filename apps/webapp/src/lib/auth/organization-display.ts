import type { organization } from "@/db/auth-schema";
import type { UserOrganization } from "@/lib/auth-helpers";
import type { OrganizationSettingsBootstrap } from "@/stores/organization-settings-store";

type SettingsRecord = Pick<
	typeof organization.$inferSelect,
	| "id"
	| "shiftsEnabled"
	| "projectsEnabled"
	| "surchargesEnabled"
	| "demoDataEnabled"
	| "worksCouncilEnabled"
	| "billableTimeEnabled"
	| "personnelFilesEnabled"
	| "timezone"
	| "deletedAt"
>;

export function organizationSettingsForDisplay(
	record: SettingsRecord,
): OrganizationSettingsBootstrap {
	return {
		organizationId: record.id,
		shiftsEnabled: record.shiftsEnabled ?? false,
		projectsEnabled: record.projectsEnabled ?? false,
		surchargesEnabled: record.surchargesEnabled ?? false,
		demoDataEnabled: record.demoDataEnabled ?? true,
		worksCouncilEnabled: record.worksCouncilEnabled ?? false,
		billableTimeEnabled:
			(record.billableTimeEnabled ?? false) &&
			(record.projectsEnabled ?? false),
		personnelFilesEnabled: record.personnelFilesEnabled ?? false,
		timezone: record.timezone ?? "UTC",
		deletedAt: record.deletedAt?.toISOString() ?? null,
	};
}

export function organizationForDisplay(
	record: SettingsRecord &
		Pick<typeof organization.$inferSelect, "name" | "slug" | "logo">,
	memberRole: string,
	hasEmployeeRecord: boolean,
): UserOrganization {
	const {
		organizationId: _organizationId,
		timezone: _timezone,
		deletedAt: _deletedAt,
		...features
	} = organizationSettingsForDisplay(record);
	return {
		id: record.id,
		name: record.name,
		slug: record.slug,
		logo: record.logo,
		memberRole,
		hasEmployeeRecord,
		...features,
	};
}
