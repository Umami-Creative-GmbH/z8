/** Shared by the workspace initializer and organization switcher. */
export async function activateOrganization(
	organizationId: string,
	callbackUrl: string,
	request: typeof fetch = fetch,
	allowSso = true,
): Promise<
	{ kind: "active"; hasEmployeeRecord: boolean } | { kind: "sso"; url: string }
> {
	const response = await request("/api/organizations/switch", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ organizationId }),
	});
	const result = await response.json();
	if (response.ok)
		return { kind: "active", hasEmployeeRecord: !!result.hasEmployeeRecord };
	if (result.code !== "SSO_REQUIRED")
		throw new Error(result.error || "Failed to switch organization");
	if (!allowSso)
		throw new Error(
			"SSO sign-in did not grant access. Try again or contact your organization administrator.",
		);
	const sso = await request("/api/organizations/sso", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ organizationId, callbackUrl }),
	});
	const redirect = await sso.json();
	if (!sso.ok || typeof redirect.url !== "string")
		throw new Error(redirect.error || "SSO sign-in could not be started");
	const url = new URL(redirect.url);
	if (url.protocol !== "https:" && url.protocol !== "http:")
		throw new Error("Invalid SSO redirect");
	return { kind: "sso", url: url.href };
}
