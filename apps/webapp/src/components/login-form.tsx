"use client";

import { IconFingerprint, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Key } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDomainAuth, useTurnstile } from "@/lib/auth/domain-auth-context";
import { authClient } from "@/lib/auth-client";
import { useEnabledProviders } from "@/lib/hooks/use-enabled-providers";
import { verifyTurnstileWithServer } from "@/lib/turnstile/verify";
import { getOnboardingStepPath } from "@/lib/validations/onboarding";
import { Link, useRouter } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";
import { TurnstileWidget, type TurnstileRef } from "./turnstile-widget";

const loginSchema = z.object({
	email: z.string().email("Invalid email address"),
	password: z.string().min(1, "Password is required"),
});

// Consolidated form state to reduce re-renders (rerender-functional-setstate)
type FormState = {
	email: string;
	password: string;
	fieldErrors: Record<string, string>;
	error: string | null;
	isLoading: boolean;
	requires2FA: boolean;
	otpValue: string;
	trustDevice: boolean;
	turnstileToken: string | null;
};

type FormAction =
	| { type: "SET_FIELD"; field: "email" | "password"; value: string }
	| { type: "SET_FIELD_ERROR"; field: string; error: string }
	| { type: "CLEAR_FIELD_ERROR"; field: string }
	| { type: "SET_FIELD_ERRORS"; errors: Record<string, string> }
	| { type: "SET_ERROR"; error: string | null }
	| { type: "SET_LOADING"; loading: boolean }
	| { type: "SET_REQUIRES_2FA"; requires2FA: boolean }
	| { type: "SET_OTP"; value: string }
	| { type: "SET_TRUST_DEVICE"; trustDevice: boolean }
	| { type: "SET_TURNSTILE_TOKEN"; token: string | null }
	| { type: "RESET_LOADING" };

const initialState: FormState = {
	email: "",
	password: "",
	fieldErrors: {},
	error: null,
	isLoading: false,
	requires2FA: false,
	otpValue: "",
	trustDevice: false,
	turnstileToken: null,
};

