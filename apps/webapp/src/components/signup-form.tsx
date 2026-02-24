"use client";

import { IconBuilding, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
	storePendingInviteCode,
	validateInviteCode,
} from "@/app/[locale]/(auth)/invite-code-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDomainAuth, useTurnstile } from "@/lib/auth/domain-auth-context";
import { authClient } from "@/lib/auth-client";
import { useEnabledProviders } from "@/lib/hooks/use-enabled-providers";
import type { SocialProvider, SocialProviderId } from "@/lib/social-providers";
import { verifyTurnstileWithServer } from "@/lib/turnstile/verify";
import { cn } from "@/lib/utils";
import { checkPasswordRequirements, passwordSchema } from "@/lib/validations/password";
import { Link, useRouter } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";
import { type TurnstileRef, TurnstileWidget } from "./turnstile-widget";

const signupSchema = z
	.object({
		name: z.string().min(1, "Name is required"),
		email: z.string().email("Invalid email address"),
		password: passwordSchema,
		confirmPassword: z.string().min(1, "Please confirm your password"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

interface SignupFormProps extends React.ComponentProps<"div"> {
	inviteCode?: string;
}

const SOCIAL_SKELETON_KEYS = [
	"social-1",
	"social-2",
	"social-3",
	"social-4",
	"social-5",
	"social-6",
];

type PasswordRequirementsListProps = {
	passwordRequirements: ReturnType<typeof checkPasswordRequirements>;
};

const PasswordRequirementsList = memo(function PasswordRequirementsList({
	passwordRequirements,
}: PasswordRequirementsListProps) {
	return (
		<div className="space-y-1.5 text-sm">
			{passwordRequirements.map((requirement) => (
				<div
					className={cn(
						"flex items-center gap-2",
						requirement.met ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
					)}
					key={requirement.label}
				>
					<span className={cn(requirement.met ? "text-green-600" : "text-muted-foreground")}>
						{requirement.met ? "✓" : "○"}
					</span>
					<span>{requirement.label}</span>
				</div>
			))}
		</div>
	);
});

type SignupSocialAuthProps = {
	showEmailPassword: boolean;
	filteredProviders: SocialProvider[];
	providersLoading: boolean;
	isLoading: boolean;
	onSocialSignup: (provider: SocialProviderId) => void;
};

const SignupSocialAuth = memo(function SignupSocialAuth({
	showEmailPassword,
	filteredProviders,
	providersLoading,
	isLoading,
	onSocialSignup,
}: SignupSocialAuthProps) {
	const { t } = useTranslate();

	if (filteredProviders.length === 0) {
		return null;
	}

	const skeletonCount = Math.max(filteredProviders.length, 4);

	return (
		<>
			<div className="text-center text-sm">
				<span className="relative z-10 px-2 text-muted-foreground">
					{showEmailPassword
						? t("auth.or-sign-up-with", "Or sign up with")
						: t("auth.sign-up-with.label", "Sign up with")}
				</span>
			</div>
			<div className="flex flex-wrap justify-center gap-2 *:w-1/4">
				{providersLoading
					? SOCIAL_SKELETON_KEYS.slice(0, skeletonCount).map((key) => (
							<div key={key} className="h-10 animate-pulse rounded-md bg-muted" />
						))
					: filteredProviders.map((provider) => (
							<Tooltip key={provider.id}>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="outline"
										onClick={() => onSocialSignup(provider.id)}
										disabled={isLoading}
									>
										<provider.icon className="h-4 w-4" />
										<span className="sr-only">
											{t(`auth.sign-up-with.${provider.id}`, `Sign up with ${provider.name}`)}
										</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									<span className="text-sm">
										{t(`auth.sign-up-with.${provider.id}`, `Sign up with ${provider.name}`)}
									</span>
								</TooltipContent>
							</Tooltip>
						))}
			</div>
		</>
	);
});

export function SignupForm({ className, inviteCode, ...props }: SignupFormProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formData, setFormData] = useState({
		name: "",
		email: "",
		password: "",
		confirmPassword: "",
	});
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const { enabledProviders, isLoading: providersLoading } = useEnabledProviders();

	// Turnstile state
	const turnstileConfig = useTurnstile();
	const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
	const turnstileRef = useRef<TurnstileRef>(null);

	const handleTurnstileVerify = useCallback((token: string) => {
		setTurnstileToken(token);
	}, []);

	const handleTurnstileError = useCallback(() => {
		setTurnstileToken(null);
		setError(t("auth.turnstile-error", "Verification failed. Please try again."));
		turnstileRef.current?.reset();
	}, [t]);

	const handleTurnstileExpire = useCallback(() => {
		setTurnstileToken(null);
		turnstileRef.current?.reset();
	}, []);

	const handleTurnstileTimeout = useCallback(() => {
		setTurnstileToken(null);
		turnstileRef.current?.reset();
	}, []);

	// Invite code state
	const [organizationName, setOrganizationName] = useState<string | null>(null);
	const [inviteCodeValid, setInviteCodeValid] = useState<boolean | null>(null);

	// Domain auth context for custom domains
	const domainAuth = useDomainAuth();
	const authConfig = domainAuth?.authConfig;
	const branding = domainAuth?.branding;

	// Validate invite code on mount
	useEffect(() => {
		if (inviteCode) {
			validateInviteCode(inviteCode).then((result) => {
				if (result.success && result.data?.valid) {
					setInviteCodeValid(true);
					setOrganizationName(result.data.inviteCode?.organization?.name || null);
				} else {
					setInviteCodeValid(false);
				}
			});
		}
	}, [inviteCode]);

	// Determine which auth methods are enabled
	const showEmailPassword = authConfig?.emailPasswordEnabled ?? true;
	const allowedSocialProviders = authConfig?.socialProvidersEnabled ?? [];

	// Filter social providers based on auth config
	const filteredProviders = useMemo(() => {
		if (allowedSocialProviders.length === 0) {
			return enabledProviders;
		}

		return enabledProviders.filter((provider) => allowedSocialProviders.includes(provider.id));
	}, [enabledProviders, allowedSocialProviders]);

	const passwordRequirements = useMemo(
		() => checkPasswordRequirements(formData.password, t),
		[formData.password, t],
	);
	const passwordsMatch =
		formData.confirmPassword && formData.password && formData.confirmPassword === formData.password;

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

	const validatePassword = (value: string) => {
		const result = passwordSchema.safeParse(value);
		if (result.success) {
			clearFieldError("password");
		} else {
			setFieldError(
				"password",
				result.error?.issues?.[0]?.message || t("validation.invalid-password", "Invalid password"),
			);
		}
	};

	const validateConfirmPassword = (value: string) => {
		if (value !== formData.password) {
			setFieldError("confirmPassword", t("auth.passwords-no-match", "Passwords do not match"));
		} else {
			clearFieldError("confirmPassword");
		}
	};

	const validateEmail = (value: string) => {
		const result = z.string().email().safeParse(value);
		if (result.success) {
			clearFieldError("email");
		} else {
			setFieldError("email", t("validation.invalid-email", "Invalid email address"));
		}
	};

	const validateName = (value: string) => {
		const result = z.string().min(1).safeParse(value);
		if (result.success) {
			clearFieldError("name");
		} else {
			setFieldError("name", t("validation.name-required", "Name is required"));
		}
	};

	const validateField = (field: string, value: string) => {
		switch (field) {
			case "password":
				validatePassword(value);
				break;
			case "confirmPassword":
				validateConfirmPassword(value);
				break;
			case "email":
				validateEmail(value);
				break;
			case "name":
				validateName(value);
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

		const result = signupSchema.safeParse(formData);

		if (!result.success) {
			handleValidationErrors(result.error);
			setIsLoading(false);
			return;
		}

		// Verify Turnstile if enabled
		if (turnstileConfig?.enabled && !turnstileToken) {
			setError(t("auth.turnstile-required", "Please complete the verification."));
			setIsLoading(false);
			return;
		}

		try {
			// Verify Turnstile token server-side if enabled
			if (turnstileConfig?.enabled && turnstileToken) {
				const verifyResult = await verifyTurnstileWithServer(turnstileToken);
				if (!verifyResult.success) {
					setError(verifyResult.error || t("auth.turnstile-failed", "Verification failed."));
					setTurnstileToken(null);
					turnstileRef.current?.reset();
					setIsLoading(false);
					return;
				}
			}

			const signupResult = await authClient.signUp.email({
				email: formData.email,
				password: formData.password,
				name: formData.name,
			});

			if (signupResult.error) {
				setError(signupResult.error.message || t("auth.signup-failed", "Failed to sign up"));
				// Reset Turnstile for retry (tokens are single-use)
				if (turnstileConfig?.enabled) {
					setTurnstileToken(null);
					turnstileRef.current?.reset();
				}
			} else {
				// Store pending invite code if provided
				if (inviteCode && inviteCodeValid) {
					try {
						await storePendingInviteCode(inviteCode);
					} catch {
						// Silently ignore - user can still join manually later
					}
				}
				router.push(`/verify-email-pending?email=${encodeURIComponent(formData.email)}`);
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("common.error-occurred", "An error occurred"),
			);
			// Reset Turnstile for retry (tokens are single-use)
			if (turnstileConfig?.enabled) {
				setTurnstileToken(null);
				turnstileRef.current?.reset();
			}
		} finally {
			setIsLoading(false);
		}
	};

	const handleSocialSignup = useCallback(
		async (provider: SocialProviderId) => {
			setIsLoading(true);
			setError(null);

			try {
				// For social signup with invite code, redirect to join page after auth
				// The join page will process the code for the new user
				const callbackURL = inviteCode && inviteCodeValid ? `/join/${inviteCode}` : "/";

				await authClient.signIn.social({
					provider,
					callbackURL,
				});
			} catch (err) {
				setIsLoading(false);
				setError(
					err instanceof Error
						? err.message
						: t("auth.social-signup-error", "An error occurred during social sign-up"),
				);
			}
		},
		[inviteCode, inviteCodeValid, t],
	);

	return (
		<AuthFormWrapper
			className={className}
			formProps={{ onSubmit: handleSubmit }}
			title={t("auth.create-account", "Create your account")}
			branding={branding}
			{...props}
		>
			{error ? (
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">{error}</div>
			) : null}

			{/* Show organization info when signing up with invite code */}
			{inviteCode && inviteCodeValid && organizationName && (
				<Alert className="border-primary/20 bg-primary/5">
					<IconBuilding className="h-4 w-4" />
					<AlertDescription>
						{t("auth.signing-up-to-join", "You're signing up to join {organization}", {
							organization: organizationName,
						})}
					</AlertDescription>
				</Alert>
			)}

			{inviteCode && inviteCodeValid === false && (
				<Alert variant="destructive">
					<AlertDescription>
						{t(
							"auth.invalid-invite-code",
							"The invite code is invalid or has expired. You can still sign up and join later.",
						)}
					</AlertDescription>
				</Alert>
			)}

			{/* Email/Password signup form - only show if enabled */}
			{showEmailPassword && (
				<>
					<div className="grid gap-3">
						<Label htmlFor="name">{t("auth.name", "Name")}</Label>
						<Input
							id="name"
							name="name"
							autoComplete="name"
							onBlur={(e) => validateField("name", e.target.value)}
							onChange={(e) => handleChange("name", e.target.value)}
							placeholder={t("auth.name-placeholder", "John Doe")}
							required
							type="text"
							value={formData.name}
						/>
						{fieldErrors.name ? (
							<p className="text-destructive text-sm">{fieldErrors.name}</p>
						) : null}
					</div>
					<div className="grid gap-3">
						<Label htmlFor="email">{t("auth.email", "Email")}</Label>
						<Input
							id="email"
							name="email"
							autoComplete="email"
							onBlur={(e) => validateField("email", e.target.value)}
							onChange={(e) => handleChange("email", e.target.value)}
							placeholder={t("auth.email-placeholder", "m@example.com")}
							required
							type="email"
							value={formData.email}
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
							autoComplete="new-password"
							onBlur={(e) => validateField("password", e.target.value)}
							onChange={(e) => handleChange("password", e.target.value)}
							required
							type="password"
							value={formData.password}
						/>
						{formData.password ? (
							<PasswordRequirementsList passwordRequirements={passwordRequirements} />
						) : null}
						{fieldErrors.password ? (
							<p className="text-destructive text-sm">{fieldErrors.password}</p>
						) : null}
					</div>
					<div className="grid gap-3">
						<Label htmlFor="confirmPassword">
							{t("auth.confirm-password", "Confirm Password")}
						</Label>
						<Input
							id="confirmPassword"
							name="confirmPassword"
							autoComplete="new-password"
							onBlur={(e) => validateField("confirmPassword", e.target.value)}
							onChange={(e) => handleChange("confirmPassword", e.target.value)}
							required
							type="password"
							value={formData.confirmPassword}
						/>
						{fieldErrors.confirmPassword ? (
							<p className="text-destructive text-sm">{fieldErrors.confirmPassword}</p>
						) : null}
						{passwordsMatch ? (
							<p className="text-green-600 text-sm dark:text-green-400">
								{t("auth.passwords-match", "Passwords match")}
							</p>
						) : null}
					</div>

					{/* Turnstile widget */}
					{turnstileConfig?.enabled && turnstileConfig.siteKey && (
						<div className="flex justify-center">
							<TurnstileWidget
								ref={turnstileRef}
								siteKey={turnstileConfig.siteKey}
								onVerify={handleTurnstileVerify}
								onError={handleTurnstileError}
								onExpire={handleTurnstileExpire}
								onTimeout={handleTurnstileTimeout}
							/>
						</div>
					)}

					<Button
						className="w-full"
						disabled={isLoading || (turnstileConfig?.enabled && !turnstileToken)}
						type="submit"
					>
						{isLoading ? (
							<>
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
								{t("common.loading", "Loading...")}
							</>
						) : (
							t("auth.sign-up", "Sign up")
						)}
					</Button>
				</>
			)}

			{/* Alternative auth methods */}
			<SignupSocialAuth
				showEmailPassword={showEmailPassword}
				filteredProviders={filteredProviders}
				providersLoading={providersLoading}
				isLoading={isLoading}
				onSocialSignup={handleSocialSignup}
			/>

			{showEmailPassword && (
				<div className="text-center text-sm">
					{t("auth.already-have-account", "Already have an account?")}{" "}
					<Link className="underline underline-offset-4" href="/sign-in">
						{t("auth.sign-in", "Sign in")}
					</Link>
				</div>
			)}
		</AuthFormWrapper>
	);
}
