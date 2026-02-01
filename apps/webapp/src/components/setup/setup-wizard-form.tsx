"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
	IconCheck,
	IconEye,
	IconEyeOff,
	IconLoader2,
	IconLock,
	IconMail,
	IconShieldCheck,
	IconUser,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { createPlatformAdminAction } from "@/app/[locale]/(setup)/setup/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { cn } from "@/lib/utils";

interface SetupWizardFormProps {
	locale: string;
}

type WizardStep = "form" | "creating" | "complete";

// Validation functions (client-side, server validates too)
function validateName(value: string): string | undefined {
	if (!value || value.trim().length < 2) {
		return "Name must be at least 2 characters";
	}
	return undefined;
}

// Hoisted regex for email validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value: string): string | undefined {
	if (!value) {
		return "Email is required";
	}
	if (!EMAIL_REGEX.test(value)) {
		return "Please enter a valid email address";
	}
	return undefined;
}

function validatePassword(value: string): string | undefined {
	if (!value) {
		return "Password is required";
	}
	if (value.length < 12) {
		return "Password must be at least 12 characters";
	}
	if (value.length > 128) {
		return "Password must be at most 128 characters";
	}
	if (!/[A-Z]/.test(value)) {
		return "Password must contain at least one uppercase letter";
	}
	if (!/[a-z]/.test(value)) {
		return "Password must contain at least one lowercase letter";
	}
	if (!/[0-9]/.test(value)) {
		return "Password must contain at least one number";
	}
	return undefined;
}

