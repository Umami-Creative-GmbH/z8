"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef } from "react";
import { toast } from "sonner";
import { changePassword } from "@/app/[locale]/(app)/settings/profile/actions";
import {
	PasswordStrengthIndicator,
	PasswordVisibilityInput,
} from "@/components/auth/password-fields";
import {
	validatePasswordConfirmation,
	validateStrongPassword,
} from "@/components/auth/password-validation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientForm } from "@/components/ui/client-form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";

interface PasswordChangeFormValues {
	currentPassword: string;
	newPassword: string;
	confirmPassword: string;
	revokeOtherSessions: boolean;
}

export function PasswordChangeForm() {
	const { t } = useTranslate();
	const submittingRef = useRef(false);

	const validateCurrentPassword = (value: string) =>
		value.trim()
			? undefined
			: t("profile.current-password-required", "Current password is required");

	const defaultValues: PasswordChangeFormValues = {
		currentPassword: "",
		newPassword: "",
		confirmPassword: "",
		revokeOtherSessions: false,
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value, formApi }) => {
			if (submittingRef.current) return;
			submittingRef.current = true;

			const run = async () => {
				try {
					const result = await changePassword({
						currentPassword: value.currentPassword,
						newPassword: value.newPassword,
						confirmPassword: value.confirmPassword,
						revokeOtherSessions: value.revokeOtherSessions,
					});

					if (result.success) {
						toast.success(t("profile.password-changed", "Password changed successfully"));
						formApi.reset();
					} else {
						if (result.error?.includes("incorrect") || result.error?.includes("Invalid")) {
							formApi.setFieldMeta("currentPassword", (meta) => ({
								...meta,
								errorMap: {
									...meta.errorMap,
									onSubmit: t("profile.invalid-current-password", "Current password is incorrect"),
								},
							}));
						}
						toast.error(
							actionErrorMessage(t, result, {}, [
								"profile.password-change-failed",
								"Failed to change password",
							]),
						);
					}
				} catch {
					toast.error(t("profile.password-change-failed", "Failed to change password"));
				}
			};

			// Promise#finally rather than try/finally: the React Compiler cannot
			// compile try statements without a catch clause.
			await run().finally(() => {
				submittingRef.current = false;
			});
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle as="h2">{t("profile.change-password", "Change Password")}</CardTitle>
				<CardDescription>
					{t(
						"profile.change-password-description",
						"Update your password to keep your account secure",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ClientForm
					noValidate
					onSubmit={() => {
						if (submittingRef.current) return;
						void form.handleSubmit();
					}}
					className="space-y-4"
				>
					{/* Current Password */}
					<form.Field
						name="currentPassword"
						validators={{
							onSubmit: ({ value }) => validateCurrentPassword(value),
							onChange: ({ value, fieldApi }) =>
								fieldApi.state.meta.errors.length > 0 ? validateCurrentPassword(value) : undefined,
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("profile.current-password", "Current Password")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<PasswordVisibilityInput
										name="currentPassword"
										autoComplete="current-password"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"profile.current-password-placeholder",
											"Enter current password",
										)}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{/* New Password */}
					<form.Field
						name="newPassword"
						validators={{
							onSubmit: ({ value }) => validateStrongPassword(value, t),
							onChange: ({ value, fieldApi }) =>
								fieldApi.state.meta.errors.length > 0
									? validateStrongPassword(value, t)
									: undefined,
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("profile.new-password", "New Password")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<PasswordVisibilityInput
										name="newPassword"
										autoComplete="new-password"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("profile.new-password-placeholder", "Enter new password")}
									/>
								</TFormControl>
								<PasswordStrengthIndicator password={field.state.value} />
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{/* Confirm Password */}
					<form.Field
						name="confirmPassword"
						validators={{
							onChangeListenTo: ["newPassword"],
							onSubmit: ({ value, fieldApi }) =>
								validatePasswordConfirmation(value, fieldApi.form.getFieldValue("newPassword"), t),
							onChange: ({ value, fieldApi }) =>
								fieldApi.state.meta.errors.length > 0
									? validatePasswordConfirmation(
											value,
											fieldApi.form.getFieldValue("newPassword"),
											t,
										)
									: undefined,
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("profile.confirm-password", "Confirm New Password")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<PasswordVisibilityInput
										name="confirmPassword"
										autoComplete="new-password"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("profile.confirm-password-placeholder", "Confirm new password")}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{/* Revoke Other Sessions */}
					<form.Field name="revokeOtherSessions">
						{(field) => (
							<div className="flex items-center gap-x-2">
								<Switch
									id="revokeOtherSessions"
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked === true)}
								/>
								<Label htmlFor="revokeOtherSessions" className="cursor-pointer">
									{t("profile.revoke-sessions", "Log out other devices")}
								</Label>
							</div>
						)}
					</form.Field>

					{/* Submit Button */}
					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? (
									<>
										<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
										{t("common.saving", "Saving...")}
									</>
								) : (
									t("profile.update-password", "Change Password")
								)}
							</Button>
						)}
					</form.Subscribe>
				</ClientForm>
			</CardContent>
		</Card>
	);
}
