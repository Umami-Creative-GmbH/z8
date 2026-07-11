"use client";

import { IconFingerprint } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useReducer, useRef } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
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
import { AuthFormWrapper } from "./auth-form-wrapper";
import { LoginActions } from "./login/login-actions";
import { LoginAlternativeAuth } from "./login/alternative-auth";
import { LoginCredentialsFields } from "./login/credentials-fields";
import { initialLoginState, loginReducer, loginSchema } from "./login/login-state";
import { TwoFactorForm } from "./login/two-factor-form";
import type { TurnstileRef } from "./turnstile-widget";

function LoginFormContent({ className, ...props }: React.ComponentProps<"div">) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const searchParams = useSearchParams();
	const { get } = searchParams;
	const getSearchParam = (key: string) => get.call(searchParams, key);
	const callbackUrl = sanitizeCallbackUrl(
		getSearchParam("callbackUrl"),
		"/init",
		typeof window === "undefined" ? undefined : window.location.href,
	);
	const postSignInRedirectUrl = getPostSignInRedirectUrl(callbackUrl);
	const [state, dispatch] = useReducer(loginReducer, initialLoginState);
	const { enabledProviders, isLoading: providersLoading } = useEnabledProviders();

	// Destructure for easier access
	const {
		email,
		password,
		fieldErrors,
		error,
		isLoading,
		requires2FA,
		otpValue,
		trustDevice,
		turnstileToken,
	} = state;

	// Domain auth context for custom domains
	const domainAuth = useDomainAuth();
	const authConfig = domainAuth?.authConfig;
	const branding = domainAuth?.branding;
	const socialOAuthConfigured = domainAuth?.socialOAuthConfigured;
	const ssoProviderId = authConfig?.ssoProviderId;
	const turnstileConfig = useTurnstile();

	// Turnstile ref for programmatic control
	const turnstileRef = useRef<TurnstileRef>(null);

	// Turnstile handlers
	const handleTurnstileVerify = (token: string) => {
		dispatch({ type: "SET_TURNSTILE_TOKEN", token });
	};

	const handleTurnstileError = () => {
		dispatch({ type: "SET_TURNSTILE_TOKEN", token: null });
		turnstileRef.current?.reset();
	};

	const handleTurnstileExpire = () => {
		dispatch({ type: "SET_TURNSTILE_TOKEN", token: null });
		turnstileRef.current?.reset();
	};

	const handleTurnstileTimeout = () => {
		dispatch({ type: "SET_TURNSTILE_TOKEN", token: null });
		turnstileRef.current?.reset();
	};

	// Determine which auth methods are enabled
	const showEmailPassword = authConfig?.emailPasswordEnabled ?? true;
	const showPasskey = authConfig?.passkeyEnabled ?? true;
	const showSSO = authConfig?.ssoEnabled ?? false;
	const allowedSocialProviders = authConfig?.socialProvidersEnabled ?? [];

	// Filter social providers based on auth config
	const filteredProviders = (() => {
		if (allowedSocialProviders.length === 0) {
			return enabledProviders;
		}

		return enabledProviders.filter((provider) => allowedSocialProviders.includes(provider.id));
	})();

	// Reset loading state when component mounts (e.g., after logout redirect)
	useEffect(() => {
		dispatch({ type: "RESET_LOADING" });
	}, []);

	// Memoized handlers to prevent unnecessary re-renders
	const handleChange = (field: "email" | "password", value: string) => {
		dispatch({ type: "SET_FIELD", field, value });
	};

	const validateEmail = (value: string) => {
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

	const validatePassword = (value: string) => {
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

	const validateField = (field: string, value: string) => {
		switch (field) {
			case "email":
				validateEmail(value);
				break;
			case "password":
				validatePassword(value);
				break;
			default:
				break;
		}
	};

	const handleValidationErrors = (errors: z.ZodError) => {
		const errorMap: Record<string, string> = {};
		for (const err of errors.issues) {
			if (err.path[0]) {
				errorMap[err.path[0] as string] = err.message;
			}
		}
		dispatch({ type: "SET_FIELD_ERRORS", errors: errorMap });
	};

	const handleEmailChange = (value: string) => {
		handleChange("email", value);
	};

	const handlePasswordChange = (value: string) => {
		handleChange("password", value);
	};

	const handleEmailBlur = (value: string) => {
		validateField("email", value);
	};

	const handlePasswordBlur = (value: string) => {
		validateField("password", value);
	};

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		dispatch({ type: "SET_LOADING", loading: true });
		dispatch({ type: "SET_ERROR", error: null });

		const result = loginSchema.safeParse({ email, password });

		if (!result.success) {
			handleValidationErrors(result.error);
			dispatch({ type: "SET_LOADING", loading: false });
			return;
		}

		// Verify Turnstile if enabled
		if (turnstileConfig?.enabled && !turnstileToken) {
			dispatch({
				type: "SET_ERROR",
				error: t("auth.turnstile-required", "Please complete the verification."),
			});
			dispatch({ type: "SET_LOADING", loading: false });
			return;
		}

		try {
			// Verify Turnstile token server-side if enabled
			if (turnstileConfig?.enabled && turnstileToken) {
				const verifyResult = await verifyTurnstileWithServer(turnstileToken);
				if (!verifyResult.success) {
					dispatch({
						type: "SET_ERROR",
						error: verifyResult.error || t("auth.turnstile-failed", "Verification failed."),
					});
					dispatch({ type: "SET_TURNSTILE_TOKEN", token: null });
					turnstileRef.current?.reset();
					dispatch({ type: "SET_LOADING", loading: false });
					return;
				}
			}

			const signInResult = await authClient.signIn.email(
				{
					email,
					password,
				},
				{
					onError: (ctx) => {
						dispatch({ type: "SET_LOADING", loading: false });
						if (ctx.error.status === 403) {
							// Email not verified
							dispatch({
								type: "SET_ERROR",
								error: t(
									"auth.email-not-verified",
									"Please verify your email address before signing in. Check your inbox for the verification link.",
								),
							});
							// Optionally redirect to verification pending page
							setTimeout(() => {
								push(
									withCallbackUrl(
										`/verify-email-pending?email=${encodeURIComponent(email)}`,
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
				// Error already handled in onError callback
				if (signInResult.error.status !== 403) {
					dispatch({
						type: "SET_ERROR",
						error: signInResult.error.message || t("auth.login-failed", "Failed to sign in"),
					});
				}
				// Reset Turnstile for retry (tokens are single-use)
				if (turnstileConfig?.enabled) {
					dispatch({ type: "SET_TURNSTILE_TOKEN", token: null });
					turnstileRef.current?.reset();
				}
			} else {
				// Check if 2FA is required
				if ((signInResult.data as any)?.twoFactorRedirect) {
					dispatch({ type: "SET_REQUIRES_2FA", requires2FA: true });
					return;
				}

				// Check onboarding status first
				try {
					const userResponse = await fetch("/api/user/onboarding-status");
					if (userResponse.ok) {
						const { onboardingComplete, onboardingStep } = await userResponse.json();

						if (!onboardingComplete) {
							// Resume onboarding from last step
							push(getOnboardingStepPath(onboardingStep));
							return;
						}
					}
				} catch (fetchError) {
					console.error("Error checking onboarding status:", fetchError);
					// Continue to dashboard if check fails
				}

				// Onboarding complete, continue where the user intended to go
				push(postSignInRedirectUrl);
			}
		} catch (err) {
			dispatch({ type: "SET_LOADING", loading: false });
			dispatch({
				type: "SET_ERROR",
				error:
					err instanceof Error
						? err.message
						: t("auth.login-error", "An error occurred during sign in"),
			});
			// Reset Turnstile for retry (tokens are single-use)
			if (turnstileConfig?.enabled) {
				dispatch({ type: "SET_TURNSTILE_TOKEN", token: null });
				turnstileRef.current?.reset();
			}
		}
	};

	const handleSocialLogin = async (provider: "google" | "github" | "linkedin" | "apple") => {
		dispatch({ type: "SET_LOADING", loading: true });
		dispatch({ type: "SET_ERROR", error: null });

		try {
			// Check if org has custom OAuth credentials for this provider
			if (socialOAuthConfigured?.[provider]) {
				// Use custom OAuth flow for org-specific credentials
				window.location.assign(
					`/api/auth/social-org/${provider}?callbackURL=${encodeURIComponent(postSignInRedirectUrl)}`,
				);
			} else {
				// Use global Better Auth flow
				await authClient.signIn.social({
					provider,
					callbackURL: postSignInRedirectUrl,
				});
			}
		} catch (err) {
			dispatch({ type: "SET_LOADING", loading: false });
			dispatch({
				type: "SET_ERROR",
				error:
					err instanceof Error
						? err.message
						: t("auth.social-login-error", "An error occurred during social sign-in"),
			});
		}
	};

	const handlePasskeyLogin = async () => {
		dispatch({ type: "SET_LOADING", loading: true });
		try {
			const result = await authClient.signIn.passkey({
				autoFill: false,
			});

			if (result.error) {
				dispatch({
					type: "SET_ERROR",
					error: getAuthErrorMessage(
						result.error,
						t("auth.passkey-login-failed", "Failed to sign in with passkey"),
					),
				});
				dispatch({ type: "SET_LOADING", loading: false });
			} else {
				// Check onboarding status first
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
			}
		} catch (_error) {
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
			await authClient.signIn.sso({
				providerId: ssoProviderId,
				callbackURL: postSignInRedirectUrl,
			});
		} catch (err) {
			dispatch({ type: "SET_LOADING", loading: false });
			dispatch({
				type: "SET_ERROR",
				error:
					err instanceof Error
						? err.message
						: t("auth.sso-login-error", "An error occurred during SSO sign-in"),
			});
		}
	};

	const handleVerify2FA = async () => {
		if (otpValue.length !== 6) {
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
				code: otpValue,
				trustDevice,
			});

			if (result.error) {
				dispatch({
					type: "SET_ERROR",
					error:
						result.error.message || t("auth.2fa-verification-failed", "2FA verification failed"),
				});
				dispatch({ type: "SET_LOADING", loading: false });
			} else {
				// Check onboarding status first
				try {
					const userResponse = await fetch("/api/user/onboarding-status");
					if (userResponse.ok) {
						const { onboardingComplete, onboardingStep } = await userResponse.json();

						if (!onboardingComplete) {
							// Resume onboarding from last step
							push(getOnboardingStepPath(onboardingStep));
							return;
						}
					}
				} catch (fetchError) {
					console.error("Error checking onboarding status:", fetchError);
					// Continue to dashboard if check fails
				}

				// Onboarding complete, continue where the user intended to go
				push(postSignInRedirectUrl);
			}
		} catch (err) {
			dispatch({
				type: "SET_ERROR",
				error:
					err instanceof Error
						? err.message
						: t("auth.2fa-verification-error", "An error occurred during 2FA verification"),
			});
			dispatch({ type: "SET_LOADING", loading: false });
		}
	};

	return (
		<AuthFormWrapper
			className={className}
			formProps={{ onSubmit: handleSubmit }}
			title={t("auth.login-to-account", "Login to your account")}
			branding={branding}
			{...props}
		>
			{error ? (
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">{error}</div>
			) : null}

			{/* SSO Button - show prominently when SSO is the primary method */}
			{showSSO && !requires2FA && (
				<Button type="button" className="w-full" onClick={handleSSOLogin} disabled={isLoading}>
					<IconFingerprint className="mr-2 size-4" />
					{t("auth.login-with-sso", "Sign in with SSO")}
				</Button>
			)}

			{/* Divider when showing both SSO and other methods */}
			{showSSO && showEmailPassword && !requires2FA && (
				<div className="relative">
					<div className="absolute inset-0 flex items-center">
						<span className="w-full border-t" />
					</div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-card px-2 text-muted-foreground">{t("auth.or", "or")}</span>
					</div>
				</div>
			)}

			{/* Email/Password fields - only show if enabled */}
			{showEmailPassword && (
				<LoginCredentialsFields
					email={email}
					password={password}
					fieldErrors={fieldErrors}
					requires2FA={requires2FA}
					onEmailBlur={handleEmailBlur}
					onEmailChange={handleEmailChange}
					onPasswordBlur={handlePasswordBlur}
					onPasswordChange={handlePasswordChange}
				/>
			)}
			{requires2FA ? (
				<TwoFactorForm
					otpValue={otpValue}
					trustDevice={trustDevice}
					isLoading={isLoading}
					onOtpChange={(value) => dispatch({ type: "SET_OTP", value })}
					onTrustDeviceChange={(checked) =>
						dispatch({ type: "SET_TRUST_DEVICE", trustDevice: checked })
					}
					onVerify={handleVerify2FA}
				/>
			) : null}
			<LoginActions
				requires2FA={requires2FA}
				showEmailPassword={showEmailPassword}
				isLoading={isLoading}
				turnstileConfig={turnstileConfig}
				turnstileToken={turnstileToken}
				turnstileRef={turnstileRef}
				onTurnstileVerify={handleTurnstileVerify}
				onTurnstileError={handleTurnstileError}
				onTurnstileExpire={handleTurnstileExpire}
				onTurnstileTimeout={handleTurnstileTimeout}
				forgotPasswordHref="/forgot-password"
				signUpHref={withCallbackUrl("/sign-up", callbackUrl)}
			>
				<LoginAlternativeAuth
					requires2FA={requires2FA}
					showPasskey={showPasskey}
					filteredProviders={filteredProviders}
					providersLoading={providersLoading}
					isLoading={isLoading}
					onPasskeyLogin={handlePasskeyLogin}
					onSocialLogin={handleSocialLogin}
				/>
			</LoginActions>
		</AuthFormWrapper>
	);
}

export function LoginForm(props: React.ComponentProps<"div">) {
	return (
		<Suspense fallback={null}>
			<LoginFormContent {...props} />
		</Suspense>
	);
}
