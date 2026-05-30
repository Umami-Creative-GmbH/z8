"use client";

import { IconBuilding, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { storePendingInvitation } from "@/app/[locale]/(auth)/invitation-actions";
import {
	storePendingInviteCode,
	validateInviteCode,
} from "@/app/[locale]/(auth)/invite-code-actions";
import {
	PasswordStrengthIndicator,
	PasswordVisibilityInput,
} from "@/components/auth/password-fields";
import {
	validatePasswordConfirmation,
	validateStrongPassword,
} from "@/components/auth/password-validation";
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
import { Link, useRouter } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";
import { type TurnstileRef, TurnstileWidget } from "./turnstile-widget";

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

type SignupSocialAuthProps = {
	showEmailPassword: boolean;
	filteredProviders: SocialProvider[];
	providersLoading: boolean;
	isLoading: boolean;
	onSocialSignup: (provider: SocialProviderId) => void;
};

const SignupSocialAuth = function SignupSocialAuth({
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
										<provider.icon aria-hidden="true" className="size-4" />
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
};

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
	const { push } = useRouter();
	const sanitizedCallbackUrl = sanitizeCallbackUrl(callbackUrl, "");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Turnstile state
	const turnstileConfig = useTurnstile();
	const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
	const turnstileRef = useRef<TurnstileRef>(null);

	const handleTurnstileVerify = (token: string) => {
		setTurnstileToken(token);
	};

	const handleTurnstileError = () => {
		setTurnstileToken(null);
		setError(t("auth.turnstile-error", "Verification failed. Please try again."));
		turnstileRef.current?.reset();
	};

	const handleTurnstileExpire = () => {
		setTurnstileToken(null);
		turnstileRef.current?.reset();
	};

	const handleTurnstileTimeout = () => {
		setTurnstileToken(null);
		turnstileRef.current?.reset();
	};

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
			for (const fieldName of [
				"firstName",
				"lastName",
				"email",
				"password",
				"confirmPassword",
			] as const) {
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

					push(
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
	const displayedOrganizationName = initialOrganizationName ?? organizationName;

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

	// Determine which auth methods are enabled
	const showEmailPassword = authConfig?.emailPasswordEnabled ?? true;
	const allowedSocialProviders = authConfig?.socialProvidersEnabled ?? [];

	// Filter social providers based on auth config
	const filteredProviders = (() => {
		if (allowedSocialProviders.length === 0) {
			return enabledProviders;
		}

		return enabledProviders.filter((provider) => allowedSocialProviders.includes(provider.id));
	})();
	const getFieldErrorId = (field: string) => `${field}-error`;

	const getDescribedBy = (...ids: Array<string | false | null | undefined>) => {
		const describedBy = ids.filter(Boolean).join(" ");
		return describedBy.length > 0 ? describedBy : undefined;
	};

	const getFieldError = (errors: unknown[]) => {
		const error = errors.find((value) => typeof value === "string");
		return typeof error === "string" ? error : undefined;
	};

	const validatePassword = (value: string) => validateStrongPassword(value, t);

	const validateConfirmPassword = (value: string) =>
		validatePasswordConfirmation(value, formData.password, t);

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

	const handleSocialSignup = async (provider: SocialProviderId) => {
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
	};

	return (
		<AuthFormWrapper
			backHref="/sign-in"
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
			{displayedOrganizationName && (isInvitationSignup || (inviteCode && inviteCodeValid)) && (
				<Alert className="border-primary/20 bg-primary/5">
					<IconBuilding className="size-4" />
					<AlertDescription>
						{t("auth.signing-up-to-join", "You're signing up to join {organization}", {
							organization: displayedOrganizationName,
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
											aria-describedby={getDescribedBy(
												errorMessage && getFieldErrorId("firstName"),
											)}
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
										<PasswordVisibilityInput
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
											placeholder={t(
												"setup:setup.field.password_placeholder",
												"Create a strong password",
											)}
											required
											value={field.state.value}
										/>
										<PasswordStrengthIndicator
											id="password-guidance"
											password={formData.password}
										/>
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
										<PasswordVisibilityInput
											aria-describedby={getDescribedBy(
												errorMessage && getFieldErrorId("confirmPassword"),
											)}
											aria-invalid={errorMessage ? "true" : "false"}
											id="confirmPassword"
											name={field.name}
											autoComplete="new-password"
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											placeholder={t(
												"setup:setup.field.confirm_password_placeholder",
												"Confirm your password",
											)}
											required
											value={field.state.value}
										/>
										{errorMessage ? (
											<p
												className="text-destructive text-sm"
												id={getFieldErrorId("confirmPassword")}
											>
												{errorMessage}
											</p>
										) : null}
									</>
								);
							}}
						</form.Field>
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
								<IconLoader2 className="mr-2 size-4 animate-spin" />
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
