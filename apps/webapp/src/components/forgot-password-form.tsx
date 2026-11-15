"use client";

import { IconLoader2, IconMail } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useCallback, useRef, useState } from "react";
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
import { useBranding, useTurnstile } from "@/lib/auth/domain-auth-context";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { loadAuthPageClient } from "@/lib/auth/load-auth-page-client";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { Link } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";
import { type TurnstileRef, TurnstileWidget } from "./turnstile-widget";

export function ForgotPasswordForm({
	className,
	...props
}: React.ComponentProps<"div">) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage();
	const branding = useBranding();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const emailRef = useRef<HTMLInputElement>(null);
	const submittingRef = useRef(false);
	const focusOutcome = useCallback(
		(node: HTMLDivElement | null) => node?.focus(),
		[],
	);

	// Turnstile state
	const turnstileConfig = useTurnstile();
	const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
	const currentTurnstileToken = useRef<string | null>(null);
	const turnstileRef = useRef<TurnstileRef>(null);
	const updateTurnstileToken = (token: string | null) => {
		currentTurnstileToken.current = token;
		setTurnstileToken(token);
	};

	const handleTurnstileVerify = (token: string) => {
		updateTurnstileToken(token);
	};

	const handleTurnstileError = () => {
		updateTurnstileToken(null);
		setError(
			t("auth.turnstile-error", "Verification failed. Please try again."),
		);
		turnstileRef.current?.reset();
	};

	const handleTurnstileExpire = () => {
		updateTurnstileToken(null);
		turnstileRef.current?.reset();
	};

	const handleTurnstileTimeout = () => {
		updateTurnstileToken(null);
		turnstileRef.current?.reset();
	};

	const form = useForm({
		defaultValues: { email: "" },
		onSubmit: async ({ value }) => {
			setError(null);
			setSuccess(false);

			if (turnstileConfig?.enabled && !currentTurnstileToken.current) {
				setError(
					t("auth.turnstile-required", "Please complete the verification."),
				);
				return;
			}

			setIsLoading(true);
			await runWithCleanup(
				async () => {
					const response = await loadAuthPageClient()
						.then((authClient) => {
							// Widget callbacks can refresh or expire the token during the lazy import.
							const token = currentTurnstileToken.current;
							if (turnstileConfig?.enabled && !token) {
								throw new Error(
									t(
										"auth.turnstile-required",
										"Please complete the verification.",
									),
								);
							}
							return authClient.requestPasswordReset({
								email: value.email,
								redirectTo: `${window.location.origin}/${locale}/reset-password`,
								...(token
									? {
											fetchOptions: {
												headers: { "x-captcha-response": token },
											},
										}
									: {}),
							});
						})
						.catch((err) => ({
							error: {
								message:
									err instanceof Error
										? err.message
										: t(
												"auth.forgot-password-error",
												"An error occurred. Please try again.",
											),
							},
						}));

					if (response.error) {
						setError(
							getAuthErrorMessage(
								response.error,
								t(
									"auth.forgot-password-error",
									"Failed to send reset email. Please try again.",
								),
							),
						);
						// Reset Turnstile for retry (tokens are single-use).
						if (turnstileConfig?.enabled) {
							updateTurnstileToken(null);
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
		// Native requestSubmit can re-enter before the disabled button renders.
		if (submittingRef.current) return;
		submittingRef.current = true;
		await runWithCleanup(
			async () => {
				await form.handleSubmit();
				if (!form.state.isValid) emailRef.current?.focus();
			},
			() => {
				submittingRef.current = false;
			},
		);
	};

	if (success) {
		return (
			<AuthFormWrapper
				branding={branding}
				className={className}
				title={t("auth.reset-password-sent", "Reset link sent")}
				{...props}
			>
				<div
					role="status"
					tabIndex={-1}
					ref={focusOutcome}
					className="flex items-start gap-3 rounded-lg border bg-muted/50 p-4 text-sm leading-relaxed outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
				>
					<IconMail
						aria-hidden="true"
						className="mt-0.5 size-5 shrink-0 text-primary"
					/>
					<p>
						{t(
							"auth.reset-password-sent-message",
							"If an account exists with that email, we've sent a password reset link.",
						)}
					</p>
				</div>
				<div className="text-center text-sm">
					<Link
						className="rounded-sm underline underline-offset-4 outline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
						href="/sign-in"
					>
						{t("info.back-to-login", "Back to login")}
					</Link>
				</div>
			</AuthFormWrapper>
		);
	}

	return (
		<AuthFormWrapper
			branding={branding}
			className={className}
			formProps={{
				onSubmit: handleSubmit,
				noValidate: true,
				"aria-busy": isLoading,
			}}
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
				<div
					role="alert"
					className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm break-words"
				>
					{error}
				</div>
			) : null}
			<form.Field
				name="email"
				validators={{
					onBlur: validateEmail,
					onChange: validateEmail,
					onSubmit: validateEmail,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("auth.email", "Email")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								ref={emailRef}
								disabled={isLoading}
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
				className="h-auto min-h-10 w-full whitespace-normal"
				disabled={isLoading || (turnstileConfig?.enabled && !turnstileToken)}
				type="submit"
			>
				{isLoading ? (
					<>
						<IconLoader2
							aria-hidden="true"
							className="size-4 animate-spin motion-reduce:animate-none"
						/>
						{t("auth.forgot-password-sending", "Sending reset link…")}
					</>
				) : (
					t("auth.send-reset-link", "Send reset link")
				)}
			</Button>
			<div role="status" className="sr-only">
				{isLoading
					? t("auth.forgot-password-sending", "Sending reset link…")
					: null}
			</div>
			<div className="text-center text-sm">
				{t("auth.remember-password", "Remember your password?")}{" "}
				<Link
					className="rounded-sm underline underline-offset-4 outline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
					href="/sign-in"
				>
					{t("auth.sign-in", "Sign in")}
				</Link>
			</div>
		</AuthFormWrapper>
	);
}
