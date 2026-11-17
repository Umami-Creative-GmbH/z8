"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import {
	getPostSignInRedirectUrl,
	sanitizeCallbackUrl,
	withCallbackUrl,
} from "@/lib/auth/callback-url";
import { useDomainAuth } from "@/lib/auth/domain-auth-context";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { loadAuthPageClient } from "@/lib/auth/load-auth-page-client";
import { useEnabledProviders } from "@/lib/hooks/use-enabled-providers";
import type { SocialProviderId } from "@/lib/social-providers";
import { getOnboardingStepPath } from "@/lib/validations/onboarding-steps";
import { useRouter } from "@/navigation";
import { validateLoginCredentials } from "./login-state";

export function useLoginArrival() {
	const domain = useDomainAuth();
	const search = useSearchParams();
	const callbackUrl = sanitizeCallbackUrl(
		search.get("callbackUrl"),
		"/init",
		typeof window === "undefined" ? undefined : window.location.href,
	);
	return { domain, callbackUrl, scope: JSON.stringify([domain, callbackUrl]) };
}

type Method = "email" | "passkey" | "sso" | SocialProviderId | "two-factor";
export type VerificationState = "waiting" | "ready" | "error" | "expired" | "timeout";

type LoginUiState = {
	error: string | null;
	pendingMethod: Method | null;
	requires2FA: boolean;
	turnstileToken: string | null;
	verificationState: VerificationState;
	verificationNonce: number;
};
const initialUi: LoginUiState = {
	error: null,
	pendingMethod: null,
	requires2FA: false,
	turnstileToken: null,
	verificationState: "waiting",
	verificationNonce: 0,
};
function loginUiReducer(
	state: LoginUiState,
	action: Partial<LoginUiState> | "resume" | "retry",
): LoginUiState {
	if (action === "resume")
		return {
			...initialUi,
			pendingMethod: state.pendingMethod,
			verificationNonce: state.verificationNonce + 1,
		};
	if (action === "retry") return { ...state, verificationNonce: state.verificationNonce + 1 };
	return { ...state, ...action };
}

