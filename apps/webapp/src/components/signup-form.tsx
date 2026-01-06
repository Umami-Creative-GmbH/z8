"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/navigation";
import { AuthFormWrapper } from "./auth-form-wrapper";

// Regex patterns defined at top level for performance
const HAS_LOWERCASE = /[a-z]/;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_DIGIT = /\d/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

const passwordSchema = z
	.string()
	.min(8, "Password must be at least 8 characters")
	.refine(
		(password) => HAS_LOWERCASE.test(password),
		"Password must contain at least one lowercase letter",
	)
	.refine(
		(password) => HAS_UPPERCASE.test(password),
		"Password must contain at least one uppercase letter",
	)
	.refine((password) => HAS_DIGIT.test(password), "Password must contain at least one digit")
	.refine(
		(password) => HAS_SPECIAL.test(password),
		"Password must contain at least one special character",
	);

const signupSchema = z
	.object({
		name: z.string().min(1, "Name is required"),
		email: z.string().email("Invalid email address"),
		password: passwordSchema,
		confirmPassword: z.string().min(1, "Please confirm your password"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type PasswordRequirement = {
	label: string;
	met: boolean;
};

export function SignupForm({ className, ...props }: React.ComponentProps<"div">) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formData, setFormData] = useState({
		name: "",
		email: "",
		password: "",
		confirmPassword: "",
	});
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const checkPasswordRequirements = (password: string): PasswordRequirement[] => [
		{
			label: t("auth.password-requirements.length", "At least 8 characters"),
			met: password.length >= 8,
		},
		{
			label: t("auth.password-requirements.lowercase", "At least 1 lowercase letter"),
			met: HAS_LOWERCASE.test(password),
		},
		{
			label: t("auth.password-requirements.uppercase", "At least 1 uppercase letter"),
			met: HAS_UPPERCASE.test(password),
		},
		{
			label: t("auth.password-requirements.digit", "At least 1 digit"),
			met: HAS_DIGIT.test(password),
		},
		{
			label: t("auth.password-requirements.special", "At least 1 special character"),
			met: HAS_SPECIAL.test(password),
		},
	];

	const passwordRequirements = checkPasswordRequirements(formData.password);
	const passwordsMatch =
		formData.confirmPassword && formData.password && formData.confirmPassword === formData.password;

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
				result.error?.errors?.[0]?.message || t("validation.invalid-password", "Invalid password"),
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
		for (const err of errors.errors) {
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

		const result = signupSchema.safeParse(formData);

		if (!result.success) {
			handleValidationErrors(result.error);
			setIsLoading(false);
			return;
		}

		try {
			const signupResult = await authClient.signUp.email({
				email: formData.email,
				password: formData.password,
				name: formData.name,
			});

			if (signupResult.error) {
				setError(signupResult.error.message || t("auth.signup-failed", "Failed to sign up"));
			} else {
				router.push("/verify-email-pending");
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("common.error-occurred", "An error occurred"),
			);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<AuthFormWrapper
			className={className}
			formProps={{ onSubmit: handleSubmit }}
			title={t("auth.create-account", "Create your account")}
			{...props}
		>
			{error ? (
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm">{error}</div>
			) : null}
			<div className="grid gap-3">
				<Label htmlFor="name">{t("auth.name", "Name")}</Label>
				<Input
					id="name"
					name="name"
					onBlur={(e) => validateField("name", e.target.value)}
					onChange={(e) => {
						handleChange("name", e.target.value);
						validateField("name", e.target.value);
					}}
					placeholder={t("auth.name-placeholder", "John Doe")}
					required
					type="text"
					value={formData.name}
				/>
				{fieldErrors.name ? <p className="text-destructive text-sm">{fieldErrors.name}</p> : null}
			</div>
			<div className="grid gap-3">
				<Label htmlFor="email">{t("auth.email", "Email")}</Label>
				<Input
					id="email"
					name="email"
					onBlur={(e) => validateField("email", e.target.value)}
					onChange={(e) => {
						handleChange("email", e.target.value);
						validateField("email", e.target.value);
					}}
					placeholder={t("auth.email-placeholder", "m@example.com")}
					required
					type="email"
					value={formData.email}
				/>
				{fieldErrors.email ? <p className="text-destructive text-sm">{fieldErrors.email}</p> : null}
			</div>
			<div className="grid gap-3">
				<Label htmlFor="password">{t("auth.password", "Password")}</Label>
				<Input
					id="password"
					name="password"
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
				<Label htmlFor="confirmPassword">{t("auth.confirm-password", "Confirm Password")}</Label>
				<Input
					id="confirmPassword"
					name="confirmPassword"
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
				{isLoading ? t("common.loading", "Loading...") : t("auth.sign-up", "Sign up")}
			</Button>
			<div className="text-center text-sm">
				{t("auth.already-have-account", "Already have an account?")}{" "}
				<Link className="underline underline-offset-4" href="/sign-in">
					{t("auth.sign-in", "Sign in")}
				</Link>
			</div>
		</AuthFormWrapper>
	);
}
