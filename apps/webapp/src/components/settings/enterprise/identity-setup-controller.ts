"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	activateEnterpriseIdentitySetupAction,
	type EnterpriseIdentitySetupResponse,
	recordEnterpriseIdentitySsoTestAction,
	refreshEnterpriseIdentityDomainStatusAction,
	registerEnterpriseIdentitySSOProviderAction,
	requestSSODomainVerificationAction,
	type SSOProviderResponse,
	updateEnterpriseIdentityAccessPolicyAction,
	updateEnterpriseIdentityProviderAction,
	verifySSODomainAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import { actionData, enterpriseErrorMessage } from "@/components/settings/enterprise/action-data";
import { useServerDataState } from "@/hooks/use-server-data-state";
import { AUTH_SSO_DOMAIN_VERIFICATION } from "@/lib/auth/auth-schema-options";
import {
	ENTERPRISE_IDENTITY_PROVIDER_PRESETS,
	type EnterpriseIdentityProtocol,
	type EnterpriseIdentityProviderPresetId,
} from "@/lib/enterprise-identity/provider-presets";
import {
	type EnterpriseIdentitySetupState,
	type EnterpriseIdentitySetupStep,
	getEnterpriseIdentityReadiness,
} from "@/lib/enterprise-identity/setup-state";

export type Translate = (
	key: string,
	fallback: string,
	params?: Record<string, string | number>,
) => string;

export interface IdentitySetupWizardProps {
	callbackBaseUrl: string;
	initialSetup: EnterpriseIdentitySetupResponse;
	organizationId: string;
	/** The organization's registered SSO providers, for the DNS record and connection state. */
	ssoProviders?: SSOProviderResponse[];
}

/**
 * The order an administrator works through. The provider must exist before Z8 can
 * issue a DNS record, and sign-in can only be tested once the domain is verified,
 * so this differs from the order of the stored `currentStep` values.
 */
export const WIZARD_STEPS: readonly {
	id: EnterpriseIdentitySetupStep;
	optional?: true;
}[] = [
	{ id: "provider" },
	{ id: "sso" },
	{ id: "domain" },
	{ id: "ssoTest" },
	{ id: "scim", optional: true },
	{ id: "accessPolicy", optional: true },
	{ id: "review" },
];

export const REQUIRED_STEP_COUNT = WIZARD_STEPS.filter((step) => !step.optional).length;

/** The order the server advances `currentStep` in; used to tell which saves have happened. */
const STORED_STEP_ORDER: EnterpriseIdentitySetupStep[] = [
	"provider",
	"domain",
	"sso",
	"ssoTest",
	"scim",
	"accessPolicy",
	"review",
];

function storedStepReached(setup: EnterpriseIdentitySetupState, step: EnterpriseIdentitySetupStep) {
	return STORED_STEP_ORDER.indexOf(setup.currentStep) >= STORED_STEP_ORDER.indexOf(step);
}

export function selectedPreset(id: EnterpriseIdentityProviderPresetId) {
	return ENTERPRISE_IDENTITY_PROVIDER_PRESETS[id] ?? ENTERPRISE_IDENTITY_PROVIDER_PRESETS.generic;
}

/** The TXT record host Better Auth looks up for this provider, without the domain. */
export function dnsRecordHost(providerId: string) {
	return `_${AUTH_SSO_DOMAIN_VERIFICATION.tokenPrefix}-${providerId}`;
}

export function getStepCompletion(
	setup: EnterpriseIdentitySetupState,
	ssoRegistered: boolean,
): Record<EnterpriseIdentitySetupStep, boolean> {
	const activated = Boolean(setup.activatedAt);
	const readiness = getEnterpriseIdentityReadiness(setup);
	return {
		provider: Boolean(setup.provider?.providerId && setup.domain?.domain),
		sso: ssoRegistered,
		domain: Boolean(setup.domain?.verified),
		ssoTest: !readiness.missing.includes("ssoTest"),
		scim: Boolean(setup.scim.connection),
		accessPolicy: activated || setup.currentStep === "review",
		review: activated,
	};
}

function firstOpenStep(completion: Record<EnterpriseIdentitySetupStep, boolean>) {
	return WIZARD_STEPS.find((step) => !step.optional && !completion[step.id])?.id ?? "review";
}

