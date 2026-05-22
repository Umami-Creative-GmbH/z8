export interface OrganizationSecretProvider {
	storeOrgSecret(organizationId: string, key: string, value: string): Promise<void>;
	getOrgSecret(organizationId: string, key: string): Promise<string | null>;
	deleteOrgSecret(organizationId: string, key: string): Promise<void>;
	deleteAllOrgSecrets(organizationId: string): Promise<void>;
}
