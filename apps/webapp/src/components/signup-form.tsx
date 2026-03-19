"use client";

import { IconBuilding, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
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
import { toAuthStructuredName } from "@/lib/auth/derived-user-name";
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
	const form = useForm({
		defaultValues: {
			firstName: "",
			lastName: "",
			email: initialEmail ?? "",
			password: "",
			confirmPassword: "",
		},
		onSubmitInvalid: ({ formApi }) => {
			for (const fieldName of ["firstName", "lastName", "email", "password", "confirmPassword"] as const) {
				if (formApi.getFieldMeta(fieldName)?.errors.length) {
					document.getElementById(fieldName)?.focus();
					break;
				}
			}
		},
		onSubmit: async ({ value }) => {
			setIsLoading(true);

			try {
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

				const structuredName = toAuthStructuredName({
					firstName: value.firstName,
					lastName: value.lastName,
				});

				const signupResult = await authClient.signUp.email({
					email: value.email,
					password: value.password,
					...structuredName,
				});

				if (signupResult.error) {
					setError(signupResult.error.message || t("auth.signup-failed", "Failed to sign up"));
					if (turnstileConfig?.enabled) {
						setTurnstileToken(null);
						turnstileRef.current?.reset();
					}
				} else {
					if (initialInvitationId) {
						try {
							await storePendingInvitation(initialInvitationId, value.email);
						} catch {
							// Ignore and let the user continue manually from the invitation page later.
						}
					}

					if (inviteCode && inviteCodeValid) {
						try {
							await storePendingInviteCode(inviteCode);
						} catch {
							// Silently ignore - user can still join manually later.
						}
					}

					router.push(
						withCallbackUrl(
							`/verify-email-pending?email=${encodeURIComponent(value.email)}`,
							sanitizedCallbackUrl,
						),
					);
				}
			} catch (err) {
				setError(
					err instanceof Error ? err.message : t("common.error-occurred", "An error occurred"),
				);
				if (turnstileConfig?.enabled) {
					setTurnstileToken(null);
					turnstileRef.current?.reset();
				}
			} finally {
				setIsLoading(false);
			}
		},
	});
	const formData = useStore(form.store, (state) => state.values);
	const { enabledProviders, isLoading: providersLoading } = useEnabledProviders();

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

		if (formData.email !== initialEmail) {
			form.setFieldValue("email", initialEmail);
		}
	}, [form, formData.email, initialEmail]);

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

	const getFieldErrorId = (field: string) => `${field}-error`;

	const getDescribedBy = (...ids: Array<string | false | null | undefined>) => {
		const describedBy = ids.filter(Boolean).join(" ");
		return describedBy.length > 0 ? describedBy : undefined;
	};

	const getFieldError = (errors: unknown[]) => {
		const error = errors.find((value) => typeof value === "string");
		return typeof error === "string" ? error : undefined;
	};

	const validatePassword = (value: string) => {
		const result = passwordSchema.safeParse(value);
		if (result.success) {
			return undefined;
		} else {
			return result.error?.issues?.[0]?.message || t("validation.invalid-password", "Invalid password");
		}
	};

	const validateConfirmPassword = (value: string) => {
		if (!value.trim()) {
			return t("auth.confirm-password-required", "Please confirm your password");
		}

		if (value !== formData.password) {
			return t("auth.passwords-no-match", "Passwords do not match");
		}

		return undefined;
	};

	const validateEmail = (value: string) => {
		const result = z.string().email().safeParse(value);
		if (result.success) {
			return undefined;
		} else {
			return t("validation.invalid-email", "Invalid email address");
		}
	};

	const validateFirstName = (value: string) => {
		const result = z.string().min(1).safeParse(value.trim());
		if (result.success) {
			return undefined;
		} else {
			return t("validation.first-name-required", "First Name is required");
		}
	};

	const validateLastName = (value: string) => {
		const result = z.string().min(1).safeParse(value.trim());
		if (result.success) {
			return undefined;
		} else {
			return t("validation.last-name-required", "Last Name is required");
		}
	};

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setError(null);

		if (turnstileConfig?.enabled && !turnstileToken) {
			setError(t("auth.turnstile-required", "Please complete the verification."));
			return;
		}

		await form.handleSubmit();
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
					<div className="grid gap-4 md:grid-cols-2">
						<form.Field
							name="firstName"
							validators={{
								onBlur: ({ value }) => validateFirstName(value),
								onChange: ({ value }) => validateFirstName(value),
								onSubmit: ({ value }) => validateFirstName(value),
							}}
						>
							{(field) => {
								const errorMessage = getFieldError(field.state.meta.errors);
								return (
									<div className="grid gap-3">
										<Label htmlFor="firstName">{t("auth.first-name", "First Name")}</Label>
										<Input
											aria-describedby={getDescribedBy(errorMessage && getFieldErrorId("firstName"))}
											aria-invalid={errorMessage ? "true" : "false"}
										id="firstName"
										name={field.name}
										autoComplete="given-name"
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder={t("auth.first-name-placeholder", "John…")}
										required
										type="text"
										value={field.state.value}
										/>
										{errorMessage ? (
											<p className="text-destructive text-sm" id={getFieldErrorId("firstName")}>
												{errorMessage}
											</p>
										) : null}
									</div>
								);
							}}
						</form.Field>
						<form.Field
							name="lastName"
							validators={{
								onBlur: ({ value }) => validateLastName(value),
								onChange: ({ value }) => validateLastName(value),
								onSubmit: ({ value }) => validateLastName(value),
							}}
						>
							{(field) => {
								const errorMessage = getFieldError(field.state.meta.errors);
								return (
									<div className="grid gap-3">
										<Label htmlFor="lastName">{t("auth.last-name", "Last Name")}</Label>
										<Input
											aria-describedby={getDescribedBy(errorMessage && getFieldErrorId("lastName"))}
											aria-invalid={errorMessage ? "true" : "false"}
										id="lastName"
										name={field.name}
										autoComplete="family-name"
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder={t("auth.last-name-placeholder", "Doe…")}
										required
										type="text"
										value={field.state.value}
										/>
										{errorMessage ? (
											<p className="text-destructive text-sm" id={getFieldErrorId("lastName")}>
												{errorMessage}
											</p>
										) : null}
									</div>
								);
							}}
						</form.Field>
					</div>
					<form.Field
						name="email"
						validators={{
							onBlur: ({ value }) => validateEmail(value),
							onChange: ({ value }) => validateEmail(value),
							onSubmit: ({ value }) => validateEmail(value),
						}}
					>
						{(field) => {
							const errorMessage = getFieldError(field.state.meta.errors);
							return (
								<div className="grid gap-3">
									<Label htmlFor="email">{t("auth.email", "Email")}</Label>
									<Input
										aria-describedby={getDescribedBy(
											isInvitationSignup && "email-invite-note",
											errorMessage && getFieldErrorId("email"),
										)}
										aria-invalid={errorMessage ? "true" : "false"}
										className={isInvitationSignup ? "bg-muted/40 font-medium" : undefined}
										id="email"
										name={field.name}
										autoComplete="email"
										spellCheck={false}
										readOnly={isInvitationSignup}
										onBlur={field.handleBlur}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder={t("auth.email-placeholder", "jane@example.com…")}
										required
										type="email"
										value={field.state.value}
									/>
									{isInvitationSignup ? (
										<p className="text-muted-foreground text-sm" id="email-invite-note">
											{t(
												"auth.invited-email-locked",
												"Use the invited email address for this account so you can join the organization automatically.",
											)}
										</p>
									) : null}
									{errorMessage ? (
										<p className="text-destructive text-sm" id={getFieldErrorId("email")}>
											{errorMessage}
										</p>
									) : null}
								</div>
							);
						}}
					</form.Field>
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
						<form.Field
							name="password"
							validators={{
								onBlur: ({ value }) => validatePassword(value),
								onChange: ({ value }) => validatePassword(value),
								onSubmit: ({ value }) => validatePassword(value),
							}}
						>
							{(field) => {
								const errorMessage = getFieldError(field.state.meta.errors);
								return (
									<>
										<Label htmlFor="password">{t("auth.password", "Password")}</Label>
										<Input
											aria-describedby={getDescribedBy(
												"password-guidance",
												errorMessage && getFieldErrorId("password"),
											)}
											aria-invalid={errorMessage ? "true" : "false"}
											id="password"
											name={field.name}
											autoComplete="new-password"
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											required
											type="password"
											value={field.state.value}
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
										{errorMessage ? (
											<p className="text-destructive text-sm" id={getFieldErrorId("password")}>
												{errorMessage}
											</p>
										) : null}
									</>
								);
							}}
						</form.Field>
						<form.Field
							name="confirmPassword"
							validators={{
								onBlur: ({ value }) => validateConfirmPassword(value),
								onChangeListenTo: ["password"],
								onChange: ({ value }) => validateConfirmPassword(value),
								onSubmit: ({ value }) => validateConfirmPassword(value),
							}}
						>
							{(field) => {
								const errorMessage = getFieldError(field.state.meta.errors);
								return (
									<>
										<Label htmlFor="confirmPassword">
											{t("auth.confirm-password", "Confirm Password")}
										</Label>
										<Input
											aria-describedby={getDescribedBy(
												"confirm-password-status",
												errorMessage && getFieldErrorId("confirmPassword"),
											)}
											aria-invalid={errorMessage ? "true" : "false"}
											id="confirmPassword"
											name={field.name}
											autoComplete="new-password"
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											required
											type="password"
											value={field.state.value}
										/>
										{errorMessage ? (
											<p className="text-destructive text-sm" id={getFieldErrorId("confirmPassword")}>
												{errorMessage}
											</p>
										) : null}
									</>
								);
							}}
						</form.Field>
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
