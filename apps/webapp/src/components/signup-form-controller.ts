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
	validatePasswordConfirmation,
	validateStrongPassword,
} from "@/components/auth/password-validation";
import { sanitizeCallbackUrl, withCallbackUrl } from "@/lib/auth/callback-url";
import { toAuthStructuredName } from "@/lib/auth/derived-user-name";
import { useDomainAuth, useTurnstile } from "@/lib/auth/domain-auth-context";
import { authClient } from "@/lib/auth-client";
import { useEnabledProviders } from "@/lib/hooks/use-enabled-providers";
import type { SocialProviderId } from "@/lib/social-providers";
import { verifyTurnstileWithServer } from "@/lib/turnstile/verify";
import { useRouter } from "@/navigation";
import type { TurnstileRef } from "./turnstile-widget";

export interface SignupFormProps extends React.ComponentProps<"div"> {
	callbackUrl?: string;
	initialEmail?: string;
	initialInvitationId?: string;
	initialOrganizationName?: string;
	inviteCode?: string;
}

export function useSignupFormController({
	callbackUrl,
	initialEmail,
	initialInvitationId,
	initialOrganizationName,
	inviteCode,
}: SignupFormProps) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const sanitizedCallbackUrl = sanitizeCallbackUrl(callbackUrl, "");
	const [isLoading, setIsLoading] = useState(false);
	const stopLoading = () => setIsLoading(false);
	const [error, setError] = useState<string | null>(null);
	const turnstileConfig = useTurnstile();
	const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
	const turnstileRef = useRef<TurnstileRef>(null);
	const [inviteCodeState, setInviteCodeState] = useState<{
		code: string | null;
		organizationName: string | null;
		valid: boolean | null;
	}>({ code: inviteCode ?? null, organizationName: null, valid: null });
	const inviteCodeValid =
		inviteCodeState.code === (inviteCode ?? null)
			? inviteCodeState.valid
			: null;
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
						setError(
							verifyResult.error ||
								t("auth.turnstile-failed", "Verification failed."),
						);
						setTurnstileToken(null);
						turnstileRef.current?.reset();
						stopLoading();
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
					setError(
						signupResult.error.message ||
							t("auth.signup-failed", "Failed to sign up"),
					);
					if (turnstileConfig?.enabled) {
						setTurnstileToken(null);
						turnstileRef.current?.reset();
					}
					stopLoading();
				} else {
					if (initialInvitationId) {
						try {
							await storePendingInvitation(initialInvitationId, value.email);
						} catch {
							// The invitation page remains a safe manual fallback.
						}
					}
					if (inviteCode && inviteCodeValid) {
						try {
							await storePendingInviteCode(inviteCode);
						} catch {
							// The user can still join manually later.
						}
					}
					push(
						withCallbackUrl(
							`/verify-email-pending?email=${encodeURIComponent(value.email)}`,
							sanitizedCallbackUrl,
						),
					);
				}
			} catch (caught) {
				setError(
					caught instanceof Error
						? caught.message
						: t("common.error-occurred", "An error occurred"),
				);
				if (turnstileConfig?.enabled) {
					setTurnstileToken(null);
					turnstileRef.current?.reset();
				}
				queueMicrotask(stopLoading);
			}
		},
	});
	const formData = useStore(form.store, (state) => state.values);
	const { enabledProviders, isLoading: providersLoading } =
		useEnabledProviders();

	useEffect(() => {
		let cancelled = false;
		if (!inviteCode) return;

		void validateInviteCode(inviteCode)
			.then((result) => {
				if (cancelled) return;
				if (result.success && result.data?.valid) {
					setInviteCodeState({
						code: inviteCode,
						organizationName:
							result.data.inviteCode?.organization?.name || null,
						valid: true,
					});
				} else {
					setInviteCodeState({
						code: inviteCode,
						organizationName: null,
						valid: false,
					});
				}
			})
			.catch(() => {
				if (cancelled) return;
				setInviteCodeState({
					code: inviteCode,
					organizationName: null,
					valid: false,
				});
			});
		return () => {
			cancelled = true;
		};
	}, [inviteCode]);

	const showEmailPassword = authConfig?.emailPasswordEnabled ?? true;
	const allowedSocialProviders = authConfig?.socialProvidersEnabled ?? [];
	const allowedSocialProviderSet = new Set(allowedSocialProviders);
	const filteredProviders =
		allowedSocialProviders.length === 0
			? enabledProviders
			: enabledProviders.filter((provider) =>
					allowedSocialProviderSet.has(provider.id),
				);
	const validatePassword = (value: string) => validateStrongPassword(value, t);
	const validateConfirmPassword = (value: string) =>
		validatePasswordConfirmation(value, formData.password, t);
	const validateEmail = (value: string) =>
		z.email().safeParse(value).success
			? undefined
			: t("validation.invalid-email", "Invalid email address");
	const validateFirstName = (value: string) =>
		z.string().min(1).safeParse(value.trim()).success
			? undefined
			: t("validation.first-name-required", "First Name is required");
	const validateLastName = (value: string) =>
		z.string().min(1).safeParse(value.trim()).success
			? undefined
			: t("validation.last-name-required", "Last Name is required");

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		event.stopPropagation();
		setError(null);
		if (turnstileConfig?.enabled && !turnstileToken) {
			setError(
				t("auth.turnstile-required", "Please complete the verification."),
			);
			return;
		}
		await form.handleSubmit();
	};
	const handleSocialSignup = async (provider: SocialProviderId) => {
		setIsLoading(true);
		setError(null);
		try {
			const callbackURL =
				sanitizedCallbackUrl ||
				(inviteCode && inviteCodeValid ? `/join/${inviteCode}` : "/");
			await authClient.signIn.social({ provider, callbackURL });
		} catch (caught) {
			setIsLoading(false);
			setError(
				caught instanceof Error
					? caught.message
					: t(
							"auth.social-signup-error",
							"An error occurred during social sign-up",
						),
			);
		}
	};

	return {
		branding,
		displayedOrganizationName:
			initialOrganizationName ??
			(inviteCodeState.code === (inviteCode ?? null)
				? inviteCodeState.organizationName
				: null),
		error,
		filteredProviders,
		form,
		formData,
		handleSocialSignup,
		handleSubmit,
		handleTurnstileError: () => {
			setTurnstileToken(null);
			setError(
				t("auth.turnstile-error", "Verification failed. Please try again."),
			);
			turnstileRef.current?.reset();
		},
		handleTurnstileExpire: () => {
			setTurnstileToken(null);
			turnstileRef.current?.reset();
		},
		handleTurnstileTimeout: () => {
			setTurnstileToken(null);
			turnstileRef.current?.reset();
		},
		handleTurnstileVerify: setTurnstileToken,
		inviteCodeValid,
		isInvitationSignup: Boolean(initialEmail),
		isLoading,
		providersLoading,
		sanitizedCallbackUrl,
		showEmailPassword,
		t,
		turnstileConfig,
		turnstileRef,
		validateConfirmPassword,
		validateEmail,
		validateFirstName,
		validateLastName,
		validatePassword,
	};
}

export type SignupController = ReturnType<typeof useSignupFormController>;
