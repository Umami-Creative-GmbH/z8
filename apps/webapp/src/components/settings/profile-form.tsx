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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { updateOwnProfile } from "@/app/[locale]/(app)/settings/employees/actions";
import { updateProfile } from "@/app/[locale]/(app)/settings/profile/actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { useImageUpload } from "@/hooks/use-image-upload";
import { format } from "@/lib/datetime/luxon-utils";
import { queryKeys } from "@/lib/query";
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
	const queryClient = useQueryClient();

	// Profile form state
	const [profileData, setProfileData] = useState({
		name: user.name,
		image: user.image || "",
		firstName: "",
		lastName: "",
		gender: "",
		birthday: null as Date | null,
	});
	const [isInitialLoading, setIsInitialLoading] = useState(true);

	// Use ref to track current profile data for async operations
	const profileDataRef = useRef(profileData);
	useEffect(() => {
		profileDataRef.current = profileData;
	}, [profileData]);

	// Avatar update mutation (for saving URL to user profile after upload)
	const avatarUpdateMutation = useMutation({
		mutationFn: (data: { name: string; image: string }) => updateProfile(data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("profile.avatar-uploaded", "Avatar uploaded successfully"));
				// Cache invalidation is handled by useImageProcessMutation
			} else {
				toast.error(result.error || t("profile.avatar-save-failed", "Failed to save avatar"));
			}
		},
		onError: () => {
			toast.error(t("profile.avatar-save-failed", "Failed to save avatar"));
		},
	});

	// Image upload hook
	const {
		addFile,
		progress: uploadProgress,
		isUploading: isUploadingAvatar,
		previewUrl,
	} = useImageUpload({
		uploadType: "avatar",
		onSuccess: (imageUrl) => {
			// Get current name from ref
			const currentName = profileDataRef.current.name;

			// Update local state immediately
			setProfileData((prev) => ({ ...prev, image: imageUrl }));

			// Save to database using mutation
			avatarUpdateMutation.mutate({ name: currentName, image: imageUrl });
		},
		onError: (error) => {
			toast.error(error?.message || t("profile.avatar-upload-failed", "Failed to upload avatar"));
		},
	});

	// Load employee personal info
	useEffect(() => {
		async function loadEmployeeData() {
			const emp = await getCurrentEmployee().then((value) => value, () => null);
			if (emp) {
				setProfileData((prev) => ({
					...prev,
					firstName: emp.firstName || "",
					lastName: emp.lastName || "",
					gender: emp.gender || "",
					birthday: emp.birthday ? new Date(emp.birthday) : null,
				}));
			}
			setIsInitialLoading(false);
		}
		loadEmployeeData();
	}, []);

	// Create ref for file input
	const inputRef = useRef<HTMLInputElement>(null);

	// Handle file input change
	const handleFileInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files;
			if (files && files.length > 0) {
				addFile(files[0]);
				// Reset input so the same file can be selected again
				e.target.value = "";
			}
		},
		[addFile],
	);

	// Avatar removal mutation
	const removeAvatarMutation = useMutation({
		mutationFn: () =>
			updateProfile({
				name: profileDataRef.current.name,
				image: null,
			}),
		onMutate: () => {
			// Optimistic update
			const previousImage = profileData.image;
			setProfileData((prev) => ({ ...prev, image: "" }));
			return { previousImage };
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("profile.avatar-removed", "Avatar removed successfully"));
				queryClient.invalidateQueries({ queryKey: queryKeys.profile.current() });
				router.refresh(); // Refresh to update server components (sidebar)
			} else {
				toast.error(result.error || t("profile.avatar-remove-failed", "Failed to remove avatar"));
			}
		},
		onError: (_error, _vars, context) => {
			// Rollback on error
			if (context?.previousImage) {
				setProfileData((prev) => ({ ...prev, image: context.previousImage }));
			}
			toast.error(t("profile.avatar-remove-failed", "Failed to remove avatar"));
		},
	});

	// Profile update mutation
	const updateProfileMutation = useMutation({
		mutationFn: async (data: {
			name: string;
			image: string;
			firstName: string;
			lastName: string;
			gender: string;
			birthday: Date | null;
		}) => {
			// Update user profile and employee info in parallel
			const [profileResult, employeeResult] = await Promise.all([
				updateProfile({
					name: data.name,
					image: data.image,
				}),
				updateOwnProfile({
					firstName: data.firstName || undefined,
					lastName: data.lastName || undefined,
					gender: data.gender as "male" | "female" | "other" | undefined,
					birthday: data.birthday || undefined,
				}),
			]);
			return { profileResult, employeeResult };
		},
		onSuccess: ({ profileResult, employeeResult }) => {
			if (profileResult.success && employeeResult.success) {
				toast.success(t("profile.update-success", "Profile updated successfully"));
				queryClient.invalidateQueries({ queryKey: queryKeys.profile.current() });
				queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
				router.refresh(); // Refresh to update server components (sidebar)
			} else {
				const errorMsg = !profileResult.success
					? profileResult.error
					: !employeeResult.success
						? employeeResult.error
						: t("profile.update-failed", "Failed to update profile");
				toast.error(errorMsg);
			}
		},
		onError: () => {
			toast.error(t("profile.update-failed", "Failed to update profile"));
		},
	});

	// Handle profile form submit
	const handleProfileSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		updateProfileMutation.mutate(profileData);
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
										<UserAvatar
											seed={user.id}
											image={previewUrl || profileData.image || undefined}
											name={user.name}
											size="xl"
										/>
										{isUploadingAvatar && (
											<div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
												<IconLoader2 className="h-8 w-8 animate-spin text-white" />
											</div>
										)}
										<button
											type="button"
											onClick={() => inputRef.current?.click()}
											disabled={isUploadingAvatar}
											aria-label={t("profile.change-picture", "Change Picture")}
											className="absolute bottom-0 right-0 rounded-full bg-primary p-2 text-primary-foreground shadow-lg transition-transform hover:scale-110 focus-visible:scale-110 disabled:opacity-50"
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
												disabled={
													isUploadingAvatar ||
													updateProfileMutation.isPending ||
													removeAvatarMutation.isPending
												}
											>
												<IconUpload className="mr-2 h-4 w-4" />
												{t("profile.change-picture", "Change Picture")}
											</Button>
											{profileData.image && (
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => removeAvatarMutation.mutate()}
													disabled={
														isUploadingAvatar ||
														updateProfileMutation.isPending ||
														removeAvatarMutation.isPending
													}
												>
													{removeAvatarMutation.isPending ? (
														<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
													) : (
														<IconTrash className="mr-2 h-4 w-4" />
													)}
													{t("profile.remove-picture", "Remove Picture")}
												</Button>
											)}
										</div>
										<p className="text-muted-foreground text-sm">
											{t(
												"profile.picture-hint",
												"JPG, PNG or WebP. Max 5MB. Recommended 400x400px",
											)}
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
									autoComplete="name"
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
											name="firstName"
											autoComplete="given-name"
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
											name="lastName"
											autoComplete="family-name"
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
									<Label id="gender-label">Gender</Label>
									<div
										role="radiogroup"
										aria-labelledby="gender-label"
										className="grid grid-cols-3 gap-3"
									>
										<button
											type="button"
											role="radio"
											aria-checked={profileData.gender === "male"}
											onClick={() => setProfileData((prev) => ({ ...prev, gender: "male" }))}
											className={cn(
												"flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition-[border-color,background-color] hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
											role="radio"
											aria-checked={profileData.gender === "female"}
											onClick={() => setProfileData((prev) => ({ ...prev, gender: "female" }))}
											className={cn(
												"flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition-[border-color,background-color] hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
											role="radio"
											aria-checked={profileData.gender === "other"}
											onClick={() => setProfileData((prev) => ({ ...prev, gender: "other" }))}
											className={cn(
												"flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition-[border-color,background-color] hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
							<Button type="submit" disabled={updateProfileMutation.isPending}>
								{updateProfileMutation.isPending ? (
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
