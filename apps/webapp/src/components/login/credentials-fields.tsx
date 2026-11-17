"use client";

import { useTranslate } from "@tolgee/react";
import { Input } from "@/components/ui/input";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { isValidLoginEmail } from "./login-state";
import type { LoginFormApi } from "./use-login-auth";

export function LoginCredentialsFields({
	form,
	disabled,
	onChange,
}: {
	form: LoginFormApi;
	disabled: boolean;
	onChange: () => void;
}) {
	const { t } = useTranslate();
	return (
		<fieldset disabled={disabled} className="grid min-w-0 gap-5">
			<legend className="sr-only">{t("auth.signIn.credentials", "Sign in with email")}</legend>
			<form.Field
				name="email"
				validators={{
					onBlur: ({ value }) =>
						isValidLoginEmail(value)
							? undefined
							: t("validation.invalid-email", "Invalid email address"),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={field.state.meta.errors.length > 0}>
							{t("auth.email", "Email")}
						</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<Input
								name={field.name}
								type="email"
								autoComplete="email"
								inputMode="email"
								autoCapitalize="none"
								spellCheck={false}
								required
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => {
									onChange();
									field.handleChange(event.target.value);
								}}
								placeholder={t("auth.email-placeholder", "m@example.com")}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field
				name="password"
				validators={{
					onBlur: ({ value }) =>
						value.length ? undefined : t("validation.password-required", "Password is required"),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={field.state.meta.errors.length > 0}>
							{t("auth.password", "Password")}
						</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<Input
								name={field.name}
								type="password"
								autoComplete="current-password"
								required
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => {
									onChange();
									field.handleChange(event.target.value);
								}}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
		</fieldset>
	);
}