function formReducer(state: FormState, action: FormAction): FormState {
	switch (action.type) {
		case "SET_FIELD": {
			const newFieldErrors = { ...state.fieldErrors };
			delete newFieldErrors[action.field];
			return {
				...state,
				[action.field]: action.value,
				fieldErrors: newFieldErrors,
				error: null, // Clear general error when typing
			};
		}
		case "SET_FIELD_ERROR":
			return {
				...state,
				fieldErrors: { ...state.fieldErrors, [action.field]: action.error },
			};
		case "CLEAR_FIELD_ERROR": {
			const newFieldErrors = { ...state.fieldErrors };
			delete newFieldErrors[action.field];
			return { ...state, fieldErrors: newFieldErrors };
		}
		case "SET_FIELD_ERRORS":
			return { ...state, fieldErrors: action.errors };
		case "SET_ERROR":
			return { ...state, error: action.error };
		case "SET_LOADING":
			return { ...state, isLoading: action.loading };
		case "SET_REQUIRES_2FA":
			return { ...state, requires2FA: action.requires2FA, isLoading: false };
		case "SET_OTP":
			return { ...state, otpValue: action.value };
		case "SET_TRUST_DEVICE":
			return { ...state, trustDevice: action.trustDevice };
		case "SET_TURNSTILE_TOKEN":
			return { ...state, turnstileToken: action.token };
		case "RESET_LOADING":
			return { ...state, isLoading: false };
		default:
			return state;
	}
}

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
	const { t } = useTranslate();
	const router = useRouter();
	const [state, dispatch] = useReducer(formReducer, initialState);
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
	const turnstileConfig = useTurnstile();

	// Turnstile ref for programmatic control
	const turnstileRef = useRef<TurnstileRef>(null);

	// Turnstile handlers
	const handleTurnstileVerify = useCallback((token: string) => {
		dispatch({ type: "SET_TURNSTILE_TOKEN", token });
	}, []);

	const handleTurnstileError = useCallback(() => {
		dispatch({ type: "SET_TURNSTILE_TOKEN", token: null });
		turnstileRef.current?.reset();
	}, []);

	const handleTurnstileExpire = useCallback(() => {
		dispatch({ type: "SET_TURNSTILE_TOKEN", token: null });
		turnstileRef.current?.reset();
	}, []);

	const handleTurnstileTimeout = useCallback(() => {
		dispatch({ type: "SET_TURNSTILE_TOKEN", token: null });
		turnstileRef.current?.reset();
	}, []);

	// Determine which auth methods are enabled
	const showEmailPassword = authConfig?.emailPasswordEnabled ?? true;
	const showPasskey = authConfig?.passkeyEnabled ?? true;
	const showSSO = authConfig?.ssoEnabled ?? false;
	const allowedSocialProviders = authConfig?.socialProvidersEnabled ?? [];

	// Filter social providers based on auth config
	const filteredProviders =
		allowedSocialProviders.length > 0
			? enabledProviders.filter((p) => allowedSocialProviders.includes(p.id))
			: enabledProviders;

	// Reset loading state when component mounts (e.g., after logout redirect)
	useEffect(() => {
		dispatch({ type: "RESET_LOADING" });
	}, []);

	// Memoized handlers to prevent unnecessary re-renders
	const handleChange = useCallback((field: "email" | "password", value: string) => {
		dispatch({ type: "SET_FIELD", field, value });
	}, []);

	const validateEmail = useCallback(
		(value: string) => {
			const result = z.string().email().safeParse(value);
			if (result.success) {
				dispatch({ type: "CLEAR_FIELD_ERROR", field: "email" });
			} else {
				dispatch({
					type: "SET_FIELD_ERROR",
					field: "email",
					error: t("validation.invalid-email", "Invalid email address"),
				});
			}
		},
		[t],
	);

	const validatePassword = useCallback(
		(value: string) => {
			if (value.length === 0) {
				dispatch({
					type: "SET_FIELD_ERROR",
					field: "password",
					error: t("validation.password-required", "Password is required"),
				});
			} else {
				dispatch({ type: "CLEAR_FIELD_ERROR", field: "password" });
			}
		},
		[t],
	);

	const validateField = useCallback(
		(field: string, value: string) => {
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
		},
		[validateEmail, validatePassword],
	);

	const handleValidationErrors = useCallback((errors: z.ZodError) => {
		const errorMap: Record<string, string> = {};
		for (const err of errors.issues) {
			if (err.path[0]) {
				errorMap[err.path[0] as string] = err.message;
			}
		}
		dispatch({ type: "SET_FIELD_ERRORS", errors: errorMap });
	}, []);

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
								router.push("/verify-email-pending");
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
							router.push(getOnboardingStepPath(onboardingStep));
							return;
						}
					}
				} catch (fetchError) {
					console.error("Error checking onboarding status:", fetchError);
					// Continue to dashboard if check fails
				}

				// Onboarding complete, redirect to init page to set up org context
				router.push("/init");
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

	const handleSocialLogin = useCallback(
		async (provider: "google" | "github" | "linkedin" | "apple") => {
			dispatch({ type: "SET_LOADING", loading: true });
			dispatch({ type: "SET_ERROR", error: null });

			try {
				// Check if org has custom OAuth credentials for this provider
				const socialOAuthConfigured = domainAuth?.socialOAuthConfigured;
				if (socialOAuthConfigured?.[provider]) {
					// Use custom OAuth flow for org-specific credentials
					window.location.href = `/api/auth/social-org/${provider}?callbackURL=/init`;
				} else {
					// Use global Better Auth flow
					await authClient.signIn.social({
						provider,
						callbackURL: "/init",
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
		},
		[t, domainAuth?.socialOAuthConfigured],
	);

	const handlePasskeyLogin = useCallback(async () => {
		dispatch({ type: "SET_LOADING", loading: true });
		try {
			const result = await authClient.signIn.passkey({
				autoFill: false,
			});

			if (result.error) {
				dispatch({
					type: "SET_ERROR",
					error:
						result.error.message ||
						t("auth.passkey-login-failed", "Failed to sign in with passkey"),
				});
				dispatch({ type: "SET_LOADING", loading: false });
			} else {
				// Check onboarding status first
				try {
					const userResponse = await fetch("/api/user/onboarding-status");
					if (userResponse.ok) {
						const { onboardingComplete, onboardingStep } = await userResponse.json();

						if (!onboardingComplete) {
							router.push(getOnboardingStepPath(onboardingStep));
							return;
						}
					}
				} catch (fetchError) {
					console.error("Error checking onboarding status:", fetchError);
				}

				router.push("/init");
			}
		} catch (_error) {
			dispatch({
				type: "SET_ERROR",
				error: t("auth.passkey-login-failed", "Failed to sign in with passkey"),
			});
			dispatch({ type: "SET_LOADING", loading: false });
		}
	}, [t, router]);

	const handleSSOLogin = useCallback(async () => {
		if (!authConfig?.ssoProviderId) {
			dispatch({
				type: "SET_ERROR",
				error: t("auth.sso-not-configured", "SSO is not configured for this domain"),
			});
			return;
		}

		dispatch({ type: "SET_LOADING", loading: true });
		dispatch({ type: "SET_ERROR", error: null });

		try {
			await (authClient.sso as any).signIn({
				providerId: authConfig.ssoProviderId,
				callbackURL: "/init",
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
	}, [authConfig?.ssoProviderId, t]);

	const handleVerify2FA = useCallback(async () => {
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
							router.push(getOnboardingStepPath(onboardingStep));
							return;
						}
					}
				} catch (fetchError) {
					console.error("Error checking onboarding status:", fetchError);
					// Continue to dashboard if check fails
				}

				// Onboarding complete, redirect to init page to set up org context
				router.push("/init");
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
	}, [otpValue, trustDevice, t, router]);

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
					<IconFingerprint className="mr-2 h-4 w-4" />
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
				<>
					<div className="grid gap-3">
						<Label htmlFor="email">{t("auth.email", "Email")}</Label>
						<Input
							id="email"
							name="email"
							autoComplete="email"
							onBlur={(e) => validateField("email", e.target.value)}
							onChange={(e) => {
								handleChange("email", e.target.value);
								validateField("email", e.target.value);
							}}
							placeholder={t("auth.email-placeholder", "m@example.com")}
							required
							type="email"
							value={email}
							disabled={requires2FA}
						/>
						{fieldErrors.email ? (
							<p className="text-destructive text-sm">{fieldErrors.email}</p>
						) : null}
					</div>
					<div className="grid gap-3">
						<Label htmlFor="password">{t("auth.password", "Password")}</Label>
						<Input
							id="password"
							name="password"
							autoComplete="current-password"
							onBlur={(e) => validateField("password", e.target.value)}
							onChange={(e) => {
								handleChange("password", e.target.value);
								validateField("password", e.target.value);
							}}
							required
							type="password"
							value={password}
							disabled={requires2FA}
						/>
						{fieldErrors.password ? (
							<p className="text-destructive text-sm">{fieldErrors.password}</p>
						) : null}
					</div>
				</>
			)}
			{requires2FA ? (
				<>
					<div className="grid gap-3">
						<Label htmlFor="otp">{t("auth.2fa-code", "Two-Factor Authentication Code")}</Label>
						<div className="flex justify-center">
							<InputOTP
								maxLength={6}
								value={otpValue}
								onChange={(value) => dispatch({ type: "SET_OTP", value })}
							>
								<InputOTPGroup>
									<InputOTPSlot index={0} />
									<InputOTPSlot index={1} />
									<InputOTPSlot index={2} />
									<InputOTPSlot index={3} />
									<InputOTPSlot index={4} />
									<InputOTPSlot index={5} />
								</InputOTPGroup>
							</InputOTP>
						</div>
						<p className="text-sm text-muted-foreground text-center">
							{t("auth.2fa-enter-code", "Enter the 6-digit code from your authenticator app")}
						</p>
					</div>
					<div className="flex items-center justify-center space-x-2">
						<Switch
							id="trustDevice"
							checked={trustDevice}
							onCheckedChange={(checked) =>
								dispatch({ type: "SET_TRUST_DEVICE", trustDevice: checked })
							}
						/>
						<Label htmlFor="trustDevice" className="cursor-pointer">
							{t("auth.remember-device", "Remember this device for 30 days")}
						</Label>
					</div>
					<Button
						className="w-full"
						disabled={isLoading || otpValue.length !== 6}
						onClick={handleVerify2FA}
					>
						{isLoading ? (
							<>
								<IconLoader2 className="size-4 animate-spin" />
								{t("auth.verifying", "Verifying...")}
							</>
						) : (
							t("auth.verify-and-login", "Verify and Login")
						)}
					</Button>
				</>
			) : showEmailPassword ? (
				<>
					{/* Turnstile widget */}
					{turnstileConfig?.enabled && turnstileConfig.siteKey && (
						<TurnstileWidget
							ref={turnstileRef}
							siteKey={turnstileConfig.siteKey}
							onVerify={handleTurnstileVerify}
							onError={handleTurnstileError}
							onExpire={handleTurnstileExpire}
							onTimeout={handleTurnstileTimeout}
							className="!absolute !overflow-hidden !h-0 !w-0"
						/>
					)}

					<Button
						className="w-full"
						disabled={isLoading || (turnstileConfig?.enabled && !turnstileToken)}
						type="submit"
					>
						{isLoading ? (
							<>
								<IconLoader2 className="size-4 animate-spin" />
								{t("auth.logging-in", "Logging in...")}
							</>
						) : (
							t("auth.login", "Login")
						)}
					</Button>
				</>
			) : null}
			{!requires2FA && showEmailPassword && (
				<div className="-mt-6 text-center">
					<Link className="text-xs underline-offset-2 hover:underline" href="/forgot-password">
						{t("auth.forgot-password", "Forgot your password?")}
					</Link>
				</div>
			)}
			{!requires2FA && (showPasskey || filteredProviders.length > 0) && (
				<>
					<div className="text-center text-sm">
						<span className="relative z-10 px-2 text-muted-foreground">
							{t("auth.or-continue-with", "Or continue with")}
						</span>
					</div>
					<div className="flex flex-wrap justify-center gap-2 *:w-1/4">
						{/* Passkey - show if enabled */}
						{showPasskey && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="outline"
										onClick={handlePasskeyLogin}
										disabled={isLoading}
									>
										<Key className="h-4 w-4" />
										<span className="sr-only">
											{t("auth.login-with.passkey", "Login with Passkey")}
										</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									<span className="text-sm">
										{t("auth.login-with.passkey", "Login with Passkey")}
									</span>
								</TooltipContent>
							</Tooltip>
						)}

						{/* Dynamic social providers - filtered based on auth config */}
						{providersLoading
							? Array.from({ length: filteredProviders.length || 4 }).map((_, i) => (
									<div key={i} className="h-10 bg-muted animate-pulse rounded-md" />
								))
							: filteredProviders.map((provider) => (
									<Tooltip key={provider.id}>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="outline"
												onClick={() => handleSocialLogin(provider.id)}
												disabled={isLoading}
											>
												<provider.icon className="h-4 w-4" />
												<span className="sr-only">
													{t(`auth.login-with.${provider.id}`, `Login with ${provider.name}`)}
												</span>
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											<span className="text-sm">
												{t(`auth.login-with.${provider.id}`, `Login with ${provider.name}`)}
											</span>
										</TooltipContent>
									</Tooltip>
								))}
					</div>
				</>
			)}
			{!requires2FA && showEmailPassword && (
				<div className="text-center text-sm">
					{t("auth.dont-have-account", "Don't have an account?")}{" "}
					<Link className="underline underline-offset-4" href="/sign-up">
						{t("auth.sign-up", "Sign up")}
					</Link>
				</div>
			)}
		</AuthFormWrapper>
	);
}
