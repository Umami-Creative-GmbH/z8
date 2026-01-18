"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { checkPasswordRequirements, passwordSchema } from "@/lib/validations/password";
import { Link, useRouter } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";

const resetPasswordSchema = z
	.object({
		password: passwordSchema,
		confirmPassword: z.string().min(1, "Please confirm your password"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

export function ResetPasswordForm({ className, ...props }: React.ComponentProps<"div">) {
	const { t } = useTranslate();
	const router = useRouter();
	const searchParams = useSearchParams();

	const token = searchParams.get("token");
	const errorParam = searchParams.get("error");

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const [formData, setFormData] = useState({
		password: "",
		confirmPassword: "",
	});
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const passwordRequirements = checkPasswordRequirements(formData.password, t);
	const passwordsMatch =
		formData.confirmPassword && formData.password && formData.confirmPassword === formData.password;

	const handleChange = (field: string, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		if (fieldErrors[field]) {
			setFieldErrors((prev) => {
				const newErrors = { ...prev };
				delete newErrors[field];
				return newErrors;
			});
		}
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

	const validateField = (field: string, value: string) => {
		switch (field) {
			case "password":
				validatePassword(value);
				break;
			case "confirmPassword":
				validateConfirmPassword(value);
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

		const result = resetPasswordSchema.safeParse(formData);

		if (!result.success) {
			handleValidationErrors(result.error);
			setIsLoading(false);
			return;
		}

		if (!token) {
			setError(t("auth.reset-password-no-token", "Invalid reset link. Please request a new one."));
			setIsLoading(false);
			return;
		}

		try {
			const response = await authClient.resetPassword({
				newPassword: formData.password,
				token,
			});

			if (response.error) {
				setError(
					response.error.message ||
						t("auth.reset-password-failed", "Failed to reset password. Please try again."),
				);
			} else {
				setSuccess(true);
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t("auth.reset-password-error", "An error occurred. Please try again."),
			);
		} finally {
			setIsLoading(false);
		}
	};

	// Show error state for invalid/expired token
	if (errorParam === "INVALID_TOKEN") {
		return (
			<AuthFormWrapper
				className={className}
				title={t("auth.reset-password-invalid", "Invalid reset link")}
				{...props}
			>
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">
					{t(
						"auth.reset-password-invalid-message",
						"This password reset link is invalid or has expired. Please request a new one.",
					)}
				</div>
				<div className="text-center text-sm">
					<Link className="underline underline-offset-4" href="/forgot-password">
						{t("auth.request-new-reset", "Request a new reset link")}
					</Link>
				</div>
			</AuthFormWrapper>
		);
	}

	// Show success state after password reset
	if (success) {
		return (
			<AuthFormWrapper
				className={className}
				title={t("auth.password-reset-success", "Password reset successful")}
				{...props}
			>
				<div className="rounded-md bg-green-500/15 p-3 text-green-600 dark:text-green-400 text-sm">
					{t(
						"auth.password-reset-success-message",
						"Your password has been reset successfully. You can now sign in with your new password.",
					)}
				</div>
				<Button asChild className="w-full">
					<Link href="/sign-in">{t("auth.sign-in", "Sign in")}</Link>
				</Button>
			</AuthFormWrapper>
		);
	}

	// Show error if no token provided
	if (!token) {
		return (
			<AuthFormWrapper
				className={className}
				title={t("auth.reset-password-invalid", "Invalid reset link")}
				{...props}
			>
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">
					{t(
						"auth.reset-password-no-token-message",
						"No reset token found. Please request a new password reset link.",
					)}
				</div>
				<div className="text-center text-sm">
					<Link className="underline underline-offset-4" href="/forgot-password">
						{t("auth.request-new-reset", "Request a new reset link")}
					</Link>
				</div>
			</AuthFormWrapper>
		);
	}

	// Show reset password form
	return (
		<AuthFormWrapper
			className={className}
			formProps={{ onSubmit: handleSubmit }}
			title={t("auth.reset-your-password", "Reset your password")}
			{...props}
		>
			<p className="text-balance text-muted-foreground text-center text-sm">
				{t("auth.enter-new-password", "Enter your new password below.")}
			</p>
			{error ? (
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">{error}</div>
			) : null}
			<div className="grid gap-3">
				<Label htmlFor="password">{t("auth.new-password", "New Password")}</Label>
				<Input
					id="password"
					name="password"
					autoComplete="new-password"
					onBlur={(e) => validateField("password", e.target.value)}
					onChange={(e) => {
						handleChange("password", e.target.value);
						validateField("password", e.target.value);
					}}
					required
					type="password"
					value={formData.password}
				/>
				{formData.password ? (
					<div className="space-y-1.5 text-sm">
						{passwordRequirements.map((req) => (
							<div
								className={cn(
									"flex items-center gap-2",
									req.met ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
								)}
								key={req.label}
							>
								<span className={cn(req.met ? "text-green-600" : "text-muted-foreground")}>
									{req.met ? "✓" : "○"}
								</span>
								<span>{req.label}</span>
							</div>
						))}
					</div>
				) : null}
				{fieldErrors.password ? (
					<p className="text-destructive text-sm">{fieldErrors.password}</p>
				) : null}
			</div>
			<div className="grid gap-3">
				<Label htmlFor="confirmPassword">
					{t("auth.confirm-new-password", "Confirm New Password")}
				</Label>
				<Input
					id="confirmPassword"
					name="confirmPassword"
					autoComplete="new-password"
					onBlur={(e) => validateField("confirmPassword", e.target.value)}
					onChange={(e) => {
						handleChange("confirmPassword", e.target.value);
						validateField("confirmPassword", e.target.value);
					}}
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
			<Button className="w-full" disabled={isLoading} type="submit">
				{isLoading ? (
					<>
						<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
						{t("common.loading", "Loading...")}
					</>
				) : (
					t("auth.reset-password-button", "Reset Password")
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
