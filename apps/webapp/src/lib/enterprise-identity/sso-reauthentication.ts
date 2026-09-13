import { sanitizeCallbackUrl } from "@/lib/auth/callback-url";

export async function startOrganizationSsoReauthentication(
	dependencies: {
		getMembership(userId: string, organizationId: string): Promise<boolean>;
		getPolicy(
			organizationId: string,
		): Promise<{ required: boolean; providerId: string | null }>;
		start(input: {
			providerId: string;
			callbackURL: string;
			errorCallbackURL: string;
		}): Promise<Response>;
	},
	input: {
		userId: string;
		organizationId: string;
		origin: string;
		callbackUrl?: string;
	},
) {
	if (!(await dependencies.getMembership(input.userId, input.organizationId)))
		throw new Error("Organization membership required");
	const policy = await dependencies.getPolicy(input.organizationId);
	if (!policy.required || !policy.providerId)
		throw new Error(
			"Organization SSO is not available. Contact your administrator.",
		);
	const callback = new URL("/init", input.origin);
	callback.searchParams.set("organizationId", input.organizationId);
	callback.searchParams.set("ssoAttempt", "1");
	callback.searchParams.set(
		"callbackUrl",
		sanitizeCallbackUrl(input.callbackUrl, "/", input.origin),
	);
	const errorCallback = new URL(callback);
	errorCallback.searchParams.set("ssoError", "1");
	return dependencies.start({
		providerId: policy.providerId,
		callbackURL: callback.href,
		errorCallbackURL: errorCallback.href,
	});
}
