import type { EnterpriseIdentitySetupStep } from "@/lib/enterprise-identity/setup-state";
import type { IdentitySetupController } from "./identity-setup-controller";

/** The provider's name for use inside a sentence. */
export function providerName(controller: IdentitySetupController) {
	return controller.presetId === "generic"
		? controller.t(
				"settings.enterprise.identity.wizard.provider.genericName",
				"your identity provider",
			)
		: controller.preset.name;
}

export function domainName(controller: IdentitySetupController) {
	return (
		controller.domain ||
		controller.t("settings.enterprise.identity.wizard.domain.fallbackName", "your domain")
	);
}

export function getStepCopy(
	step: EnterpriseIdentitySetupStep,
	controller: IdentitySetupController,
) {
	const { t } = controller;
	const provider = providerName(controller);
	const domain = domainName(controller);

	switch (step) {
		case "provider":
			return {
				navLabel: t("settings.enterprise.identity.wizard.provider.nav", "Identity provider"),
				title: t(
					"settings.enterprise.identity.wizard.provider.title",
					"Choose your identity provider",
				),
				description: t(
					"settings.enterprise.identity.wizard.provider.description",
					"Tell Z8 which service your company uses for work accounts and which email domain your employees have.",
				),
			};
		case "sso":
			return {
				navLabel: t("settings.enterprise.identity.wizard.sso.nav", "Connect"),
				title: t("settings.enterprise.identity.wizard.sso.title", "Connect {provider} to Z8", {
					provider,
				}),
				description: t(
					"settings.enterprise.identity.wizard.sso.description",
					"Create an app for Z8 in {provider}, then paste the details it gives you here.",
					{ provider },
				),
			};
		case "domain":
			return {
				navLabel: t("settings.enterprise.identity.wizard.domain.nav", "Verify domain"),
				title: t(
					"settings.enterprise.identity.wizard.domain.title",
					"Verify that you own {domain}",
					{
						domain,
					},
				),
				description: t(
					"settings.enterprise.identity.wizard.domain.description",
					"Add one DNS record to prove that your company controls this domain. Only verified domains can use enterprise sign-in.",
				),
			};
		case "ssoTest":
			return {
				navLabel: t("settings.enterprise.identity.wizard.ssoTest.nav", "Test sign-in"),
				title: t(
					"settings.enterprise.identity.wizard.ssoTest.title",
					"Test sign-in with a real account",
				),
				description: t(
					"settings.enterprise.identity.wizard.ssoTest.description",
					"Before you turn anything on, confirm that an employee can actually sign in through {provider}.",
					{ provider },
				),
			};
		case "scim":
			return {
				navLabel: t("settings.enterprise.identity.wizard.scim.nav", "Sync users"),
				title: t("settings.enterprise.identity.wizard.scim.title", "Sync users automatically"),
				description: t(
					"settings.enterprise.identity.wizard.scim.description",
					"Let {provider} create, update and deactivate Z8 accounts for you using SCIM. You can skip this and set it up later.",
					{ provider },
				),
			};
		case "accessPolicy":
			return {
				navLabel: t("settings.enterprise.identity.wizard.accessPolicy.nav", "Access rules"),
				title: t("settings.enterprise.identity.wizard.accessPolicy.title", "Choose access rules"),
				description: t(
					"settings.enterprise.identity.wizard.accessPolicy.description",
					"Decide how strictly enterprise sign-in is enforced. Nothing changes for employees until you activate the setup in the last step.",
				),
			};
		case "review":
			return {
				navLabel: t("settings.enterprise.identity.wizard.review.nav", "Activate"),
				title: t("settings.enterprise.identity.wizard.review.title", "Review and activate"),
				description: t(
					"settings.enterprise.identity.wizard.review.description",
					"Check your setup, then turn enterprise sign-in on.",
				),
			};
	}
}