export function useLoginAuth(
	turnstileRef: React.RefObject<{ reset: () => void } | null>,
	{ domain, callbackUrl, scope }: ReturnType<typeof useLoginArrival>,
) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const {
		enabledProviders,
		isLoading: providersLoading,
		error: providersError,
	} = useEnabledProviders();
	const [ui, updateUi] = useReducer(loginUiReducer, initialUi);
	const {
		error,
		pendingMethod,
		requires2FA,
		turnstileToken,
		verificationState,
		verificationNonce,
	} = ui;
	const setError = (value: string | null) => updateUi({ error: value });
	const setPendingMethod = (value: Method | null) => updateUi({ pendingMethod: value });
	const setRequires2FA = (value: boolean) => updateUi({ requires2FA: value });
	const setTurnstileToken = (value: string | null) => updateUi({ turnstileToken: value });
	const setVerificationState = (value: VerificationState) => updateUi({ verificationState: value });
	const lifetime = useRef({
		active: false,
		epoch: 0,
		pendingEpoch: null as number | null,
		token: null as string | null,
	});
	const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const authConfig = domain?.authConfig;
	const turnstileConfig = domain?.turnstile ?? null;
	const postSignInRedirectUrl = getPostSignInRedirectUrl(callbackUrl);
	const showEmailPassword = authConfig?.emailPasswordEnabled ?? true;
	const showPasskey = authConfig?.passkeyEnabled ?? true;
	const showSSO = authConfig?.ssoEnabled ?? false;
	const allowed = authConfig?.socialProvidersEnabled ?? [];
	const allowedProviders = new Set(allowed);
	const filteredProviders = allowed.length
		? enabledProviders.filter((provider) => allowedProviders.has(provider.id))
		: enabledProviders;

	useEffect(() => {
		const owner = lifetime.current;
		owner.active = true;
		owner.epoch++;
		owner.token = null;
		updateUi("resume");
		loadAuthPageClient().catch(() => {});
		return () => {
			owner.active = false;
			owner.epoch++;
			owner.token = null;
			if (redirectTimer.current) clearTimeout(redirectTimer.current);
		};
	}, []);

	const isCurrent = (epoch: number) => lifetime.current.active && lifetime.current.epoch === epoch;
	const retire = () => {
		lifetime.current.epoch++;
		if (redirectTimer.current) clearTimeout(redirectTimer.current);
		if (lifetime.current.pendingEpoch === null) setPendingMethod(null);
		setError(null);
	};
	const begin = (method: Method) => {
		if (
			!lifetime.current.active ||
			lifetime.current.pendingEpoch !== null ||
			form.state.isSubmitting
		)
			return null;
		retire();
		lifetime.current.pendingEpoch = lifetime.current.epoch;
		setPendingMethod(method);
		return lifetime.current.epoch;
	};
	const finish = (epoch: number) => {
		// Retiring UI effects cannot cancel an authenticator/auth request.
		// Only its matching settlement releases the same-instance reservation.
		if (lifetime.current.pendingEpoch !== epoch) return;
		lifetime.current.pendingEpoch = null;
		setPendingMethod(null);
	};
	const resetVerification = (state: VerificationState = "waiting") => {
		lifetime.current.token = null;
		setTurnstileToken(null);
		setVerificationState(state);
		turnstileRef.current?.reset();
	};
	const resolvePostSignInRedirect = async (epoch: number) => {
		if (!isCurrent(epoch)) return;
		try {
			const response = await fetch("/api/user/onboarding-status");
			if (!isCurrent(epoch)) return;
			if (response.ok) {
				const { onboardingComplete, onboardingStep } = await response.json();
				if (!isCurrent(epoch)) return;
				if (!onboardingComplete) {
					push(getOnboardingStepPath(onboardingStep));
					return;
				}
			}
		} catch {
			// Keep the existing canonical /init fallback when the status read is unavailable.
		}
		if (isCurrent(epoch)) push(postSignInRedirectUrl);
	};
	const submitEmail = async (values: { email: string; password: string }, epoch: number) => {
		if (!showEmailPassword || requires2FA) return;
		if (!isCurrent(epoch)) return;
		let refused = false;
		const refuse = (failure: { status?: number; message?: string }) => {
			if (!isCurrent(epoch) || refused) return;
			refused = true;
			if (failure.status === 403) {
				setError(
					t(
						"auth.email-not-verified",
						"Please verify your email address before signing in. Check your inbox for the verification link.",
					),
				);
				redirectTimer.current = setTimeout(() => {
					if (isCurrent(epoch))
						push(
							withCallbackUrl(
								`/verify-email-pending?email=${encodeURIComponent(values.email)}`,
								callbackUrl,
							),
						);
				}, 3000);
			} else setError(failure.message || t("auth.login-failed", "Failed to sign in"));
		};
		try {
			const client = await loadAuthPageClient();
			if (!isCurrent(epoch)) return;
			// Check the current real-widget token after lazy loading, on this same request.
			const token = lifetime.current.token;
			if (turnstileConfig?.enabled && !token) {
				setError(t("auth.turnstile-required", "Please complete the verification."));
				finish(epoch);
				return;
			}
			lifetime.current.token = null;
			setTurnstileToken(null);
			const result = await client.signIn.email(
				{ email: values.email, password: values.password },
				{
					headers: token ? { "x-captcha-response": token } : undefined,
					onError: (ctx) => refuse(ctx.error),
				},
			);
			if (!isCurrent(epoch)) return;
			if (result.error || refused) {
				if (result.error) refuse(result.error);
				if (turnstileConfig?.enabled) resetVerification();
				finish(epoch);
				return;
			}
			if ((result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
				setRequires2FA(true);
				finish(epoch);
				return;
			}
			await resolvePostSignInRedirect(epoch);
		} catch (failure) {
			if (!isCurrent(epoch)) return;
			setError(
				failure instanceof Error
					? failure.message
					: t("auth.login-error", "An error occurred during sign in"),
			);
			if (turnstileConfig?.enabled) resetVerification();
			finish(epoch);
		}
	};
	const handleVerify2FA = async (
		values: { otpValue: string; trustDevice: boolean },
		epoch: number,
	) => {
		if (!requires2FA || values.otpValue.length !== 6) return;
		if (!isCurrent(epoch)) return;
		try {
			const client = await loadAuthPageClient();
			if (!isCurrent(epoch)) return;
			const result = await client.twoFactor.verifyTotp({
				code: values.otpValue,
				trustDevice: values.trustDevice,
			});
			if (!isCurrent(epoch)) return;
			if (result.error) {
				setError(
					result.error.message || t("auth.2fa-verification-failed", "2FA verification failed"),
				);
				finish(epoch);
				return;
			}
			await resolvePostSignInRedirect(epoch);
		} catch (failure) {
			if (!isCurrent(epoch)) return;
			setError(
				failure instanceof Error
					? failure.message
					: t("auth.2fa-verification-error", "An error occurred during 2FA verification"),
			);
			finish(epoch);
		}
	};
	const form = useForm({
		onSubmitMeta: { epoch: 0 },
		defaultValues: { email: "", password: "", otpValue: "", trustDevice: false },
		validators: {
			onSubmit: ({ value }) => {
				if (requires2FA)
					return value.otpValue.length === 6
						? undefined
						: {
								fields: {
									otpValue: t("auth.invalid-2fa-code", "Please enter a valid 6-digit code"),
								},
							};
				const fields = validateLoginCredentials(value);
				return Object.keys(fields).length ? { fields } : undefined;
			},
		},
		onSubmit: async ({ value, meta }) =>
			requires2FA ? handleVerify2FA(value, meta.epoch) : submitEmail(value, meta.epoch),
	});
	const values = useStore(form.store, (state) => state.values);
	const formSubmitting = useStore(form.store, (state) => state.isSubmitting);
	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const element = event.currentTarget;
		const epoch = begin(requires2FA ? "two-factor" : "email");
		if (epoch === null) return;
		await form.handleSubmit({ epoch }).finally(() => finish(epoch));
		if (!form.state.isValid) {
			finish(epoch);
			// Focus after React commits the enabled controls, and only for this arrival.
			requestAnimationFrame(() => {
				if (isCurrent(epoch)) element.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
			});
		}
	};
	const handleMethod = async (method: Exclude<Method, "email" | "two-factor">) => {
		if (
			requires2FA ||
			(method === "passkey" && !showPasskey) ||
			(method === "sso" && !showSSO) ||
			(method !== "passkey" &&
				method !== "sso" &&
				(providersLoading || !filteredProviders.some((provider) => provider.id === method)))
		)
			return;
		if (method === "sso" && !authConfig?.ssoProviderId) {
			setError(t("auth.sso-not-configured", "SSO is not configured for this domain"));
			return;
		}
		const epoch = begin(method);
		if (epoch === null) return;
		const fallback =
			method === "passkey"
				? t("auth.passkey-login-failed", "Failed to sign in with passkey")
				: method === "sso"
					? t("auth.sso-login-error", "An error occurred during SSO sign-in")
					: t("auth.social-login-error", "An error occurred during social sign-in");
		const execute = async () => {
			try {
				if (method !== "passkey" && method !== "sso" && domain?.socialOAuthConfigured?.[method]) {
					window.location.assign(
						`/api/auth/social-org/${method}?callbackURL=${encodeURIComponent(postSignInRedirectUrl)}`,
					);
					return;
				}
				const client = await loadAuthPageClient();
				if (!isCurrent(epoch)) return;
				const result =
					method === "passkey"
						? await client.signIn.passkey({ autoFill: false })
						: method === "sso"
							? await client.signIn.sso({
									providerId: authConfig?.ssoProviderId,
									callbackURL: postSignInRedirectUrl,
								})
							: await client.signIn.social({
									provider: method,
									callbackURL: postSignInRedirectUrl,
								});
				if (!isCurrent(epoch)) return;
				if (result?.error) {
					setError(getAuthErrorMessage(result.error, fallback));
					finish(epoch);
					return;
				}
				if (method === "passkey") await resolvePostSignInRedirect(epoch);
			} catch (failure) {
				if (!isCurrent(epoch)) return;
				setError(
					method === "passkey" ? fallback : failure instanceof Error ? failure.message : fallback,
				);
				finish(epoch);
			}
		};
		return execute().finally(() => finish(epoch));
	};
	return {
		form,
		...values,
		error,
		pendingMethod,
		isLoading: pendingMethod !== null || formSubmitting,
		requires2FA,
		branding: domain?.branding,
		callbackUrl,
		scope,
		filteredProviders,
		providersLoading,
		providersError,
		showEmailPassword,
		showPasskey,
		showSSO,
		turnstileConfig,
		turnstileToken,
		verificationState,
		verificationNonce,
		handleSubmit,
		handleFieldChange: retire,
		handlePasskeyLogin: () => handleMethod("passkey"),
		handleSSOLogin: () => handleMethod("sso"),
		handleSocialLogin: (provider: SocialProviderId) => handleMethod(provider),
		setOtpValue: (value: string) => {
			retire();
			form.setFieldValue("otpValue", value);
		},
		setTrustDevice: (value: boolean) => {
			retire();
			form.setFieldValue("trustDevice", value);
		},
		handleTurnstileError: () => resetVerification("error"),
		handleTurnstileExpire: () => resetVerification("expired"),
		handleTurnstileTimeout: () => resetVerification("timeout"),
		handleTurnstileVerify: (token: string) => {
			if (!lifetime.current.active) return;
			lifetime.current.token = token;
			setTurnstileToken(token);
			setVerificationState("ready");
		},
		retryVerification: () => {
			if (lifetime.current.pendingEpoch !== null) return;
			resetVerification();
			updateUi("retry");
		},
	};
}

export type LoginFormApi = ReturnType<typeof useLoginAuth>["form"];
