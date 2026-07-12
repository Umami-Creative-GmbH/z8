"use client";

import { useTranslate } from "@tolgee/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type LoginCredentialsFieldsProps = {
	email: string;
	password: string;
	fieldErrors: Record<string, string>;
	requires2FA: boolean;
	onEmailBlur: (value: string) => void;
	onEmailChange: (value: string) => void;
	onPasswordBlur: (value: string) => void;
	onPasswordChange: (value: string) => void;
};

export function LoginCredentialsFields({
	email,
	password,
	fieldErrors,
	requires2FA,
	onEmailBlur,
	onEmailChange,
	onPasswordBlur,
	onPasswordChange,
}: LoginCredentialsFieldsProps) {
	const { t } = useTranslate();

	return (
		<>
			<div className="grid gap-3">
				<Label htmlFor="email">{t("auth.email", "Email")}</Label>
				<Input
					id="email"
					name="email"
					autoComplete="email"
					onBlur={(e) => onEmailBlur(e.target.value)}
					onChange={(e) => onEmailChange(e.target.value)}
					placeholder={t("auth.email-placeholder", "m@example.com")}
					required
					type="email"
					value={email}
					disabled={requires2FA}
				/>
				{fieldErrors.email ? <p className="text-destructive text-sm">{fieldErrors.email}</p> : null}
			</div>
			<div className="grid gap-3">
				<Label htmlFor="password">{t("auth.password", "Password")}</Label>
				<Input
					id="password"
					name="password"
					autoComplete="current-password"
					onBlur={(e) => onPasswordBlur(e.target.value)}
					onChange={(e) => onPasswordChange(e.target.value)}
					required
					type="password"
					value={password}
					disabled={requires2FA}
				/>
				{fieldErrors.password ? (
					<p className="text-destructive text-sm">{fieldErrors.password}</p>
				) : null}
			</div>
		</>
	);
}
