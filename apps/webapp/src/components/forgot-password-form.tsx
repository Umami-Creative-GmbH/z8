"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTurnstile } from "@/lib/auth/domain-auth-context";
import { authClient } from "@/lib/auth-client";
import { verifyTurnstileWithServer } from "@/lib/turnstile/verify";
import { Link } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";
import { type TurnstileRef, TurnstileWidget } from "./turnstile-widget";

const forgotPasswordSchema = z.object({
	email: z.string().email("Invalid email address"),
});

export function ForgotPasswordForm({ className, ...props }: React.ComponentProps<"div">) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [formData, setFormData] = useState({
		email: "",
	});
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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

	const validateField = (field: string, value: string) => {
		switch (field) {
			case "email":
				validateEmail(value);
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
		setSuccess(false);

		const result = forgotPasswordSchema.safeParse(formData);

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

		// Verify Turnstile token server-side if enabled
		if (turnstileConfig?.enabled && turnstileToken) {
			const verifyResult = await verifyTurnstileWithServer(turnstileToken).catch(() => null);
			if (!verifyResult || !verifyResult.success) {
				setError(verifyResult?.error || t("auth.turnstile-failed", "Verification failed."));
				setTurnstileToken(null);
				turnstileRef.current?.reset();
				setIsLoading(false);
				return;
			}
		}

		// Better Auth forgot password API
		const response = await authClient
			.requestPasswordReset({
				email: formData.email,
				redirectTo: `${window.location.origin}/${locale}/reset-password`,
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
				response.error.message ||
					t("auth.forgot-password-error", "Failed to send reset email. Please try again."),
			);
			// Reset Turnstile for retry (tokens are single-use)
			if (turnstileConfig?.enabled) {
				setTurnstileToken(null);
				turnstileRef.current?.reset();
			}
			setIsLoading(false);
			return;
		}

		setSuccess(true);
		setIsLoading(false);
	};

	if (success) {
		return (
			<AuthFormWrapper
				className={className}
				title={t("auth.reset-password-sent", "Reset link sent")}
				{...props}
			>
				<div className="rounded-md bg-green-500/15 p-3 text-green-600 dark:text-green-400 text-sm">
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
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">{error}</div>
			) : null}
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
				{fieldErrors.email ? <p className="text-destructive text-sm">{fieldErrors.email}</p> : null}
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
