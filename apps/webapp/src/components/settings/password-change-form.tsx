"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function PasswordChangeForm() {
	const { t } = useTranslate();

	// Password form state
	const [passwordData, setPasswordData] = useState({
		currentPassword: "",
		newPassword: "",
		confirmPassword: "",
	});
	const [revokeOtherSessions, setRevokeOtherSessions] = useState(false);
	const [isPasswordLoading, setIsPasswordLoading] = useState(false);
	const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

	// Handle password change
	const handlePasswordSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsPasswordLoading(true);
		setPasswordErrors({});
		const nextErrors: Record<string, string> = {};
		const newPasswordError = validateStrongPassword(passwordData.newPassword, t);
		if (newPasswordError) {
			nextErrors.newPassword = newPasswordError;
		}
		const confirmPasswordError = validatePasswordConfirmation(
			passwordData.confirmPassword,
			passwordData.newPassword,
			t,
		);
		if (confirmPasswordError) {
			nextErrors.confirmPassword = confirmPasswordError;
		}

		if (Object.keys(nextErrors).length > 0) {
			setPasswordErrors(nextErrors);
			setIsPasswordLoading(false);
			return;
		}

		const result = await changePassword({
			currentPassword: passwordData.currentPassword,
			newPassword: passwordData.newPassword,
			confirmPassword: passwordData.confirmPassword,
			revokeOtherSessions,
		});

		if (result.success) {
			toast.success(t("profile.password-changed", "Password changed successfully"));
			// Reset form
			setPasswordData({
				currentPassword: "",
				newPassword: "",
				confirmPassword: "",
			});
			setRevokeOtherSessions(false);
		} else {
			if (result.error?.includes("incorrect") || result.error?.includes("Invalid")) {
				setPasswordErrors({
					currentPassword: t("profile.invalid-current-password", "Current password is incorrect"),
				});
			}
			toast.error(result.error || t("profile.password-change-failed", "Failed to change password"));
		}

		setIsPasswordLoading(false);
	};

	const handlePasswordChange = (field: string, value: string) => {
		setPasswordData((prev) => ({ ...prev, [field]: value }));
		// Clear error for this field when user starts typing
		if (passwordErrors[field]) {
			setPasswordErrors((prev) => {
				const newErrors = { ...prev };
				delete newErrors[field];
				return newErrors;
			});
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("profile.change-password", "Change Password")}</CardTitle>
				<CardDescription>
					{t(
						"profile.change-password-description",
						"Update your password to keep your account secure",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handlePasswordSubmit} className="space-y-4">
					{/* Current Password */}
					<div className="space-y-2">
						<Label htmlFor="currentPassword">
							{t("profile.current-password", "Current Password")}
						</Label>
						<PasswordVisibilityInput
							id="currentPassword"
							autoComplete="current-password"
							value={passwordData.currentPassword}
							onChange={(e) => handlePasswordChange("currentPassword", e.target.value)}
							placeholder={t("profile.current-password-placeholder", "Enter current password")}
							required
						/>
						{passwordErrors.currentPassword ? (
							<p className="text-destructive text-sm">{passwordErrors.currentPassword}</p>
						) : null}
					</div>

					{/* New Password */}
					<div className="space-y-2">
						<Label htmlFor="newPassword">{t("profile.new-password", "New Password")}</Label>
						<PasswordVisibilityInput
							id="newPassword"
							autoComplete="new-password"
							value={passwordData.newPassword}
							onChange={(e) => handlePasswordChange("newPassword", e.target.value)}
							placeholder={t("profile.new-password-placeholder", "Enter new password")}
							required
						/>
						<PasswordStrengthIndicator password={passwordData.newPassword} />
						{passwordErrors.newPassword ? (
							<p className="text-destructive text-sm">{passwordErrors.newPassword}</p>
						) : null}
					</div>

					{/* Confirm Password */}
					<div className="space-y-2">
						<Label htmlFor="confirmPassword">
							{t("profile.confirm-password", "Confirm New Password")}
						</Label>
						<PasswordVisibilityInput
							id="confirmPassword"
							autoComplete="new-password"
							value={passwordData.confirmPassword}
							onChange={(e) => handlePasswordChange("confirmPassword", e.target.value)}
							placeholder={t("profile.confirm-password-placeholder", "Confirm new password")}
							required
						/>
						{passwordErrors.confirmPassword ? (
							<p className="text-destructive text-sm">{passwordErrors.confirmPassword}</p>
						) : null}
					</div>

					{/* Revoke Other Sessions */}
					<div className="flex items-center space-x-2">
						<Switch
							id="revokeOtherSessions"
							checked={revokeOtherSessions}
							onCheckedChange={setRevokeOtherSessions}
						/>
						<Label htmlFor="revokeOtherSessions" className="cursor-pointer">
							{t("profile.revoke-sessions", "Log out other devices")}
						</Label>
					</div>

					{/* Submit Button */}
					<Button type="submit" disabled={isPasswordLoading}>
						{isPasswordLoading ? (
							<>
								<IconLoader2 className="mr-2 size-4 animate-spin" />
								{t("common.saving", "Saving...")}
							</>
						) : (
							t("profile.update-password", "Change Password")
						)}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
