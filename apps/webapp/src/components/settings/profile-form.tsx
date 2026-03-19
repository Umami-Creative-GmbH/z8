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
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { updateProfileDetails, updateProfileImage } from "@/app/[locale]/(app)/settings/profile/actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { TFormControl, fieldHasError, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { UserAvatar } from "@/components/user-avatar";
import { useImageUpload } from "@/hooks/use-image-upload";
import { format } from "@/lib/datetime/luxon-utils";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { validateStructuredProfileNameField } from "@/lib/validations/profile";
import { useRouter } from "@/navigation";

interface ProfileFormProps {
	user: {
		id: string;
		name: string;
		email: string;
		firstName?: string | null;
		lastName?: string | null;
		image?: string | null;
	};
}

type ProfileFormValues = {
	image: string;
	firstName: string;
	lastName: string;
	gender: "" | "male" | "female" | "other";
	birthday: Date | null;
};

export function ProfileForm({ user }: ProfileFormProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [isInitialLoading, setIsInitialLoading] = useState(true);
	const defaultValues: ProfileFormValues = {
		image: user.image || "",
		firstName: user.firstName || "",
		lastName: user.lastName || "",
		gender: "",
		birthday: null,
	};

	const form = useForm({
		defaultValues,
		onSubmitInvalid: ({ formApi }) => {
			for (const fieldName of ["firstName", "lastName"] as const) {
				if (formApi.getFieldMeta(fieldName)?.errors.length) {
					document.querySelector<HTMLInputElement>(`input[name="${fieldName}"]`)?.focus();
					break;
				}
			}
		},
		onSubmit: async ({ value }) => {
			try {
				const profileResult = await updateProfileDetails({
					firstName: value.firstName,
					lastName: value.lastName,
					gender: value.gender || null,
					birthday: value.birthday,
					image: value.image || null,
				});

				if (profileResult.success) {
					toast.success(t("profile.update-success", "Profile updated successfully"));
					await Promise.all([
						queryClient.invalidateQueries({ queryKey: queryKeys.profile.current() }),
						queryClient.invalidateQueries({ queryKey: queryKeys.employees.all }),
					]);
					router.refresh();
					return;
				}

				toast.error(profileResult.error || t("profile.update-failed", "Failed to update profile"));
			} catch {
				toast.error(t("profile.update-failed", "Failed to update profile"));
			}
		},
	});

	const validateFirstName = useCallback(
		(value: string) =>
			validateStructuredProfileNameField("firstName", {
				firstName: value,
				lastName: form.store.state.values.lastName,
			}),
		[form.store],
	);

	const validateLastName = useCallback(
		(value: string) =>
			validateStructuredProfileNameField("lastName", {
				firstName: form.store.state.values.firstName,
				lastName: value,
			}),
		[form.store],
	);

	const avatarImage = useStore(form.store, (state) => state.values.image);
	const selectedGender = useStore(form.store, (state) => state.values.gender);
	const selectedBirthday = useStore(form.store, (state) => state.values.birthday);
	const firstName = useStore(form.store, (state) => state.values.firstName);
	const lastName = useStore(form.store, (state) => state.values.lastName);
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
	const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || user.name;

	// Avatar update mutation (for saving URL to user profile after upload)
	const avatarUpdateMutation = useMutation({
		mutationFn: (data: { image: string | null }) => updateProfileImage(data),
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
			form.setFieldValue("image", imageUrl);

			avatarUpdateMutation.mutate({ image: imageUrl });
		},
		onError: (error) => {
			toast.error(error?.message || t("profile.avatar-upload-failed", "Failed to upload avatar"));
		},
	});

	// Load employee personal info
	useEffect(() => {
		let isMounted = true;

		async function loadEmployeeData() {
			const emp = await getCurrentEmployee().then((value) => value, () => null);

			if (!isMounted) {
				return;
			}

			form.setFieldValue("image", user.image || "");
			form.setFieldValue("firstName", emp?.firstName || user.firstName || "");
			form.setFieldValue("lastName", emp?.lastName || user.lastName || "");
			form.setFieldValue("gender", (emp?.gender as ProfileFormValues["gender"] | null) || "");
			form.setFieldValue("birthday", emp?.birthday ? new Date(emp.birthday) : null);
			setIsInitialLoading(false);
		}

		loadEmployeeData();

		return () => {
			isMounted = false;
		};
	}, [form, user.firstName, user.image, user.lastName]);

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
		mutationFn: () => updateProfileImage({ image: null }),
		onMutate: () => {
			const previousImage = form.store.state.values.image;
			form.setFieldValue("image", "");
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
			if (context?.previousImage) {
				form.setFieldValue("image", context.previousImage);
			}
			toast.error(t("profile.avatar-remove-failed", "Failed to remove avatar"));
		},
	});

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
						<form
							onSubmit={(e) => {
								e.preventDefault();
								form.handleSubmit();
							}}
							className="space-y-6"
						>
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
											image={previewUrl || avatarImage || undefined}
											name={displayName}
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
													isSubmitting ||
													removeAvatarMutation.isPending
												}
											>
												<IconUpload className="mr-2 h-4 w-4" />
												{t("profile.change-picture", "Change Picture")}
											</Button>
											{avatarImage && (
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => removeAvatarMutation.mutate()}
													disabled={
														isUploadingAvatar ||
														isSubmitting ||
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

							{/* Email Field (Read-only) */}
							<div className="space-y-2">
								<Label htmlFor="email">{t("profile.email", "Email")}</Label>
								<Input
									id="email"
									name="email"
									type="email"
									autoComplete="email"
									spellCheck={false}
									value={user.email}
									disabled
									className="bg-muted"
								/>
								<p className="text-muted-foreground text-sm">
									{t("profile.email-readonly", "Email cannot be changed")}
								</p>
							</div>

							{/* Personal Information Section */}
							<div className="border-t pt-6 space-y-6">
								<h3 className="text-lg font-medium">Personal Information</h3>

								<div className="grid gap-4 md:grid-cols-2">
									<form.Field
										name="firstName"
										validators={{
											onBlur: ({ value }) => validateFirstName(value),
											onChangeListenTo: ["lastName"],
											onChange: ({ value }) => validateFirstName(value),
											onSubmit: ({ value }) => validateFirstName(value),
										}}
									>
										{(field) => {
											const hasError = fieldHasError(field);

											return (
												<TFormItem>
													<TFormLabel hasError={hasError}>First Name</TFormLabel>
													<TFormControl hasError={hasError}>
														<Input
															name="firstName"
															autoComplete="given-name"
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															onBlur={field.handleBlur}
															placeholder="Ada…"
														/>
													</TFormControl>
													<TFormMessage field={field} />
												</TFormItem>
											);
										}}
									</form.Field>

									<form.Field
										name="lastName"
										validators={{
											onBlur: ({ value }) => validateLastName(value),
											onChangeListenTo: ["firstName"],
											onChange: ({ value }) => validateLastName(value),
											onSubmit: ({ value }) => validateLastName(value),
										}}
									>
										{(field) => {
											const hasError = fieldHasError(field);

											return (
												<TFormItem>
													<TFormLabel hasError={hasError}>Last Name</TFormLabel>
													<TFormControl hasError={hasError}>
														<Input
															name="lastName"
															autoComplete="family-name"
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															onBlur={field.handleBlur}
															placeholder="Lovelace…"
														/>
													</TFormControl>
													<TFormMessage field={field} />
												</TFormItem>
											);
										}}
									</form.Field>
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
											aria-checked={selectedGender === "male"}
											onClick={() => form.setFieldValue("gender", "male")}
											className={cn(
												"flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition-[border-color,background-color] hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
												selectedGender === "male"
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
											aria-checked={selectedGender === "female"}
											onClick={() => form.setFieldValue("gender", "female")}
											className={cn(
												"flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition-[border-color,background-color] hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
												selectedGender === "female"
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
											aria-checked={selectedGender === "other"}
											onClick={() => form.setFieldValue("gender", "other")}
											className={cn(
												"flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition-[border-color,background-color] hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
												selectedGender === "other"
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
													!selectedBirthday && "text-muted-foreground",
												)}
											>
												<IconCalendar className="mr-2 h-4 w-4" />
												{selectedBirthday ? (
													format(selectedBirthday, "PPP")
												) : (
													<span>Pick your birthday</span>
												)}
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-auto p-0" align="start">
									<Calendar
										mode="single"
										selected={selectedBirthday || undefined}
										onSelect={(date) => form.setFieldValue("birthday", date || null)}
										disabled={(date) => date > new Date()}
										initialFocus
										captionLayout="dropdown"
										startMonth={new Date(1940, 0)}
										endMonth={new Date()}
										defaultMonth={selectedBirthday || new Date(2000, 0)}
									/>
								</PopoverContent>
							</Popover>
									<p className="text-muted-foreground text-sm">
										Your birthday helps us celebrate with you
									</p>
								</div>
							</div>

							{/* Submit Button */}
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? (
									<>
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
										{t("common.saving", "Saving…")}
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
