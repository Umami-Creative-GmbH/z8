const TENANT_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getEntraIssuer(tenantId: string): string | null {
	const tenant = tenantId.trim().toLowerCase();
	return TENANT_ID_PATTERN.test(tenant)
		? `https://login.microsoftonline.com/${tenant}/v2.0`
		: null;
}

export function getOidcCallbackUrl(organizationOrigin: string) {
	return `${organizationOrigin.replace(/\/$/, "")}/api/auth/sso/callback`;
}
