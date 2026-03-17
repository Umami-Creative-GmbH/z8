"use client";

import { IconBuilding, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { storePendingInvitation } from "@/app/[locale]/(auth)/invitation-actions";
import {
	storePendingInviteCode,
	validateInviteCode,
} from "@/app/[locale]/(auth)/invite-code-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sanitizeCallbackUrl, withCallbackUrl } from "@/lib/auth/callback-url";
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

const PASSWORD_REQUIREMENT_HINTS = [
	"Use at least 8 characters.",
	"Add a lowercase letter.",
	"Add an uppercase letter.",
	"Add a number.",
	"Add one special character to finish.",
] as const;

interface SignupFormProps extends React.ComponentProps<"div"> {
	callbackUrl?: string;
	initialEmail?: string;
	initialInvitationId?: string;
	initialOrganizationName?: string;
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
	guidanceId: string;
	passwordRequirements: ReturnType<typeof checkPasswordRequirements>;
	progressLabel: string;
	progressMessage: string;
	progressTitle: string;
};

const PasswordRequirementsList = memo(function PasswordRequirementsList({
	guidanceId,
	passwordRequirements,
	progressLabel,
	progressMessage,
	progressTitle,
}: PasswordRequirementsListProps) {
	const metCount = passwordRequirements.filter((requirement) => requirement.met).length;
	const totalCount = passwordRequirements.length;

	return (
		<div
			aria-live="polite"
			className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4"
			id={guidanceId}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1">
					<p className="font-medium text-sm">{progressTitle}</p>
					<p className="text-muted-foreground text-sm">{progressLabel}</p>
				</div>
				<span className="rounded-full border border-border/80 px-2.5 py-1 font-medium text-xs text-foreground">
					{metCount}/{totalCount}
				</span>
			</div>
			<p className="text-muted-foreground text-sm">{progressMessage}</p>
			<div className="grid gap-2 sm:grid-cols-2">
				{passwordRequirements.map((requirement) => (
					<div
						className={cn(
							"flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
							requirement.met
								? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/80 dark:bg-emerald-950/30 dark:text-emerald-300"
								: "border-border/80 bg-background/70 text-muted-foreground",
						)}
						key={requirement.label}
					>
						<span className="font-medium">{requirement.met ? "✓" : "○"}</span>
						<span>{requirement.label}</span>
					</div>
				))}
			</div>
		</div>
	);
});

type PasswordConfirmationStatusProps = {
	statusId: string;
	message: string;
	status: "idle" | "match" | "mismatch";
};

const PasswordConfirmationStatus = memo(function PasswordConfirmationStatus({
	statusId,
	message,
	status,
}: PasswordConfirmationStatusProps) {
	return (
		<p
			aria-live="polite"
			className={cn(
				"rounded-lg border px-3 py-2 text-sm",
				status === "match"
					? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/80 dark:bg-emerald-950/30 dark:text-emerald-300"
					: status === "mismatch"
						? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/80 dark:bg-amber-950/30 dark:text-amber-300"
						: "border-border/80 bg-muted/20 text-muted-foreground",
			)}
			id={statusId}
		>
			{message}
		</p>
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
										<provider.icon aria-hidden="true" className="h-4 w-4" />
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

export function SignupForm({
	callbackUrl,
	className,
	initialEmail,
	initialInvitationId,
	initialOrganizationName,
	inviteCode,
	...props
}: SignupFormProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const sanitizedCallbackUrl = sanitizeCallbackUrl(callbackUrl, "");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formData, setFormData] = useState({
		name: "",
		email: initialEmail ?? "",
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
	const [organizationName, setOrganizationName] = useState<string | null>(
		initialOrganizationName ?? null,
	);
	const [inviteCodeValid, setInviteCodeValid] = useState<boolean | null>(null);
	const isInvitationSignup = Boolean(initialEmail);

	// Domain auth context for custom domains
	const domainAuth = useDomainAuth();
	const authConfig = domainAuth?.authConfig;
	const branding = domainAuth?.branding;

	// Validate invite code on mount
	useEffect(() => {
		if (inviteCode) {
			validateInviteCode(inviteCode)
				.then((result) => {
					if (result.success && result.data?.valid) {
						setInviteCodeValid(true);
						setOrganizationName(result.data.inviteCode?.organization?.name || null);
					} else {
						setInviteCodeValid(false);
					}
				})
				.catch(() => {
					setInviteCodeValid(false);
				});
		}
	}, [inviteCode]);

	useEffect(() => {
		if (!initialEmail) {
			return;
		}

		setFormData((previous) => {
			if (previous.email === initialEmail) {
				return previous;
			}

			return {
				...previous,
				email: initialEmail,
			};
		});
	}, [initialEmail]);

	useEffect(() => {
		if (!initialOrganizationName) {
			return;
		}

		setOrganizationName(initialOrganizationName);
	}, [initialOrganizationName]);

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
	const signupSchema = useMemo(
		() =>
			z
				.object({
					name: z.string().min(1, t("validation.name-required", "Name is required")),
					email: z.string().email(t("validation.invalid-email", "Invalid email address")),
					password: passwordSchema,
					confirmPassword: z
						.string()
						.min(1, t("auth.confirm-password-required", "Please confirm your password")),
				})
				.refine((data) => data.password === data.confirmPassword, {
					message: t("auth.passwords-no-match", "Passwords do not match"),
					path: ["confirmPassword"],
				}),
		[t],
	);

	const passwordRequirements = useMemo(
		() => checkPasswordRequirements(formData.password, t),
		[formData.password, t],
	);
	const metPasswordRequirementsCount = useMemo(
		() => passwordRequirements.filter((requirement) => requirement.met).length,
		[passwordRequirements],
	);
	const nextPasswordRequirementIndex = useMemo(
		() => passwordRequirements.findIndex((requirement) => !requirement.met),
		[passwordRequirements],
	);
	const passwordProgressLabel = useMemo(
		() =>
			t("auth.password-progress-label", "{met} of {total} requirements met", {
				met: metPasswordRequirementsCount,
				total: passwordRequirements.length,
			}),
		[metPasswordRequirementsCount, passwordRequirements.length, t],
	);
	const passwordRequirementsTitle = useMemo(
		() => t("auth.password-requirements-heading", "Password requirements"),
		[t],
	);
	const passwordProgressMessage = useMemo(() => {
		if (!formData.password) {
			return t(
				"auth.password-progress-start",
				"Use 8+ characters with upper and lowercase letters, a number, and a symbol.",
			);
		}

		if (nextPasswordRequirementIndex === -1) {
			return t(
				"auth.password-progress-ready",
				"All password rules are satisfied. Confirm it once more to continue.",
			);
		}

		return t(
			`auth.password-progress-hint-${nextPasswordRequirementIndex}`,
			PASSWORD_REQUIREMENT_HINTS[nextPasswordRequirementIndex],
		);
	}, [formData.password, nextPasswordRequirementIndex, t]);
	const passwordsMatch =
		formData.confirmPassword && formData.password && formData.confirmPassword === formData.password;
	const passwordConfirmationStatus = useMemo<"idle" | "match" | "mismatch">(() => {
		if (!formData.confirmPassword) {
			return "idle";
		}

		return passwordsMatch ? "match" : "mismatch";
	}, [formData.confirmPassword, passwordsMatch]);
	const passwordConfirmationMessage = useMemo(() => {
		if (!formData.confirmPassword) {
			return t(
				"auth.password-confirmation-idle",
				"Re-enter the password once so we can confirm it before you continue.",
			);
		}

		if (passwordsMatch) {
			return t(
				"auth.password-confirmation-match",
				"Confirmation matches and your password is ready to use.",
			);
		}

		return t("auth.password-confirmation-mismatch", "Keep typing to match your password exactly.");
	}, [formData.confirmPassword, passwordsMatch, t]);

	const handleChange = (field: string, value: string) => {
		const nextFormData = { ...formData, [field]: value };
		setFormData(nextFormData);
		// Clear error for this field when user starts typing
		if (fieldErrors[field]) {
			setFieldErrors((prev) => {
				const newErrors = { ...prev };
				delete newErrors[field];
				return newErrors;
			});
		}

		if ((field === "password" || field === "confirmPassword") && nextFormData.confirmPassword) {
			if (nextFormData.confirmPassword !== nextFormData.password) {
				setFieldError("confirmPassword", t("auth.passwords-no-match", "Passwords do not match"));
			} else {
				clearFieldError("confirmPassword");
			}
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

	const getFieldErrorId = (field: string) => `${field}-error`;

	const getDescribedBy = (...ids: Array<string | false | null | undefined>) => {
		const describedBy = ids.filter(Boolean).join(" ");
		return describedBy.length > 0 ? describedBy : undefined;
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
		if (!value.trim()) {
			setFieldError(
				"confirmPassword",
				t("auth.confirm-password-required", "Please confirm your password"),
			);
			return;
		}

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
		let firstInvalidField: string | null = null;
		for (const err of errors.issues) {
			if (err.path[0]) {
				const field = err.path[0] as string;
				errorMap[field] = err.message;
				if (!firstInvalidField) {
					firstInvalidField = field;
				}
			}
		}
		setFieldErrors(errorMap);
		if (firstInvalidField) {
			document.getElementById(firstInvalidField)?.focus();
		}
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
				if (initialInvitationId) {
					try {
						await storePendingInvitation(initialInvitationId, formData.email);
					} catch {
						// Ignore and let the user continue manually from the invitation page later.
					}
				}

				// Store pending invite code if provided
				if (inviteCode && inviteCodeValid) {
					try {
						await storePendingInviteCode(inviteCode);
					} catch {
						// Silently ignore - user can still join manually later
					}
				}
				router.push(
					withCallbackUrl(
						`/verify-email-pending?email=${encodeURIComponent(formData.email)}`,
						sanitizedCallbackUrl,
					),
				);
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
				const callbackURL =
					sanitizedCallbackUrl || (inviteCode && inviteCodeValid ? `/join/${inviteCode}` : "/");

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
		[inviteCode, inviteCodeValid, sanitizedCallbackUrl, t],
	);

	return (
		<AuthFormWrapper
			className={className}
			formProps={{ noValidate: true, onSubmit: handleSubmit }}
			title={t("auth.create-account", "Create your account")}
			branding={branding}
			{...props}
		>
			{error ? (
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm" role="alert">
					{error}
				</div>
			) : null}

			{/* Show organization info when signing up via invite */}
			{organizationName && (isInvitationSignup || (inviteCode && inviteCodeValid)) && (
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
							aria-describedby={getDescribedBy(fieldErrors.name && getFieldErrorId("name"))}
							aria-invalid={fieldErrors.name ? "true" : "false"}
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
							<p className="text-destructive text-sm" id={getFieldErrorId("name")}>
								{fieldErrors.name}
							</p>
						) : null}
					</div>
					<div className="grid gap-3">
						<Label htmlFor="email">{t("auth.email", "Email")}</Label>
						<Input
							aria-describedby={getDescribedBy(
								isInvitationSignup && "email-invite-note",
								fieldErrors.email && getFieldErrorId("email"),
							)}
							aria-invalid={fieldErrors.email ? "true" : "false"}
							className={isInvitationSignup ? "bg-muted/40 font-medium" : undefined}
							id="email"
							name="email"
							autoComplete="email"
							spellCheck={false}
							readOnly={isInvitationSignup}
							onBlur={(e) => validateField("email", e.target.value)}
							onChange={(e) => handleChange("email", e.target.value)}
							placeholder={t("auth.email-placeholder", "m@example.com")}
							required
							type="email"
							value={formData.email}
						/>
						{isInvitationSignup ? (
							<p className="text-muted-foreground text-sm" id="email-invite-note">
								{t(
									"auth.invited-email-locked",
									"Use the invited email address for this account so you can join the organization automatically.",
								)}
							</p>
						) : null}
						{fieldErrors.email ? (
							<p className="text-destructive text-sm" id={getFieldErrorId("email")}>
								{fieldErrors.email}
							</p>
						) : null}
					</div>
					<div className="grid gap-3 rounded-xl border border-border/80 bg-background/80 p-4">
						<div className="space-y-1">
							<p className="font-medium text-sm">
								{t("auth.secure-password-heading", "Set a secure password")}
							</p>
							<p className="text-muted-foreground text-sm">
								{t(
									"auth.secure-password-description",
									"Use a password you can recognize quickly during busy workdays without compromising security.",
								)}
							</p>
						</div>
						<Label htmlFor="password">{t("auth.password", "Password")}</Label>
						<Input
							aria-describedby={getDescribedBy(
								"password-guidance",
								fieldErrors.password && getFieldErrorId("password"),
							)}
							aria-invalid={fieldErrors.password ? "true" : "false"}
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
							<PasswordRequirementsList
								guidanceId="password-guidance"
								passwordRequirements={passwordRequirements}
								progressLabel={passwordProgressLabel}
								progressMessage={passwordProgressMessage}
								progressTitle={passwordRequirementsTitle}
							/>
						) : null}
						{fieldErrors.password ? (
							<p className="text-destructive text-sm" id={getFieldErrorId("password")}>
								{fieldErrors.password}
							</p>
						) : null}
						<Label htmlFor="confirmPassword">
							{t("auth.confirm-password", "Confirm Password")}
						</Label>
						<Input
							aria-describedby={getDescribedBy(
								"confirm-password-status",
								fieldErrors.confirmPassword && getFieldErrorId("confirmPassword"),
							)}
							aria-invalid={fieldErrors.confirmPassword ? "true" : "false"}
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
							<p className="text-destructive text-sm" id={getFieldErrorId("confirmPassword")}>
								{fieldErrors.confirmPassword}
							</p>
						) : null}
						<PasswordConfirmationStatus
							statusId="confirm-password-status"
							message={passwordConfirmationMessage}
							status={passwordConfirmationStatus}
						/>
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

					<Button className="w-full" disabled={isLoading} type="submit">
						{isLoading ? (
							<>
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
								{t("common.loading", "Loading…")}
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
					<Link
						className="underline underline-offset-4"
						href={withCallbackUrl("/sign-in", sanitizedCallbackUrl)}
					>
						{t("auth.sign-in", "Sign in")}
					</Link>
				</div>
			)}
		</AuthFormWrapper>
	);
}
