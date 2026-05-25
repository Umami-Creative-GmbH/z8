"use client";

import { IconCheck, IconEye, IconEyeOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type * as React from "react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Translate = (key: string, fallback: string) => string;

const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const NUMBER_REGEX = /[0-9]/;

export function validateStrongPassword(value: string, t: Translate): string | undefined {
	if (!value) {
		return t("setup:setup.error.password_required", "Password is required");
	}
	if (value.length < 12) {
		return t("setup:setup.error.password_min_length", "Password must be at least 12 characters");
	}
	if (value.length > 128) {
		return t("setup:setup.error.password_max_length", "Password must be at most 128 characters");
	}
	if (!UPPERCASE_REGEX.test(value)) {
		return t("setup:setup.error.password_uppercase", "Password must contain at least one uppercase letter");
	}
	if (!LOWERCASE_REGEX.test(value)) {
		return t("setup:setup.error.password_lowercase", "Password must contain at least one lowercase letter");
	}
	if (!NUMBER_REGEX.test(value)) {
		return t("setup:setup.error.password_number", "Password must contain at least one number");
	}
	return undefined;
}

export function validatePasswordConfirmation(
	value: string,
	password: string,
	t: Translate,
): string | undefined {
	if (!value.trim()) {
		return t("auth.confirm-password-required", "Please confirm your password");
	}
	if (value !== password) {
		return t("setup:setup.error.passwords_mismatch", "Passwords do not match");
	}
	return undefined;
}

export function PasswordVisibilityInput(props: Omit<React.ComponentProps<typeof Input>, "type">) {
	const { t } = useTranslate();
	const [showPassword, setShowPassword] = useState(false);

	return (
		<div className="relative">
			<Input {...props} className={cn("pr-10", props.className)} type={showPassword ? "text" : "password"} />
			<button
				aria-label={
					showPassword
						? t("setup:setup.hide_password", "Hide password")
						: t("setup:setup.show_password", "Show password")
				}
				className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={() => setShowPassword((visible) => !visible)}
				type="button"
			>
				{showPassword ? (
					<IconEyeOff aria-hidden="true" className="size-4" />
				) : (
					<IconEye aria-hidden="true" className="size-4" />
				)}
			</button>
		</div>
	);
}

export function PasswordStrengthIndicator({ id, password }: { id?: string; password: string }) {
	const { t } = useTranslate();
	const checks = [
		{ label: t("setup:setup.password.min_length", "12+ characters"), valid: password.length >= 12 },
		{ label: t("setup:setup.password.uppercase", "Uppercase letter"), valid: UPPERCASE_REGEX.test(password) },
		{ label: t("setup:setup.password.lowercase", "Lowercase letter"), valid: LOWERCASE_REGEX.test(password) },
		{ label: t("setup:setup.password.number", "Number"), valid: NUMBER_REGEX.test(password) },
	];
	const validCount = checks.filter((check) => check.valid).length;

	if (password.length === 0) {
		return null;
	}

	return (
		<div aria-live="polite" className="mt-2 space-y-2" id={id}>
			<div className="flex gap-1" aria-hidden="true">
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
							<IconCheck aria-hidden="true" className="size-3" />
						) : (
							<div aria-hidden="true" className="size-3 rounded-full border border-current" />
						)}
						{check.label}
					</div>
				))}
			</div>
		</div>
	);
}