export function useIdentitySetupController({
	callbackBaseUrl,
	initialSetup,
	organizationId,
	ssoProviders = [],
}: IdentitySetupWizardProps) {
	const { t } = useTranslate();
	const [setup, setSetup] = useServerDataState(initialSetup.state);
	const [defaultRoleTemplateId, setDefaultRoleTemplateId] = useState(
		initialSetup.defaultRoleTemplateId ?? "none",
	);
	const [testEmail, setTestEmail] = useState(initialSetup.state.ssoTest.testEmail ?? "");
	const [testError, setTestError] = useState(initialSetup.state.ssoTest.error ?? "");
	const [isPending, startTransition] = useTransition();

	const presetId = setup.provider?.preset ?? "generic";
	const preset = selectedPreset(presetId);
	const providerId = setup.provider?.providerId ?? "";
	const protocol = setup.provider?.protocol ?? preset.defaultProtocol;
	const domain = setup.domain?.domain ?? "";
	const registeredProvider = ssoProviders.find(
		(provider) =>
			provider.providerId === providerId && provider.domain.toLowerCase() === domain.toLowerCase(),
	);
	const ssoRegistered = Boolean(
		providerId &&
		domain &&
		(registeredProvider || storedStepReached(setup, "ssoTest") || setup.activatedAt),
	);
	const completion = getStepCompletion(setup, ssoRegistered);
	const readiness = getEnterpriseIdentityReadiness(setup);
	const requiredDone = WIZARD_STEPS.filter((step) => !step.optional && completion[step.id]).length;

	const [activeStep, setActiveStep] = useState<EnterpriseIdentitySetupStep>(() =>
		setup.activatedAt ? "review" : firstOpenStep(completion),
	);
	const [focusRequest, setFocusRequest] = useState(0);
	const goTo = (step: EnterpriseIdentitySetupStep) => {
		setActiveStep(step);
		setFocusRequest((count) => count + 1);
	};
	const activeIndex = WIZARD_STEPS.findIndex((step) => step.id === activeStep);
	const previousStep = WIZARD_STEPS[activeIndex - 1]?.id ?? null;
	const nextStep = WIZARD_STEPS[activeIndex + 1]?.id ?? null;

	const [dnsToken, setDnsToken] = useState<string | null>(
		registeredProvider?.domainVerificationToken ?? null,
	);

	const providerForm = useForm({
		defaultValues: {
			preset: presetId,
			protocol,
			providerId,
			domain,
		},
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				try {
					const next = await actionData(
						updateEnterpriseIdentityProviderAction({
							preset: value.preset as EnterpriseIdentityProviderPresetId,
							protocol: value.protocol as EnterpriseIdentityProtocol,
							providerId: value.providerId.trim(),
							domain: value.domain.trim().toLowerCase(),
							currentStep: "sso",
						}),
					);
					setSetup(next.state);
					toast.success(
						t("settings.enterprise.identity.toast.providerSaved", "Identity provider saved"),
					);
					goTo("sso");
				} catch (error) {
					toast.error(
						enterpriseErrorMessage(t, error, [
							"settings.enterprise.identity.toast.providerSaveFailed",
							"Failed to save provider",
						]),
					);
				}
			});
		},
	});

	const ssoForm = useForm({
		defaultValues: {
			tenantId: "",
			issuer: "",
			clientId: "",
			clientSecret: "",
			metadata: "",
		},
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				if (!providerId || !domain) {
					toast.error(
						t(
							"settings.enterprise.identity.sso.error.saveProviderFirst",
							"Save provider and domain before registering SSO",
						),
					);
					return;
				}

				try {
					const next = await actionData(
						registerEnterpriseIdentitySSOProviderAction(
							protocol === "oidc"
								? {
										protocol: "oidc",
										providerId,
										issuer: value.issuer,
										domain,
										clientId: value.clientId,
										clientSecret: value.clientSecret,
										scopes: preset.defaultOidcScopes,
									}
								: {
										protocol: "saml",
										providerId,
										issuer: value.issuer,
										domain,
										metadata: value.metadata,
									},
						),
					);
					setSetup(next.state);
					toast.success(
						t("settings.enterprise.identity.toast.ssoRegistered", "SSO provider registered"),
					);
					goTo("domain");
				} catch (error) {
					toast.error(
						enterpriseErrorMessage(t, error, [
							"settings.enterprise.identity.toast.ssoRegisterFailed",
							"Failed to register SSO provider",
						]),
					);
				}
			});
		},
	});

	const recordSsoTest = (status: "passed" | "failed") => {
		startTransition(async () => {
			if (!providerId) {
				toast.error(
					t(
						"settings.enterprise.identity.ssoTest.error.saveProviderFirst",
						"Save provider before recording a test",
					),
				);
				return;
			}

			try {
				const next = await actionData(
					recordEnterpriseIdentitySsoTestAction({
						providerId,
						testEmail,
						status,
						error:
							status === "failed"
								? testError ||
									t("settings.enterprise.identity.ssoTest.defaultFailure", "Live SSO test failed")
								: null,
					}),
				);
				setSetup(next.state);
				if (status === "passed") {
					toast.success(
						t("settings.enterprise.identity.toast.ssoTestPassed", "SSO test marked passed"),
					);
					goTo("scim");
				} else {
					toast.success(
						t("settings.enterprise.identity.toast.ssoTestFailed", "SSO test marked failed"),
					);
				}
			} catch (error) {
				toast.error(
					enterpriseErrorMessage(t, error, [
						"settings.enterprise.identity.toast.ssoTestRecordFailed",
						"Failed to record SSO test",
					]),
				);
			}
		});
	};

	const generateDnsRecord = () => {
		startTransition(async () => {
			try {
				const result = await actionData(requestSSODomainVerificationAction({ providerId }));
				if (!result.domainVerificationToken) throw new Error("missing token");
				setDnsToken(result.domainVerificationToken);
			} catch (error) {
				toast.error(
					enterpriseErrorMessage(t, error, [
						"settings.enterprise.sso.tokenError",
						"Failed to generate domain verification token",
					]),
				);
			}
		});
	};

	/**
	 * Asks Z8 to look up the TXT record, then syncs the setup with the result. The
	 * lookup also fails when the domain was already verified elsewhere, so the
	 * synced status decides what the administrator is told.
	 */
	const verifyDomain = () => {
		startTransition(async () => {
			try {
				if (providerId) {
					await actionData(verifySSODomainAction({ providerId })).catch(() => null);
				}
				const next = await actionData(refreshEnterpriseIdentityDomainStatusAction());
				setSetup(next.state);
				if (next.state.domain?.verified) {
					toast.success(
						t("settings.enterprise.identity.wizard.domain.toast.verified", "Domain verified"),
					);
					goTo("ssoTest");
				} else {
					toast.error(
						t(
							"settings.enterprise.identity.wizard.domain.toast.notFound",
							"Z8 couldn't find the DNS record yet. Check the name and value, then try again in a few minutes.",
						),
					);
				}
			} catch (error) {
				toast.error(
					enterpriseErrorMessage(t, error, [
						"settings.enterprise.identity.toast.domainStatusFailed",
						"Failed to refresh domain status",
					]),
				);
			}
		});
	};

	const saveAccessPolicy = () => {
		startTransition(async () => {
			try {
				const next = await actionData(
					updateEnterpriseIdentityAccessPolicyAction({
						ssoRequired: setup.enforcement.ssoRequired,
						domainRestrictionEnabled: setup.enforcement.domainRestrictionEnabled,
						inviteRestrictionEnabled: setup.enforcement.inviteRestrictionEnabled,
						defaultRoleTemplateId: defaultRoleTemplateId === "none" ? null : defaultRoleTemplateId,
					}),
				);
				setSetup(next.state);
				setDefaultRoleTemplateId(next.defaultRoleTemplateId ?? "none");
				toast.success(
					t("settings.enterprise.identity.toast.accessPolicySaved", "Access policy saved"),
				);
				goTo("review");
			} catch (error) {
				toast.error(
					enterpriseErrorMessage(t, error, [
						"settings.enterprise.identity.toast.accessPolicyFailed",
						"Failed to save access policy",
					]),
				);
			}
		});
	};

	const activateSetup = () => {
		startTransition(async () => {
			try {
				const next = await actionData(activateEnterpriseIdentitySetupAction());
				setSetup(next.state);
				toast.success(
					t("settings.enterprise.identity.toast.activated", "Enterprise identity setup activated"),
				);
			} catch (error) {
				toast.error(
					enterpriseErrorMessage(t, error, [
						"settings.enterprise.identity.toast.activateFailed",
						"Failed to activate setup",
					]),
				);
			}
		});
	};

	const updateEnforcement = (
		key: keyof EnterpriseIdentitySetupState["enforcement"],
		value: boolean,
	) => {
		setSetup((current) => ({
			...current,
			enforcement: { ...current.enforcement, [key]: value },
		}));
	};

	return {
		activateSetup,
		activeIndex,
		activeStep,
		callbackBaseUrl,
		completion,
		defaultRoleTemplateId,
		dnsToken,
		domain,
		focusRequest,
		generateDnsRecord,
		goTo,
		initialSetup,
		isPending,
		nextStep,
		organizationId,
		preset,
		presetId,
		previousStep,
		protocol,
		providerForm,
		providerId,
		readiness,
		recordSsoTest,
		requiredDone,
		saveAccessPolicy,
		setDefaultRoleTemplateId,
		setTestEmail,
		setTestError,
		setup,
		ssoForm,
		ssoRegistered,
		t: t as Translate,
		testEmail,
		testError,
		updateEnforcement,
		verifyDomain,
	};
}

export type IdentitySetupController = ReturnType<typeof useIdentitySetupController>;
