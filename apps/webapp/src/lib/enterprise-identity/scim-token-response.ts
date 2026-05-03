export interface EnterpriseIdentityScimTokenResponse {
	providerId: string;
	scimToken: string | undefined;
	baseUrl: "/api/auth/scim/v2";
}

export function buildEnterpriseIdentityScimTokenResponse(
	result: { token?: string; scimToken?: string },
	providerId: string,
): EnterpriseIdentityScimTokenResponse {
	return {
		providerId,
		scimToken: result.scimToken ?? result.token,
		baseUrl: "/api/auth/scim/v2",
	};
}
