"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { useTurnstile } from "@/lib/auth/domain-auth-context";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { authClient } from "@/lib/auth-client";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { Link } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";
import { type TurnstileRef, TurnstileWidget } from "./turnstile-widget";

export function ForgotPasswordForm({ className, ...props }: React.ComponentProps<"div">) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

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

	const form = useForm({
		defaultValues: { email: "" },
		onSubmit: async ({ value }) => {
			setError(null);
			setSuccess(false);

			if (turnstileConfig?.enabled && !turnstileToken) {
				setError(t("auth.turnstile-required", "Please complete the verification."));
				return;
			}

			setIsLoading(true);
			await runWithCleanup(
				async () => {
					const response = await authClient
						.requestPasswordReset({
							email: value.email,
							redirectTo: `${window.location.origin}/${locale}/reset-password`,
							...(turnstileToken
								? { fetchOptions: { headers: { "x-captcha-response": turnstileToken } } }
								: {}),
						})
						.catch((err) => ({
							error: {
								message:
									err instanceof Error
										? err.message
										: t("auth.forgot-password-error", "An error occurred. Please try again."),
							},
						}));

					if (response.error) {
						setError(
							getAuthErrorMessage(
								response.error,
								t("auth.forgot-password-error", "Failed to send reset email. Please try again."),
							),
						);
						// Reset Turnstile for retry (tokens are single-use).
						if (turnstileConfig?.enabled) {
							setTurnstileToken(null);
							turnstileRef.current?.reset();
						}
						return;
					}

					setSuccess(true);
				},
				() => setIsLoading(false),
			);
		},
	});
	const validateEmail = ({ value }: { value: string }) =>
		z.email().safeParse(value).success
			? undefined
			: t("validation.invalid-email", "Invalid email address");
	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		event.stopPropagation();
		await form.handleSubmit();
	};

	if (success) {
		return (
			<AuthFormWrapper
				className={className}
				title={t("auth.reset-password-sent", "Reset link sent")}
				{...props}
			>
				<div role="status" className="rounded-md bg-green-500/15 p-3 text-green-600 dark:text-green-400 text-sm">
					{t(
						"auth.reset-password-sent-message",
						"If an account exists with that email, we've sent a password reset link.",
					)}
				</div>
				<div className="text-center text-sm">
					<Link className="underline underline-offset-4" href="/sign-in">
						{t("info.back-to-login", "Back to login")}
					</Link>
				</div>
			</AuthFormWrapper>
		);
	}

	return (
		<AuthFormWrapper
			className={className}
			formProps={{ onSubmit: handleSubmit }}
			title={t("auth.reset-your-password", "Reset your password")}
			{...props}
		>
			<p className="text-balance text-muted-foreground text-center text-sm">
				{t(
					"auth.enter-email-reset",
					"Enter your email address and we'll send you a link to reset your password.",
				)}
			</p>
			{error ? (
				<div role="alert" className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">{error}</div>
			) : null}
			<form.Field name="email" validators={{ onBlur: validateEmail, onChange: validateEmail }}>
				{(field) => (
					<TFormItem className="gap-3">
						<TFormLabel hasError={fieldHasError(field)}>{t("auth.email", "Email")}</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name={field.name}
								autoComplete="email"
								spellCheck={false}
								onBlur={field.handleBlur}
								onChange={(event) => {
									field.handleChange(event.target.value);
									setError(null);
								}}
								placeholder={t("auth.email-placeholder", "m@example.com")}
								required
								type="email"
								value={field.state.value}
							/>
						</TFormControl>
						<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>

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
						<IconLoader2 className="mr-2 size-4 animate-spin" />
						{t("common.loading", "Loading...")}
					</>
				) : (
					t("auth.send-reset-link", "Send reset link")
				)}
			</Button>
			<div className="text-center text-sm">
				{t("auth.remember-password", "Remember your password?")}{" "}
				<Link className="underline underline-offset-4" href="/sign-in">
					{t("auth.sign-in", "Sign in")}
				</Link>
			</div>
		</AuthFormWrapper>
	);
}
