"use client";

import {
	IconCalendar,
	IconCamera,
	IconGenderBigender,
	IconGenderFemale,
	IconGenderMale,
	IconLoader2,
	IconTrash,
	IconUpload,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import Uppy from "@uppy/core";
import German from "@uppy/locales/lib/de_DE";
import English from "@uppy/locales/lib/en_US";
import XhrUpload from "@uppy/xhr-upload";
import { format } from "@/lib/datetime/luxon-utils";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { updateOwnProfile } from "@/app/[locale]/(app)/settings/employees/actions";
import { updateProfile } from "@/app/[locale]/(app)/settings/profile/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useRouter } from "@/navigation";

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
	const locale = useLocale();

	// Profile form state
	const [profileData, setProfileData] = useState({
		name: user.name,
		image: user.image || "",
		firstName: "",
		lastName: "",
		gender: "",
		birthday: null as Date | null,
	});
	const [isProfileLoading, setIsProfileLoading] = useState(false);
	const [isInitialLoading, setIsInitialLoading] = useState(true);
	const [uploadProgress, setUploadProgress] = useState(0);

	// Use ref to track current profile data for async operations
	const profileDataRef = useRef(profileData);
	useEffect(() => {
		profileDataRef.current = profileData;
	}, [profileData]);

	// Load employee personal info
	useEffect(() => {
		async function loadEmployeeData() {
			try {
				const emp = await getCurrentEmployee();
				if (emp) {
					setProfileData((prev) => ({
						...prev,
						firstName: emp.firstName || "",
						lastName: emp.lastName || "",
						gender: emp.gender || "",
						birthday: emp.birthday ? new Date(emp.birthday) : null,
					}));
				}
			} finally {
				setIsInitialLoading(false);
			}
		}
		loadEmployeeData();
	}, []);

	// Get the appropriate Uppy locale
	const uppyLocale = locale === "de" ? German : English;

	// Create ref for file input
	const inputRef = useRef<HTMLInputElement>(null);

	// Initialize Uppy instance
	const uppy = useMemo(() => {
		return new Uppy({
			restrictions: {
				maxFileSize: 5 * 1024 * 1024, // 5MB
				maxNumberOfFiles: 1,
				allowedFileTypes: ["image/*"],
			},
			autoProceed: true, // Auto upload when file is added
			locale: uppyLocale,
		}).use(XhrUpload, {
			endpoint: "/api/upload/avatar",
			fieldName: "file",
			method: "POST",
		});
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Update Uppy locale when language changes
	useEffect(() => {
		uppy.setOptions({ locale: uppyLocale });
	}, [locale, uppy, uppyLocale]);

	// Handle file input change
	const handleFileInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files;
			if (files && files.length > 0) {
				// Add files to Uppy
				Array.from(files).forEach((file) => {
					try {
						uppy.addFile({
							name: file.name,
							type: file.type,
							data: file,
						});
					} catch (err) {
						// Uppy will handle validation errors
						console.error("Error adding file to Uppy:", err);
					}
				});
				// Reset input so the same file can be selected again
				e.target.value = "";
			}
		},
		[uppy],
	);

	// Listen to upload events
	useEffect(() => {
		const handleUploadStart = () => {
			setUploadProgress(0);
		};

		const handleProgress = (
			_file: any,
			progress: { bytesUploaded: number; bytesTotal: number | null },
		) => {
			if (progress.bytesTotal && progress.bytesTotal > 0) {
				setUploadProgress(Math.round((progress.bytesUploaded / progress.bytesTotal) * 100));
			}
		};

		const handleComplete = async (result: any) => {
			setUploadProgress(0);

			if (result.successful && result.successful.length > 0) {
				const uploadedFile = result.successful[0];
				if (uploadedFile) {
					const responseBody = uploadedFile.response?.body as { url?: string };
					if (responseBody?.url) {
						const imageUrl = responseBody.url;

						// Get current name from ref
						const currentName = profileDataRef.current.name;

						// Update state
						setProfileData((prev) => ({ ...prev, image: imageUrl }));

						// Save to database
						const saveResult = await updateProfile({
							name: currentName,
							image: imageUrl,
						});

						if (saveResult.success) {
							toast.success(t("profile.avatar-uploaded", "Avatar uploaded successfully"));
							router.refresh(); // Refresh to update user data everywhere
						} else {
							toast.error(
								saveResult.error || t("profile.avatar-save-failed", "Failed to save avatar"),
							);
						}
					}
				}
			}

			// Clear uppy files
			uppy.cancelAll();
		};

		const handleError = (_file: any, error: any) => {
			setUploadProgress(0);
			toast.error(error?.message || t("profile.avatar-upload-failed", "Failed to upload avatar"));
			uppy.cancelAll();
		};

		uppy.on("upload", handleUploadStart);
		uppy.on("upload-progress", handleProgress);
		uppy.on("complete", handleComplete);
		uppy.on("upload-error", handleError);

		return () => {
			uppy.off("upload", handleUploadStart);
			uppy.off("upload-progress", handleProgress);
			uppy.off("complete", handleComplete);
			uppy.off("upload-error", handleError);
		};
	}, [uppy, t, router]);

	// Cleanup Uppy on unmount
	useEffect(() => {
		return () => {
			uppy.destroy();
		};
	}, [uppy]);

	const isUploadingAvatar = uploadProgress > 0 && uploadProgress < 100;

	const initials = user.name
		? user.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2)
		: "?";

	// Handle avatar removal
	const handleRemoveAvatar = async () => {
		setIsProfileLoading(true);

		const result = await updateProfile({
			name: profileDataRef.current.name,
			image: null,
		});

		if (result.success) {
			setProfileData((prev) => ({ ...prev, image: "" }));
			toast.success(t("profile.avatar-removed", "Avatar removed successfully"));
			router.refresh();
		} else {
			toast.error(result.error || t("profile.avatar-remove-failed", "Failed to remove avatar"));
		}

		setIsProfileLoading(false);
	};

	// Handle profile update
	const handleProfileSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsProfileLoading(true);

		// Update user profile
		const profileResult = await updateProfile({
			name: profileData.name,
			image: profileData.image,
		});

		// Update employee personal info
		const employeeResult = await updateOwnProfile({
			firstName: profileData.firstName || undefined,
			lastName: profileData.lastName || undefined,
			gender: profileData.gender as "male" | "female" | "other" | undefined,
			birthday: profileData.birthday || undefined,
		});

		if (profileResult.success && employeeResult.success) {
			toast.success(t("profile.update-success", "Profile updated successfully"));
			router.refresh(); // Refresh to update user data
		} else {
			const errorMsg = !profileResult.success
				? profileResult.error
				: !employeeResult.success
					? employeeResult.error
					: t("profile.update-failed", "Failed to update profile");
			toast.error(errorMsg);
		}

		setIsProfileLoading(false);
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
					{isInitialLoading ? (
						<div className="space-y-6">
							{/* Avatar skeleton */}
							<div className="space-y-4">
								<Skeleton className="h-4 w-24" />
								<div className="flex items-center gap-6">
									<Skeleton className="h-24 w-24 rounded-full" />
									<div className="flex-1 space-y-2">
										<div className="flex items-center gap-2">
											<Skeleton className="h-9 w-32" />
										</div>
										<Skeleton className="h-4 w-64" />
									</div>
								</div>
							</div>
							{/* Name field skeleton */}
							<div className="space-y-2">
								<Skeleton className="h-4 w-12" />
								<Skeleton className="h-10 w-full" />
							</div>
							{/* Email field skeleton */}
							<div className="space-y-2">
								<Skeleton className="h-4 w-12" />
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-4 w-40" />
							</div>
							{/* Personal info skeleton */}
							<div className="border-t pt-6 space-y-6">
								<Skeleton className="h-6 w-40" />
								<div className="grid gap-4 md:grid-cols-2">
									<div className="space-y-2">
										<Skeleton className="h-4 w-20" />
										<Skeleton className="h-10 w-full" />
									</div>
									<div className="space-y-2">
										<Skeleton className="h-4 w-20" />
										<Skeleton className="h-10 w-full" />
									</div>
								</div>
								{/* Gender skeleton */}
								<div className="space-y-2">
									<Skeleton className="h-4 w-16" />
									<div className="grid grid-cols-3 gap-3">
										<Skeleton className="h-20 w-full rounded-lg" />
										<Skeleton className="h-20 w-full rounded-lg" />
										<Skeleton className="h-20 w-full rounded-lg" />
									</div>
								</div>
								{/* Birthday skeleton */}
								<div className="space-y-2">
									<Skeleton className="h-4 w-16" />
									<Skeleton className="h-10 w-full" />
									<Skeleton className="h-4 w-56" />
								</div>
							</div>
							{/* Submit button skeleton */}
							<Skeleton className="h-10 w-32" />
						</div>
					) : (
						<form onSubmit={handleProfileSubmit} className="space-y-6">
						{/* Profile Picture Upload */}
						<div className="space-y-4">
							<Label className="text-sm font-medium">
								{t("profile.profile-picture", "Profile Picture")}
							</Label>
							{/* Hidden file input */}
							<input
								ref={inputRef}
								type="file"
								accept="image/*"
								className="hidden"
								aria-label="Upload profile picture"
								onChange={handleFileInputChange}
							/>
							<div className="flex items-center gap-6">
								<div className="relative">
									<Avatar className="h-24 w-24">
										<AvatarImage alt={user.name} src={profileData.image || undefined} />
										<AvatarFallback className="text-2xl">{initials}</AvatarFallback>
									</Avatar>
									{isUploadingAvatar && (
										<div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
											<IconLoader2 className="h-8 w-8 animate-spin text-white" />
										</div>
									)}
									<button
										type="button"
										onClick={() => inputRef.current?.click()}
										disabled={isUploadingAvatar}
										className="absolute bottom-0 right-0 rounded-full bg-primary p-2 text-primary-foreground shadow-lg transition-transform hover:scale-110 disabled:opacity-50"
									>
										<IconCamera className="h-4 w-4" />
									</button>
								</div>
								<div className="flex-1 space-y-2">
									<div className="flex items-center gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => inputRef.current?.click()}
											disabled={isUploadingAvatar || isProfileLoading}
										>
											<IconUpload className="mr-2 h-4 w-4" />
											{t("profile.change-picture", "Change Picture")}
										</Button>
										{profileData.image && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={handleRemoveAvatar}
												disabled={isUploadingAvatar || isProfileLoading}
											>
												<IconTrash className="mr-2 h-4 w-4" />
												{t("profile.remove-picture", "Remove Picture")}
											</Button>
										)}
									</div>
									<p className="text-muted-foreground text-sm">
										{t("profile.picture-hint", "JPG, PNG or WebP. Max 5MB. Recommended 400x400px")}
									</p>
									{isUploadingAvatar && (
										<div className="space-y-1">
											<Progress value={uploadProgress} className="h-2" />
											<p className="text-xs text-muted-foreground">
												{t("profile.uploading", "Uploading")} {uploadProgress}%
											</p>
										</div>
									)}
								</div>
							</div>
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

						{/* Personal Information Section */}
						<div className="border-t pt-6 space-y-6">
							<h3 className="text-lg font-medium">Personal Information</h3>

							<div className="grid gap-4 md:grid-cols-2">
								{/* First Name */}
								<div className="space-y-2">
									<Label htmlFor="firstName">First Name</Label>
									<Input
										id="firstName"
										value={profileData.firstName}
										onChange={(e) =>
											setProfileData((prev) => ({ ...prev, firstName: e.target.value }))
										}
										placeholder="Enter your first name"
									/>
								</div>

								{/* Last Name */}
								<div className="space-y-2">
									<Label htmlFor="lastName">Last Name</Label>
									<Input
										id="lastName"
										value={profileData.lastName}
										onChange={(e) =>
											setProfileData((prev) => ({ ...prev, lastName: e.target.value }))
										}
										placeholder="Enter your last name"
									/>
								</div>
							</div>

							{/* Gender */}
							<div className="space-y-2">
								<Label>Gender</Label>
								<div className="grid grid-cols-3 gap-3">
									<button
										type="button"
										onClick={() => setProfileData((prev) => ({ ...prev, gender: "male" }))}
										className={cn(
											"flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition-all hover:border-primary/50",
											profileData.gender === "male"
												? "border-primary bg-primary/5 text-primary"
												: "border-border bg-background",
										)}
									>
										<IconGenderMale className="h-6 w-6" />
										<span className="text-sm font-medium">Male</span>
									</button>
									<button
										type="button"
										onClick={() => setProfileData((prev) => ({ ...prev, gender: "female" }))}
										className={cn(
											"flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition-all hover:border-primary/50",
											profileData.gender === "female"
												? "border-primary bg-primary/5 text-primary"
												: "border-border bg-background",
										)}
									>
										<IconGenderFemale className="h-6 w-6" />
										<span className="text-sm font-medium">Female</span>
									</button>
									<button
										type="button"
										onClick={() => setProfileData((prev) => ({ ...prev, gender: "other" }))}
										className={cn(
											"flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition-all hover:border-primary/50",
											profileData.gender === "other"
												? "border-primary bg-primary/5 text-primary"
												: "border-border bg-background",
										)}
									>
										<IconGenderBigender className="h-6 w-6" />
										<span className="text-sm font-medium">Other</span>
									</button>
								</div>
							</div>

							{/* Birthday */}
							<div className="space-y-2">
								<Label htmlFor="birthday">Birthday</Label>
								<Popover>
									<PopoverTrigger asChild>
										<Button
											id="birthday"
											variant="outline"
											className={cn(
												"w-full justify-start text-left font-normal",
												!profileData.birthday && "text-muted-foreground",
											)}
										>
											<IconCalendar className="mr-2 h-4 w-4" />
											{profileData.birthday ? (
												format(profileData.birthday, "PPP")
											) : (
												<span>Pick your birthday</span>
											)}
										</Button>
									</PopoverTrigger>
									<PopoverContent className="w-auto p-0" align="start">
										<Calendar
											mode="single"
											selected={profileData.birthday || undefined}
											onSelect={(date) =>
												setProfileData((prev) => ({ ...prev, birthday: date || null }))
											}
											disabled={(date) => date > new Date()}
											initialFocus
											captionLayout="dropdown"
											startMonth={new Date(1940, 0)}
											endMonth={new Date()}
											defaultMonth={profileData.birthday || new Date(2000, 0)}
										/>
									</PopoverContent>
								</Popover>
								<p className="text-muted-foreground text-sm">
									Your birthday helps us celebrate with you
								</p>
							</div>
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
					)}
				</CardContent>
			</Card>
		</div>
	);
}