export function SetupWizardForm({ locale }: SetupWizardFormProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [wizardStep, setWizardStep] = useState<WizardStep>("form");
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createdEmail, setCreatedEmail] = useState<string>("");

	const form = useForm({
		defaultValues: {
			name: "",
			email: "",
			password: "",
			confirmPassword: "",
		},
		onSubmit: async ({ value }) => {
			// Client-side validation
			const nameError = validateName(value.name);
			if (nameError) {
				setError(nameError);
				return;
			}

			const emailError = validateEmail(value.email);
			if (emailError) {
				setError(emailError);
				return;
			}

			const passwordError = validatePassword(value.password);
			if (passwordError) {
				setError(passwordError);
				return;
			}

			if (value.password !== value.confirmPassword) {
				setError(t("setup.error.passwords_mismatch", "Passwords do not match"));
				return;
			}

			setError(null);
			setWizardStep("creating");

			startTransition(async () => {
				const result = await createPlatformAdminAction({
					name: value.name,
					email: value.email,
					password: value.password,
				});

				if (result.success) {
					setCreatedEmail(result.data.email);
					setWizardStep("complete");
				} else {
					setError(result.error);
					setWizardStep("form");
				}
			});
		},
	});

	const handleContinueToSignIn = () => {
		router.push(`/${locale}/sign-in`);
	};

	if (wizardStep === "creating" || isPending) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<IconLoader2 className="size-12 animate-spin text-primary" aria-hidden="true" />
					<p className="mt-4 text-lg font-medium" role="status" aria-live="polite">
						{t("setup.creating_account", "Creating your admin account...")}
					</p>
					<p className="text-sm text-muted-foreground">
						{t("setup.please_wait", "Please wait while we set things up")}
					</p>
				</CardContent>
			</Card>
		);
	}

	if (wizardStep === "complete") {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<div className="flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
						<IconCheck className="size-8 text-green-600 dark:text-green-400" />
					</div>
					<h2 className="mt-4 text-xl font-semibold">
						{t("setup.complete_title", "Setup Complete!")}
					</h2>
					<p className="mt-2 text-center text-muted-foreground">
						{t("setup.complete_message", "Your platform admin account has been created.")}
						<br />
						{t("setup.sign_in_with", "You can now sign in with")}{" "}
						<span className="font-medium">{createdEmail}</span>
					</p>
					<Button onClick={handleContinueToSignIn} className="mt-6 gap-2">
						<IconShieldCheck className="size-4" />
						{t("setup.continue_to_sign_in", "Continue to Sign In")}
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconShieldCheck className="size-5" />
					{t("setup.title", "Create Platform Admin")}
				</CardTitle>
				<CardDescription>
					{t(
						"setup.description",
						"Set up the first administrator account for your platform. This account will have full system access and is separate from organization accounts."
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					{error && (
						<div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
							{error}
						</div>
					)}

					<form.Field
						name="name"
						validators={{
							onChange: ({ value }) => validateName(value),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={field.state.meta.errors.length > 0} required>
									<span className="flex items-center gap-2">
										<IconUser className="size-4" />
										{t("setup.field.name", "Full Name")}
									</span>
								</TFormLabel>
								<TFormControl hasError={field.state.meta.errors.length > 0}>
									<Input
										type="text"
										placeholder={t("setup.field.name_placeholder", "Enter your full name")}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										autoComplete="name"
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Field
						name="email"
						validators={{
							onChange: ({ value }) => validateEmail(value),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={field.state.meta.errors.length > 0} required>
									<span className="flex items-center gap-2">
										<IconMail className="size-4" />
										{t("setup.field.email", "Email Address")}
									</span>
								</TFormLabel>
								<TFormControl hasError={field.state.meta.errors.length > 0}>
									<Input
										type="email"
										placeholder={t("setup.field.email_placeholder", "admin@yourcompany.com")}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										autoComplete="email"
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Field
						name="password"
						validators={{
							onChange: ({ value }) => validatePassword(value),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={field.state.meta.errors.length > 0} required>
									<span className="flex items-center gap-2">
										<IconLock className="size-4" />
										{t("setup.field.password", "Password")}
									</span>
								</TFormLabel>
								<TFormControl hasError={field.state.meta.errors.length > 0}>
									<div className="relative">
										<Input
											type={showPassword ? "text" : "password"}
											placeholder={t("setup.field.password_placeholder", "Create a strong password")}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											autoComplete="new-password"
											className="pr-10"
										/>
										<button
											type="button"
											onClick={() => setShowPassword(!showPassword)}
											className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
											aria-label={showPassword ? t("setup.hide_password", "Hide password") : t("setup.show_password", "Show password")}
										>
											{showPassword ? (
												<IconEyeOff className="size-4" />
											) : (
												<IconEye className="size-4" />
											)}
										</button>
									</div>
								</TFormControl>
								<TFormMessage field={field} />
								<PasswordStrengthIndicator password={field.state.value} />
							</TFormItem>
						)}
					</form.Field>

					<form.Field
						name="confirmPassword"
						validators={{
							onChangeListenTo: ["password"],
							onChange: ({ value, fieldApi }) => {
								if (value !== fieldApi.form.getFieldValue("password")) {
									return t("setup.error.passwords_mismatch", "Passwords do not match");
								}
								return undefined;
							},
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={field.state.meta.errors.length > 0} required>
									<span className="flex items-center gap-2">
										<IconLock className="size-4" />
										{t("setup.field.confirm_password", "Confirm Password")}
									</span>
								</TFormLabel>
								<TFormControl hasError={field.state.meta.errors.length > 0}>
									<div className="relative">
										<Input
											type={showConfirmPassword ? "text" : "password"}
											placeholder={t("setup.field.confirm_password_placeholder", "Confirm your password")}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											autoComplete="new-password"
											className="pr-10"
										/>
										<button
											type="button"
											onClick={() => setShowConfirmPassword(!showConfirmPassword)}
											className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
											aria-label={showConfirmPassword ? t("setup.hide_password", "Hide password") : t("setup.show_password", "Show password")}
										>
											{showConfirmPassword ? (
												<IconEyeOff className="size-4" />
											) : (
												<IconEye className="size-4" />
											)}
										</button>
									</div>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
						{([canSubmit, isSubmitting]) => (
							<Button
								type="submit"
								className="w-full gap-2"
								disabled={!canSubmit || isSubmitting || isPending}
							>
								{isSubmitting || isPending ? (
									<>
										<IconLoader2 className="size-4 animate-spin" />
										{t("setup.button.creating", "Creating Account...")}
									</>
								) : (
									<>
										<IconShieldCheck className="size-4" />
										{t("setup.button.create", "Create Admin Account")}
									</>
								)}
							</Button>
						)}
					</form.Subscribe>
				</form>
			</CardContent>
		</Card>
	);
}

// Hoisted regex for password validation (avoids recreation on every render)
const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const NUMBER_REGEX = /[0-9]/;

function PasswordStrengthIndicator({ password }: { password: string }) {
	const { t } = useTranslate();

	const checks = [
		{ label: t("setup.password.min_length", "12+ characters"), valid: password.length >= 12 },
		{ label: t("setup.password.uppercase", "Uppercase letter"), valid: UPPERCASE_REGEX.test(password) },
		{ label: t("setup.password.lowercase", "Lowercase letter"), valid: LOWERCASE_REGEX.test(password) },
		{ label: t("setup.password.number", "Number"), valid: NUMBER_REGEX.test(password) },
	];

	const validCount = checks.filter((c) => c.valid).length;

	if (password.length === 0) {
		return null;
	}

	return (
		<div className="mt-2 space-y-2">
			<div className="flex gap-1">
				{[1, 2, 3, 4].map((level) => (
					<div
						key={level}
						className={cn(
							"h-1 flex-1 rounded-full transition-colors",
							validCount >= level
								? validCount === 4
									? "bg-green-500"
									: validCount >= 3
										? "bg-yellow-500"
										: "bg-orange-500"
								: "bg-muted",
						)}
					/>
				))}
			</div>
			<div className="grid grid-cols-2 gap-1 text-xs">
				{checks.map((check) => (
					<div
						key={check.label}
						className={cn(
							"flex items-center gap-1",
							check.valid ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
						)}
					>
						{check.valid ? (
							<IconCheck className="size-3" />
						) : (
							<div className="size-3 rounded-full border border-current" />
						)}
						{check.label}
					</div>
				))}
			</div>
		</div>
	);
}
