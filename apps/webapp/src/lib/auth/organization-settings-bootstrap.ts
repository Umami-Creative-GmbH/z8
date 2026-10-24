/** Serializable presentation settings shared by server readers and client stores. */
export interface OrganizationSettingsBootstrap {
	organizationId: string | null;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	worksCouncilEnabled: boolean;
	/** Billable Time module (#897); never true while projects are off. */
	billableTimeEnabled: boolean;
	personnelFilesEnabled: boolean;
	timezone: string;
	deletedAt: string | null;
}
