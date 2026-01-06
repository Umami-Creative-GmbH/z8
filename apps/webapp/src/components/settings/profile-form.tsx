"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import Uppy from "@uppy/core";
import { Dashboard } from "@uppy/react";
import XhrUpload from "@uppy/xhr-upload";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";
import { changePassword, updateProfile } from "@/app/[locale]/(app)/settings/profile/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Password validation patterns (matching signup-form.tsx)
const HAS_LOWERCASE = /[a-z]/;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_DIGIT = /\d/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

type PasswordRequirement = {
	label: string;
	met: boolean;
};

interface ProfileFormProps {
	user: {
		id: string;
		name: string;
		email: string;
		image?: string | null;
	};
}

export function ProfileForm({ user }: ProfileFormProps) {
	const { t } = useTranslate();
	const router = useRouter();

	// Profile form state
	const [profileData, setProfileData] = useState({
		name: user.name,
		image: user.image || "",
	});
	const [isProfileLoading, setIsProfileLoading] = useState(false);

	// Password form state
	const [passwordData, setPasswordData] = useState({
		currentPassword: "",
		newPassword: "",
		confirmPassword: "",
	});
	const [revokeOtherSessions, setRevokeOtherSessions] = useState(false);
	const [isPasswordLoading, setIsPasswordLoading] = useState(false);
	const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

	// Initialize Uppy
	const [uppy] = useState(() => {
		const instance = new Uppy({
			restrictions: {
				maxFileSize: 5 * 1024 * 1024, // 5MB
				maxNumberOfFiles: 1,
				allowedFileTypes: ["image/*"],
			},
			autoProceed: false,
		}).use(XhrUpload, {
			endpoint: "/api/upload/avatar",
			fieldName: "file",
			method: "POST",
		});

		// Listen to upload completion
		instance.on("complete", (result) => {
			if (result.successful.length > 0) {
				const uploadedFile = result.successful[0];
				const responseBody = uploadedFile.response?.body as { url?: string };
				if (responseBody?.url) {
					setProfileData((prev) => ({ ...prev, image: responseBody.url }));
					toast.success(t("profile.avatar-uploaded", "Avatar uploaded successfully"));
				}
			}
		});

		// Listen to upload errors
		instance.on("upload-error", (_file, error) => {
			toast.error(error?.message || t("profile.avatar-upload-failed", "Failed to upload avatar"));
		});

		return instance;
	});

	// Cleanup Uppy on unmount
	useEffect(() => {
		return () => uppy.close();
	}, [uppy]);

	const initials = user.name
		? user.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2)
		: "?";

	// Password requirements checker
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

	const passwordRequirements = checkPasswordRequirements(passwordData.newPassword);
	const passwordsMatch =
		passwordData.confirmPassword &&
		passwordData.newPassword &&
		passwordData.confirmPassword === passwordData.newPassword;

	// Handle profile update
	const handleProfileSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsProfileLoading(true);

		const result = await updateProfile({
			name: profileData.name,
			image: profileData.image,
		});

		if (result.success) {
			toast.success(t("profile.update-success", "Profile updated successfully"));
			router.refresh(); // Refresh to update user data
		} else {
			toast.error(result.error || t("profile.update-failed", "Failed to update profile"));
		}

		setIsProfileLoading(false);
	};

	// Handle password change
	const handlePasswordSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsPasswordLoading(true);
		setPasswordErrors({});

		// Validate passwords match
		if (passwordData.newPassword !== passwordData.confirmPassword) {
			setPasswordErrors({
				confirmPassword: t("auth.passwords-no-match", "Passwords do not match"),
			});
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
		<div className="space-y-6">
			{/* Profile Information Section */}
			<Card>
				<CardHeader>
					<CardTitle>{t("profile.information", "Profile Information")}</CardTitle>
					<CardDescription>
						{t(
							"profile.information-description",
							"Update your personal information and profile picture",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleProfileSubmit} className="space-y-6">
						{/* Current Avatar Preview */}
						<div className="flex items-center gap-6">
							<Avatar className="h-24 w-24">
								<AvatarImage alt={user.name} src={profileData.image} />
								<AvatarFallback className="text-2xl">{initials}</AvatarFallback>
							</Avatar>
							<div className="flex-1">
								<Label className="text-sm font-medium">
									{t("profile.current-avatar", "Current Profile Picture")}
								</Label>
								<p className="text-muted-foreground text-sm">
									{t("profile.avatar-hint", "Upload a new image below")}
								</p>
							</div>
						</div>

						{/* Uppy Dashboard */}
						<div>
							<Label className="mb-2 block">{t("profile.upload-avatar", "Upload New Image")}</Label>
							<Dashboard
								uppy={uppy}
								proudlyDisplayPoweredByUppy={false}
								height={300}
								note={t("profile.upload-note", "Images up to 5MB, will be optimized automatically")}
							/>
						</div>

						{/* Name Field */}
						<div className="space-y-2">
							<Label htmlFor="name">{t("profile.name", "Name")}</Label>
							<Input
								id="name"
								value={profileData.name}
								onChange={(e) => setProfileData((prev) => ({ ...prev, name: e.target.value }))}
								placeholder={t("profile.name-placeholder", "Enter your name")}
								required
							/>
						</div>

						{/* Email Field (Read-only) */}
						<div className="space-y-2">
							<Label htmlFor="email">{t("profile.email", "Email")}</Label>
							<Input id="email" value={user.email} disabled className="bg-muted" />
							<p className="text-muted-foreground text-sm">
								{t("profile.email-readonly", "Email cannot be changed")}
							</p>
						</div>

						{/* Submit Button */}
						<Button type="submit" disabled={isProfileLoading}>
							{isProfileLoading ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									{t("common.saving", "Saving...")}
								</>
							) : (
								t("profile.update-profile", "Update Profile")
							)}
						</Button>
					</form>
				</CardContent>
			</Card>

			{/* Password Change Section */}
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
							<Input
								id="currentPassword"
								type="password"
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
							<Input
								id="newPassword"
								type="password"
								value={passwordData.newPassword}
								onChange={(e) => handlePasswordChange("newPassword", e.target.value)}
								placeholder={t("profile.new-password-placeholder", "Enter new password")}
								required
							/>
							{passwordData.newPassword ? (
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
						</div>

						{/* Confirm Password */}
						<div className="space-y-2">
							<Label htmlFor="confirmPassword">
								{t("profile.confirm-password", "Confirm New Password")}
							</Label>
							<Input
								id="confirmPassword"
								type="password"
								value={passwordData.confirmPassword}
								onChange={(e) => handlePasswordChange("confirmPassword", e.target.value)}
								placeholder={t("profile.confirm-password-placeholder", "Confirm new password")}
								required
							/>
							{passwordErrors.confirmPassword ? (
								<p className="text-destructive text-sm">{passwordErrors.confirmPassword}</p>
							) : null}
							{passwordsMatch ? (
								<p className="text-green-600 text-sm dark:text-green-400">
									{t("auth.passwords-match", "Passwords match")}
								</p>
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
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									{t("common.saving", "Saving...")}
								</>
							) : (
								t("profile.update-password", "Change Password")
							)}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
