"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useReducer } from "react";
import { z } from "zod";
import {
	getPostSignInRedirectUrl,
	sanitizeCallbackUrl,
	withCallbackUrl,
} from "@/lib/auth/callback-url";
import { useDomainAuth, useTurnstile } from "@/lib/auth/domain-auth-context";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { authClient } from "@/lib/auth-client";
import { useEnabledProviders } from "@/lib/hooks/use-enabled-providers";
import type { SocialProviderId } from "@/lib/social-providers";
import { verifyTurnstileWithServer } from "@/lib/turnstile/verify";
import { getOnboardingStepPath } from "@/lib/validations/onboarding";
import { useRouter } from "@/navigation";
import { initialLoginState, loginReducer, loginSchema } from "./login-state";

export function useLoginAuth(turnstileRef: React.RefObject<{ reset: () => void } | null>) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const searchParams = useSearchParams();
	const callbackUrl = sanitizeCallbackUrl(
		searchParams.get("callbackUrl"),
		"/init",
		typeof window === "undefined" ? undefined : window.location.href,
	);
	const postSignInRedirectUrl = getPostSignInRedirectUrl(callbackUrl);
	const [state, dispatch] = useReducer(loginReducer, initialLoginState);
	const { enabledProviders, isLoading: providersLoading } = useEnabledProviders();
	const domainAuth = useDomainAuth();
	const authConfig = domainAuth?.authConfig;
	const branding = domainAuth?.branding;
	const socialOAuthConfigured = domainAuth?.socialOAuthConfigured;
	const ssoProviderId = authConfig?.ssoProviderId;
	const turnstileConfig = useTurnstile();

	const showEmailPassword = authConfig?.emailPasswordEnabled ?? true;
	const showPasskey = authConfig?.passkeyEnabled ?? true;
	const showSSO = authConfig?.ssoEnabled ?? false;
	const allowedSocialProviders = authConfig?.socialProvidersEnabled ?? [];
	const allowedSocialProviderSet =
		allowedSocialProviders.length > 0 ? new Set(allowedSocialProviders) : null;
	const filteredProviders = allowedSocialProviderSet
		? enabledProviders.filter((provider) => allowedSocialProviderSet.has(provider.id))
		: enabledProviders;

	useEffect(() => {
		dispatch({ type: "RESET_LOADING" });
	}, []);

	const resetTurnstile = () => {
		dispatch({ type: "SET_TURNSTILE_TOKEN", token: null });
		turnstileRef.current?.reset();
	};

	const resolvePostSignInRedirect = async () => {
		try {
			const userResponse = await fetch("/api/user/onboarding-status");
			if (userResponse.ok) {
				const { onboardingComplete, onboardingStep } = await userResponse.json();
				if (!onboardingComplete) {
					push(getOnboardingStepPath(onboardingStep));
					return;
				}
			}
		} catch (fetchError) {
			console.error("Error checking onboarding status:", fetchError);
		}

		push(postSignInRedirectUrl);
	};

	const handleEmailBlur = (value: string) => {
		const result = z.email().safeParse(value);
		if (result.success) {
			dispatch({ type: "CLEAR_FIELD_ERROR", field: "email" });
		} else {
			dispatch({
				type: "SET_FIELD_ERROR",
				field: "email",
				error: t("validation.invalid-email", "Invalid email address"),
			});
		}
	};

	const handlePasswordBlur = (value: string) => {
		if (value.length === 0) {
			dispatch({
				type: "SET_FIELD_ERROR",
				field: "password",
				error: t("validation.password-required", "Password is required"),
			});
		} else {
			dispatch({ type: "CLEAR_FIELD_ERROR", field: "password" });
		}
	};

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		dispatch({ type: "SET_LOADING", loading: true });
		dispatch({ type: "SET_ERROR", error: null });

		const result = loginSchema.safeParse({ email: state.email, password: state.password });
		if (!result.success) {
			const errors: Record<string, string> = {};
			for (const issue of result.error.issues) {
				if (issue.path[0]) errors[issue.path[0] as string] = issue.message;
			}
			dispatch({ type: "SET_FIELD_ERRORS", errors });
			dispatch({ type: "SET_LOADING", loading: false });
			return;
		}

		if (turnstileConfig?.enabled && !state.turnstileToken) {
			dispatch({
				type: "SET_ERROR",
				error: t("auth.turnstile-required", "Please complete the verification."),
			});
			dispatch({ type: "SET_LOADING", loading: false });
			return;
		}

		try {
			if (turnstileConfig?.enabled && state.turnstileToken) {
				const verifyResult = await verifyTurnstileWithServer(state.turnstileToken);
				if (!verifyResult.success) {
					dispatch({
						type: "SET_ERROR",
						error: verifyResult.error || t("auth.turnstile-failed", "Verification failed."),
					});
					resetTurnstile();
					dispatch({ type: "SET_LOADING", loading: false });
					return;
				}
			}

			const signInResult = await authClient.signIn.email(
				{ email: state.email, password: state.password },
				{
					onError: (ctx) => {
						dispatch({ type: "SET_LOADING", loading: false });
						if (ctx.error.status === 403) {
							dispatch({
								type: "SET_ERROR",
								error: t(
									"auth.email-not-verified",
									"Please verify your email address before signing in. Check your inbox for the verification link.",
								),
							});
							setTimeout(() => {
								push(
									withCallbackUrl(
										`/verify-email-pending?email=${encodeURIComponent(state.email)}`,
										callbackUrl,
									),
								);
							}, 3000);
						} else {
							dispatch({
								type: "SET_ERROR",
								error: ctx.error.message || t("auth.login-failed", "Failed to sign in"),
							});
						}
					},
				},
			);

			if (signInResult.error) {
				dispatch({ type: "SET_LOADING", loading: false });
				if (signInResult.error.status !== 403) {
					dispatch({
						type: "SET_ERROR",
						error: signInResult.error.message || t("auth.login-failed", "Failed to sign in"),
					});
				}
				if (turnstileConfig?.enabled) resetTurnstile();
				return;
			}

			if ((signInResult.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
				dispatch({ type: "SET_REQUIRES_2FA", requires2FA: true });
				return;
			}

			await resolvePostSignInRedirect();
		} catch (error) {
			dispatch({ type: "SET_LOADING", loading: false });
			dispatch({
				type: "SET_ERROR",
				error:
				error instanceof Error
					? error.message
					: t("auth.login-error", "An error occurred during sign in"),
			});
			if (turnstileConfig?.enabled) resetTurnstile();
		}
	};

	const handleSocialLogin = async (provider: SocialProviderId) => {
		dispatch({ type: "SET_LOADING", loading: true });
		dispatch({ type: "SET_ERROR", error: null });
		try {
			if (socialOAuthConfigured?.[provider]) {
				window.location.assign(
					`/api/auth/social-org/${provider}?callbackURL=${encodeURIComponent(postSignInRedirectUrl)}`,
				);
			} else {
				await authClient.signIn.social({ provider, callbackURL: postSignInRedirectUrl });
			}
		} catch (error) {
			dispatch({ type: "SET_LOADING", loading: false });
			dispatch({
				type: "SET_ERROR",
				error:
					error instanceof Error
						? error.message
						: t("auth.social-login-error", "An error occurred during social sign-in"),
			});
		}
	};

	const handlePasskeyLogin = async () => {
		dispatch({ type: "SET_LOADING", loading: true });
		try {
			const result = await authClient.signIn.passkey({ autoFill: false });
			if (result.error) {
				dispatch({
					type: "SET_ERROR",
					error: getAuthErrorMessage(
						result.error,
						t("auth.passkey-login-failed", "Failed to sign in with passkey"),
					),
				});
				dispatch({ type: "SET_LOADING", loading: false });
				return;
			}
			await resolvePostSignInRedirect();
		} catch {
			dispatch({
				type: "SET_ERROR",
				error: t("auth.passkey-login-failed", "Failed to sign in with passkey"),
			});
			dispatch({ type: "SET_LOADING", loading: false });
		}
	};

	const handleSSOLogin = async () => {
		if (!ssoProviderId) {
			dispatch({
				type: "SET_ERROR",
				error: t("auth.sso-not-configured", "SSO is not configured for this domain"),
			});
			return;
		}
		dispatch({ type: "SET_LOADING", loading: true });
		dispatch({ type: "SET_ERROR", error: null });
		try {
			await authClient.signIn.sso({ providerId: ssoProviderId, callbackURL: postSignInRedirectUrl });
		} catch (error) {
			dispatch({ type: "SET_LOADING", loading: false });
			dispatch({
				type: "SET_ERROR",
				error:
					error instanceof Error
						? error.message
						: t("auth.sso-login-error", "An error occurred during SSO sign-in"),
			});
		}
	};

	const handleVerify2FA = async () => {
		if (state.otpValue.length !== 6) {
			dispatch({
				type: "SET_ERROR",
				error: t("auth.invalid-2fa-code", "Please enter a valid 6-digit code"),
			});
			return;
		}
		dispatch({ type: "SET_LOADING", loading: true });
		dispatch({ type: "SET_ERROR", error: null });
		try {
			const result = await authClient.twoFactor.verifyTotp({
				code: state.otpValue,
				trustDevice: state.trustDevice,
			});
			if (result.error) {
				dispatch({
					type: "SET_ERROR",
					error: result.error.message || t("auth.2fa-verification-failed", "2FA verification failed"),
				});
				dispatch({ type: "SET_LOADING", loading: false });
				return;
			}
			await resolvePostSignInRedirect();
		} catch (error) {
			dispatch({
				type: "SET_ERROR",
				error:
					error instanceof Error
						? error.message
						: t("auth.2fa-verification-error", "An error occurred during 2FA verification"),
			});
			dispatch({ type: "SET_LOADING", loading: false });
		}
	};

	return {
		...state,
		branding,
		callbackUrl,
		filteredProviders,
		handleEmailBlur,
		handleEmailChange: (value: string) => dispatch({ type: "SET_FIELD", field: "email", value }),
		handlePasskeyLogin,
		handlePasswordBlur,
		handlePasswordChange: (value: string) => dispatch({ type: "SET_FIELD", field: "password", value }),
		handleSocialLogin,
		handleSSOLogin,
		handleSubmit,
		handleTurnstileError: resetTurnstile,
		handleTurnstileExpire: resetTurnstile,
		handleTurnstileTimeout: resetTurnstile,
		handleTurnstileVerify: (token: string) => dispatch({ type: "SET_TURNSTILE_TOKEN", token }),
		handleVerify2FA,
		providersLoading,
		setOtpValue: (value: string) => dispatch({ type: "SET_OTP", value }),
		setTrustDevice: (trustDevice: boolean) => dispatch({ type: "SET_TRUST_DEVICE", trustDevice }),
		showEmailPassword,
		showPasskey,
		showSSO,
		turnstileConfig,
	};
}
