"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { z } from "zod";
import {
	PasswordStrengthIndicator,
	PasswordVisibilityInput,
} from "@/components/auth/password-fields";
import { Button } from "@/components/ui/button";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { authClient } from "@/lib/auth-client";
import { passwordSchema } from "@/lib/validations/password";
import { Link } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";
import { AuthContentLoading } from "./shells/auth-content-loading";

const resetPasswordSchema = z
	.object({
		password: passwordSchema,
		confirmPassword: z.string().min(1, "Please confirm your password"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type Translate = ReturnType<typeof useTranslate>["t"];
type WrapperProps = React.ComponentProps<"div">;

function getFieldError(errors: unknown[]): string | undefined {
	const error = errors[0];
	if (typeof error === "string") {
		return error;
	}
	if (error && typeof error === "object" && "message" in error) {
		return String(error.message);
	}
	return undefined;
}

function validateResetPasswordField(
	values: { password: string; confirmPassword: string },
	field: "password" | "confirmPassword",
) {
	const result = resetPasswordSchema.safeParse(values);
	if (result.success) {
		return undefined;
	}
	return result.error.issues.reduce<string | undefined>(
		(message, issue) => (issue.path[0] === field ? issue.message : message),
		undefined,
	);
}

function ResetLinkError({
	className,
	message,
	t,
	...props
}: WrapperProps & { message: string; t: Translate }) {
	return (
		<AuthFormWrapper
			className={className}
			title={t("auth.reset-password-invalid", "Invalid reset link")}
			{...props}
		>
			<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">
				{message}
			</div>
			<div className="text-center text-sm">
				<Link className="underline underline-offset-4" href="/forgot-password">
					{t("auth.request-new-reset", "Request a new reset link")}
				</Link>
			</div>
		</AuthFormWrapper>
	);
}

function ResetPasswordSuccess({
	className,
	t,
	...props
}: WrapperProps & { t: Translate }) {
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

function useResetPasswordForm(token: string, t: Translate) {
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const form = useForm({
		defaultValues: { password: "", confirmPassword: "" },
		onSubmit: async ({ value }) => {
			setError(null);
			const response = await authClient
				.resetPassword({ newPassword: value.password, token })
				.catch((caughtError) => ({
					error: {
						message:
							caughtError instanceof Error
								? caughtError.message
								: t(
										"auth.reset-password-error",
										"An error occurred. Please try again.",
									),
					},
				}));

			if (response.error) {
				setError(
					getAuthErrorMessage(
						response.error,
						t(
							"auth.reset-password-failed",
							"Failed to reset password. Please try again.",
						),
					),
				);
				return;
			}
			setSuccess(true);
		},
	});

	return { clearError: () => setError(null), error, form, success };
}

type ResetPasswordController = ReturnType<typeof useResetPasswordForm>;

function NewPasswordField({
	controller,
	t,
}: {
	controller: ResetPasswordController;
	t: Translate;
}) {
	return (
		<controller.form.Field
			name="password"
			validators={{
				onChange: passwordSchema,
				onSubmit: ({ value }) =>
					validateResetPasswordField(
						{
							password: value,
							confirmPassword: controller.form.getFieldValue("confirmPassword"),
						},
						"password",
					),
			}}
		>
			{(field) => {
				const error = getFieldError(field.state.meta.errors);
				return (
					<TFormItem className="gap-3">
						<TFormLabel hasError={Boolean(error)}>
							{t("auth.new-password", "New Password")}
						</TFormLabel>
						<TFormControl hasError={Boolean(error)}>
							<PasswordVisibilityInput
								name={field.name}
								autoComplete="new-password"
								onBlur={field.handleBlur}
								onChange={(event) => {
									field.handleChange(event.target.value);
									controller.clearError();
								}}
								required
								value={field.state.value}
							/>
						</TFormControl>
						<PasswordStrengthIndicator password={field.state.value} />
						<TFormMessage>{error}</TFormMessage>
					</TFormItem>
				);
			}}
		</controller.form.Field>
	);
}

function ConfirmPasswordField({
	controller,
	t,
}: {
	controller: ResetPasswordController;
	t: Translate;
}) {
	return (
		<controller.form.Field
			name="confirmPassword"
			validators={{
				onChangeListenTo: ["password"],
				onChange: ({ value }) =>
					value === controller.form.getFieldValue("password")
						? undefined
						: t("auth.passwords-no-match", "Passwords do not match"),
				onSubmit: ({ value }) =>
					validateResetPasswordField(
						{
							password: controller.form.getFieldValue("password"),
							confirmPassword: value,
						},
						"confirmPassword",
					),
			}}
		>
			{(field) => {
				const error = getFieldError(field.state.meta.errors);
				return (
					<TFormItem className="gap-3">
						<TFormLabel hasError={Boolean(error)}>
							{t("auth.confirm-new-password", "Confirm New Password")}
						</TFormLabel>
						<TFormControl hasError={Boolean(error)}>
							<PasswordVisibilityInput
								name={field.name}
								autoComplete="new-password"
								onBlur={field.handleBlur}
								onChange={(event) => {
									field.handleChange(event.target.value);
									controller.clearError();
								}}
								required
								value={field.state.value}
							/>
						</TFormControl>
						<TFormMessage>{error}</TFormMessage>
					</TFormItem>
				);
			}}
		</controller.form.Field>
	);
}

function ResetPasswordEditor({
	className,
	t,
	token,
	...props
}: WrapperProps & { t: Translate; token: string }) {
	const controller = useResetPasswordForm(token, t);

	if (controller.success) {
		return <ResetPasswordSuccess className={className} t={t} {...props} />;
	}

	return (
		<AuthFormWrapper
			className={className}
			formProps={{
				onSubmit: (event) => {
					event.preventDefault();
					controller.form.handleSubmit();
				},
			}}
			title={t("auth.reset-your-password", "Reset your password")}
			{...props}
		>
			<p className="text-balance text-muted-foreground text-center text-sm">
				{t("auth.enter-new-password", "Enter your new password below.")}
			</p>
			{controller.error ? (
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">
					{controller.error}
				</div>
			) : null}
			<NewPasswordField controller={controller} t={t} />
			<ConfirmPasswordField controller={controller} t={t} />
			<controller.form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button className="w-full" disabled={isSubmitting} type="submit">
						{isSubmitting ? (
							<>
								<IconLoader2 className="mr-2 size-4 animate-spin" />
								{t("common.loading", "Loading…")}
							</>
						) : (
							t("auth.reset-password-button", "Reset Password")
						)}
					</Button>
				)}
			</controller.form.Subscribe>
			<div className="text-center text-sm">
				{t("auth.remember-password", "Remember your password?")}{" "}
				<Link className="underline underline-offset-4" href="/sign-in">
					{t("auth.sign-in", "Sign in")}
				</Link>
			</div>
		</AuthFormWrapper>
	);
}

function ResetPasswordFormContent(props: WrapperProps) {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const token = searchParams.get("token");

	if (searchParams.get("error") === "INVALID_TOKEN") {
		return (
			<ResetLinkError
				message={t(
					"auth.reset-password-invalid-message",
					"This password reset link is invalid or has expired. Please request a new one.",
				)}
				t={t}
				{...props}
			/>
		);
	}

	if (!token) {
		return (
			<ResetLinkError
				message={t(
					"auth.reset-password-no-token-message",
					"No reset token found. Please request a new password reset link.",
				)}
				t={t}
				{...props}
			/>
		);
	}

	return <ResetPasswordEditor t={t} token={token} {...props} />;
}

export function ResetPasswordForm(props: WrapperProps) {
	return (
		<Suspense fallback={<AuthContentLoading />}>
			<ResetPasswordFormContent {...props} />
		</Suspense>
	);
}
