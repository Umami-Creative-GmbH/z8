export type SsoSetupKind = "microsoft-entra" | "generic";
type Translate = (key: string, fallback: string) => string;

export function getSsoGuideContent(kind: SsoSetupKind, t: Translate) {
	if (kind === "microsoft-entra") {
		return {
			title: t(
				"settings.enterprise.sso.guide.entra.title",
				"Set up Microsoft Entra ID",
			),
			description: t(
				"settings.enterprise.sso.guide.entra.description",
				"Connect your organization's Microsoft directory with a single-tenant OpenID Connect application.",
			),
			steps: [
				{
					title: t(
						"settings.enterprise.sso.guide.entra.register.title",
						"Register an application",
					),
					description: t(
						"settings.enterprise.sso.guide.entra.register.body",
						"Open Entra ID → App registrations → New registration. Name the app Z8 and choose Accounts in this organizational directory only. Select your organization's directory first. If you cannot register apps, ask your Entra administrator to create one for you.",
					),
					href: "https://entra.microsoft.com/",
					linkLabel: t(
						"settings.enterprise.sso.guide.entra.portal",
						"Open Entra admin center",
					),
				},
				{
					title: t(
						"settings.enterprise.sso.guide.entra.redirect.title",
						"Add the Web redirect URI",
					),
					description: t(
						"settings.enterprise.sso.guide.entra.redirect.body",
						"In Authentication, add a redirect URI for the Web platform. Paste the Z8 callback shown here exactly. Use Web, not Single-page application. You do not need to enable implicit grant.",
					),
					href: "https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri",
					linkLabel: t(
						"settings.enterprise.sso.guide.entra.redirect.link",
						"Redirect URI instructions",
					),
				},
				{
					title: t(
						"settings.enterprise.sso.guide.entra.ids.title",
						"Copy the tenant and application IDs",
					),
					description: t(
						"settings.enterprise.sso.guide.entra.ids.body",
						"On the app's Overview, copy Directory (tenant) ID and Application (client) ID into Z8. The Object ID is a different value. Z8 builds the tenant-specific issuer URL for you.",
					),
					href: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
					linkLabel: t(
						"settings.enterprise.sso.guide.entra.ids.link",
						"App registration instructions",
					),
				},
				{
					title: t(
						"settings.enterprise.sso.guide.entra.secret.title",
						"Create a client secret",
					),
					description: t(
						"settings.enterprise.sso.guide.entra.secret.body",
						"Go to Certificates & secrets → Client secrets → New client secret. Paste its Value into Z8, not its Secret ID. The Value is shown only once. Record the expiry and replace the credential before it expires. Share the Value only through your organization's secure channel.",
					),
					href: "https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials",
					linkLabel: t(
						"settings.enterprise.sso.guide.entra.secret.link",
						"Client secret instructions",
					),
				},
			],
		};
	}
	return {
		title: t(
			"settings.enterprise.sso.guide.generic.title",
			"Set up an OIDC provider",
		),
		description: t(
			"settings.enterprise.sso.guide.generic.description",
			"Use your provider's documentation to create a confidential Web application with the authorization code flow.",
		),
		steps: [
			{
				title: t(
					"settings.enterprise.sso.guide.generic.register.title",
					"Create a Web application",
				),
				description: t(
					"settings.enterprise.sso.guide.generic.register.body",
					"In your identity provider, create an OpenID Connect application using the authorization code flow. Assign a small pilot group first.",
				),
				href: undefined,
				linkLabel: undefined,
			},
			{
				title: t(
					"settings.enterprise.sso.guide.generic.redirect.title",
					"Register the callback URL",
				),
				description: t(
					"settings.enterprise.sso.guide.generic.redirect.body",
					"Add the Z8 callback shown here to the application's allowed redirect URIs. Copy it exactly, including the organization hostname and path.",
				),
				href: undefined,
				linkLabel: undefined,
			},
			{
				title: t(
					"settings.enterprise.sso.guide.generic.credentials.title",
					"Copy the application settings",
				),
				description: t(
					"settings.enterprise.sso.guide.generic.credentials.body",
					"Enter a unique provider ID, the OIDC issuer URL, your organization's email domain, the client ID, and the client secret. Find these in your provider's application settings. Transfer secrets through a secure channel.",
				),
				href: undefined,
				linkLabel: undefined,
			},
		],
	};
}

// Only public setup information is accepted here; credentials never enter the checklist.
export function buildSsoHandoffChecklist({
	kind,
	callbackUrl,
	domain,
	t,
}: {
	kind: SsoSetupKind;
	callbackUrl: string;
	domain?: string;
	t: Translate;
}) {
	const guide = getSsoGuideContent(kind, t);
	return [
		guide.title,
		guide.description,
		`${t("settings.enterprise.sso.guide.callback", "Z8 callback URL")}: ${callbackUrl}`,
		domain
			? `${t("settings.enterprise.sso.emailDomain", "Email Domain")}: ${domain}`
			: "",
		t(
			"settings.enterprise.sso.guide.scopes",
			"Sign-in scopes include openid, email, and profile. Some connections also request offline_access for refresh tokens.",
		),
		...guide.steps.map(
			(step, index) =>
				`${index + 1}. ${step.title}\n${step.description}${step.href ? `\n${step.href}` : ""}`,
		),
		t(
			"settings.enterprise.sso.guide.handoff.return",
			"Return the tenant ID (for Entra) and application client ID to the Z8 administrator. Transfer the client secret Value separately through a secure channel; do not paste it into this checklist.",
		),
		t(
			"settings.enterprise.sso.guide.afterSave",
			"After saving, verify your email domain with the DNS TXT record in Z8. Pilot sign-in with an intended user while keeping your current administrator session open. In Guided setup, save the same provider ID and email domain shown in the provider list, then manually record the observed sign-in result before considering Require SSO. Saving and DNS verification do not prove a successful sign-in.",
		),
	]
		.filter(Boolean)
		.join("\n\n");
}
