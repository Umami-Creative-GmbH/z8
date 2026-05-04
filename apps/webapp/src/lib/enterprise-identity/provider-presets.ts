export type EnterpriseIdentityProviderPresetId =
	| "okta"
	| "microsoft-entra"
	| "google-workspace"
	| "generic";

export type EnterpriseIdentityProtocol = "oidc" | "saml";

export interface EnterpriseIdentityProviderPreset {
	id: EnterpriseIdentityProviderPresetId;
	name: string;
	description: string;
	supportedProtocols: EnterpriseIdentityProtocol[];
	defaultProtocol: EnterpriseIdentityProtocol;
	issuerPlaceholder: string;
	domainHelp: string;
	setupHints: string[];
	defaultOidcScopes: string[];
}

export const ENTERPRISE_IDENTITY_PROVIDER_PRESETS: Record<
	EnterpriseIdentityProviderPresetId,
	EnterpriseIdentityProviderPreset
> = {
	okta: {
		id: "okta",
		name: "Okta",
		description: "Use Okta Workforce Identity for SAML or OIDC single sign-on.",
		supportedProtocols: ["oidc", "saml"],
		defaultProtocol: "oidc",
		issuerPlaceholder: "https://acme.okta.com",
		domainHelp: "Use the corporate email domain assigned to this Okta tenant.",
		setupHints: [
			"Create an OIDC or SAML app integration in Okta.",
			"Copy the callback or ACS URL from Z8 into Okta.",
			"Assign a small pilot group before enabling enforcement.",
		],
		defaultOidcScopes: ["openid", "email", "profile"],
	},
	"microsoft-entra": {
		id: "microsoft-entra",
		name: "Microsoft Entra ID",
		description: "Use Microsoft Entra ID for enterprise SSO and optional provisioning.",
		supportedProtocols: ["oidc", "saml"],
		defaultProtocol: "oidc",
		issuerPlaceholder: "https://login.microsoftonline.com/{tenant-id}/v2.0",
		domainHelp: "Use the verified email domain for the Entra tenant.",
		setupHints: [
			"Register an enterprise application in Entra ID.",
			"Use the Z8 redirect URI for the selected protocol.",
			"Grant admin consent before running the SSO test.",
		],
		defaultOidcScopes: ["openid", "email", "profile"],
	},
	"google-workspace": {
		id: "google-workspace",
		name: "Google Workspace",
		description: "Use Google Workspace OIDC for SSO and optional directory sync.",
		supportedProtocols: ["oidc"],
		defaultProtocol: "oidc",
		issuerPlaceholder: "https://accounts.google.com",
		domainHelp: "Use the primary Google Workspace email domain.",
		setupHints: [
			"Create an OAuth client in Google Cloud Console.",
			"Add the Z8 redirect URI to authorized redirect URIs.",
			"Limit rollout to the verified Workspace domain first.",
		],
		defaultOidcScopes: ["openid", "email", "profile"],
	},
	generic: {
		id: "generic",
		name: "Generic SAML/OIDC",
		description: "Use any standards-compliant OIDC or SAML 2.0 identity provider.",
		supportedProtocols: ["oidc", "saml"],
		defaultProtocol: "oidc",
		issuerPlaceholder: "https://idp.example.com",
		domainHelp: "Use the corporate email domain controlled by this identity provider.",
		setupHints: [
			"Confirm the provider supports OIDC authorization code flow or SAML 2.0.",
			"Use SHA-256 or stronger signing algorithms.",
			"Test with one admin account before activating enforcement.",
		],
		defaultOidcScopes: ["openid", "email", "profile"],
	},
};

export function getEnterpriseIdentityPreset(id: string | null | undefined) {
	if (!id) return null;
	return ENTERPRISE_IDENTITY_PROVIDER_PRESETS[id as EnterpriseIdentityProviderPresetId] ?? null;
}
