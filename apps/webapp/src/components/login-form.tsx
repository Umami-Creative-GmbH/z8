"use client";

import { IconFingerprint, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Key } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDomainAuth } from "@/lib/auth/domain-auth-context";
import { authClient } from "@/lib/auth-client";
import { useEnabledProviders } from "@/lib/hooks/use-enabled-providers";
import { getOnboardingStepPath } from "@/lib/validations/onboarding";
import { Link, useRouter } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";

const loginSchema = z.object({
	email: z.string().email("Invalid email address"),
	password: z.string().min(1, "Password is required"),
});

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formData, setFormData] = useState({
		email: "",
		password: "",
	});
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [requires2FA, setRequires2FA] = useState(false);
	const [otpValue, setOtpValue] = useState("");
	const [trustDevice, setTrustDevice] = useState(false);
	const { enabledProviders, isLoading: providersLoading } = useEnabledProviders();

	// Domain auth context for custom domains
	const domainAuth = useDomainAuth();
	const authConfig = domainAuth?.authConfig;
	const branding = domainAuth?.branding;

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
		setIsLoading(false);
	}, []);

	const handleChange = (field: string, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		// Clear error for this field when user starts typing
		if (fieldErrors[field]) {
			setFieldErrors((prev) => {
				const newErrors = { ...prev };
				delete newErrors[field];
				return newErrors;
			});
		}
		// Clear general error when user starts typing
		if (error) {
			setError(null);
		}
	};

	const clearFieldError = (field: string) => {
		setFieldErrors((prev) => {
			const newErrors = { ...prev };
			delete newErrors[field];
			return newErrors;
		});
	};

	const setFieldError = (field: string, message: string) => {
		setFieldErrors((prev) => ({
			...prev,
			[field]: message,
		}));
	};

	const validateEmail = (value: string) => {
		const result = z.string().email().safeParse(value);
		if (result.success) {
			clearFieldError("email");
		} else {
			setFieldError("email", t("validation.invalid-email", "Invalid email address"));
		}
	};

	const validatePassword = (value: string) => {
		if (value.length === 0) {
			setFieldError("password", t("validation.password-required", "Password is required"));
		} else {
			clearFieldError("password");
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
		setFieldErrors(errorMap);
	};

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setIsLoading(true);
		setError(null);

		const result = loginSchema.safeParse(formData);

		if (!result.success) {
			handleValidationErrors(result.error);
			setIsLoading(false);
			return;
		}

		try {
			const signInResult = await authClient.signIn.email(
				{
					email: formData.email,
					password: formData.password,
				},
				{
					onError: (ctx) => {
						setIsLoading(false);
						if (ctx.error.status === 403) {
							// Email not verified
							setError(
								t(
									"auth.email-not-verified",
									"Please verify your email address before signing in. Check your inbox for the verification link.",
								),
							);
							// Optionally redirect to verification pending page
							setTimeout(() => {
								router.push("/verify-email-pending");
							}, 3000);
						} else {
							setError(ctx.error.message || t("auth.login-failed", "Failed to sign in"));
						}
					},
				},
			);

			if (signInResult.error) {
				setIsLoading(false);
				// Error already handled in onError callback
				if (signInResult.error.status !== 403) {
					setError(signInResult.error.message || t("auth.login-failed", "Failed to sign in"));
				}
			} else {
				// Check if 2FA is required
				if ((signInResult.data as any)?.twoFactorRedirect) {
					setRequires2FA(true);
					setIsLoading(false);
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
				} catch (error) {
					console.error("Error checking onboarding status:", error);
					// Continue to dashboard if check fails
				}

				// Onboarding complete, redirect to dashboard
				router.push("/");
			}
		} catch (err) {
			setIsLoading(false);
			setError(
				err instanceof Error
					? err.message
					: t("auth.login-error", "An error occurred during sign in"),
			);
		}
	};

	const handleSocialLogin = async (provider: "google" | "github" | "linkedin" | "apple") => {
		setIsLoading(true);
		setError(null);

		try {
			await authClient.signIn.social({
				provider,
				callbackURL: "/",
			});
		} catch (err) {
			setIsLoading(false);
			setError(
				err instanceof Error
					? err.message
					: t("auth.social-login-error", "An error occurred during social sign-in"),
			);
		}
	};

	const handlePasskeyLogin = async () => {
		setIsLoading(true);
		try {
			const result = await authClient.signIn.passkey({
				autoFill: false,
			});

			if (result.error) {
				setError(result.error.message || "Failed to sign in with passkey");
				setIsLoading(false);
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
				} catch (error) {
					console.error("Error checking onboarding status:", error);
				}

				router.push("/");
			}
		} catch (_error) {
			setError("Failed to sign in with passkey");
			setIsLoading(false);
		}
	};

	const handleSSOLogin = async () => {
		if (!authConfig?.ssoProviderId) {
			setError(t("auth.sso-not-configured", "SSO is not configured for this domain"));
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			await (authClient.sso as any).signIn({
				providerId: authConfig.ssoProviderId,
				callbackURL: "/",
			});
		} catch (err) {
			setIsLoading(false);
			setError(
				err instanceof Error
					? err.message
					: t("auth.sso-login-error", "An error occurred during SSO sign-in"),
			);
		}
	};

	const handleVerify2FA = async () => {
		if (otpValue.length !== 6) {
			setError(t("auth.invalid-2fa-code", "Please enter a valid 6-digit code"));
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			const result = await authClient.twoFactor.verifyTotp({
				code: otpValue,
				trustDevice,
			});

			if (result.error) {
				setError(
					result.error.message || t("auth.2fa-verification-failed", "2FA verification failed"),
				);
				setIsLoading(false);
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
				} catch (error) {
					console.error("Error checking onboarding status:", error);
					// Continue to dashboard if check fails
				}

				// Onboarding complete, redirect to dashboard
				router.push("/");
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t("auth.2fa-verification-error", "An error occurred during 2FA verification"),
			);
			setIsLoading(false);
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
							onBlur={(e) => validateField("email", e.target.value)}
							onChange={(e) => {
								handleChange("email", e.target.value);
								validateField("email", e.target.value);
							}}
							placeholder={t("auth.email-placeholder", "m@example.com")}
							required
							type="email"
							value={formData.email}
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
							onBlur={(e) => validateField("password", e.target.value)}
							onChange={(e) => {
								handleChange("password", e.target.value);
								validateField("password", e.target.value);
							}}
							required
							type="password"
							value={formData.password}
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
							<InputOTP maxLength={6} value={otpValue} onChange={setOtpValue}>
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
						<Switch id="trustDevice" checked={trustDevice} onCheckedChange={setTrustDevice} />
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
				<Button className="w-full" disabled={isLoading} type="submit">
					{isLoading ? (
						<>
							<IconLoader2 className="size-4 animate-spin" />
							{t("auth.logging-in", "Logging in...")}
						</>
					) : (
						t("auth.login", "Login")
					)}
				</Button>
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
