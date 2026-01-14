"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createLocation,
	type LocationListItem,
	updateLocation,
} from "@/app/[locale]/(app)/settings/locations/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface LocationDialogProps {
	organizationId: string;
	location: LocationListItem | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
}

interface FormValues {
	name: string;
	street: string;
	city: string;
	postalCode: string;
	country: string;
	isActive: boolean;
}

export function LocationDialog({
	organizationId,
	location,
	open,
	onOpenChange,
	onSuccess,
}: LocationDialogProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const isEditing = !!location;

	const defaultValues: FormValues = {
		name: location?.name || "",
		street: "",
		city: location?.city || "",
		postalCode: "",
		country: location?.country || "",
		isActive: location?.isActive ?? true,
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);
			try {
				if (isEditing && location) {
					const result = await updateLocation(location.id, {
						name: value.name,
						street: value.street || undefined,
						city: value.city || undefined,
						postalCode: value.postalCode || undefined,
						country: value.country || undefined,
						isActive: value.isActive,
					});

					if (result.success) {
						toast.success(t("settings.locations.updated", "Location updated"));
						onSuccess();
					} else {
						toast.error(
							result.error || t("settings.locations.updateFailed", "Failed to update location"),
						);
					}
				} else {
					const result = await createLocation({
						organizationId,
						name: value.name,
						street: value.street || undefined,
						city: value.city || undefined,
						postalCode: value.postalCode || undefined,
						country: value.country || undefined,
					});

					if (result.success) {
						toast.success(t("settings.locations.created", "Location created"));
						onSuccess();
					} else {
						toast.error(
							result.error || t("settings.locations.createFailed", "Failed to create location"),
						);
					}
				}
			} finally {
				setIsSubmitting(false);
			}
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.locations.dialog.editTitle", "Edit Location")
							: t("settings.locations.dialog.createTitle", "Create Location")}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? t("settings.locations.dialog.editDescription", "Update location details")
							: t(
									"settings.locations.dialog.createDescription",
									"Create a new location for your organization",
								)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<div className="grid gap-4 py-4">
						{/* Name */}
						<form.Field name="name">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="name">{t("settings.locations.field.name", "Name")} *</Label>
									<Input
										id="name"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("settings.locations.field.namePlaceholder", "e.g., Main Office")}
									/>
								</div>
							)}
						</form.Field>

						{/* Street */}
						<form.Field name="street">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="street">{t("settings.locations.field.street", "Street")}</Label>
									<Input
										id="street"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("settings.locations.field.streetPlaceholder", "e.g., 123 Main St")}
									/>
								</div>
							)}
						</form.Field>

						{/* City & Postal Code */}
						<div className="grid grid-cols-2 gap-4">
							<form.Field name="city">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor="city">{t("settings.locations.field.city", "City")}</Label>
										<Input
											id="city"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t("settings.locations.field.cityPlaceholder", "e.g., New York")}
										/>
									</div>
								)}
							</form.Field>

							<form.Field name="postalCode">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor="postalCode">
											{t("settings.locations.field.postalCode", "Postal Code")}
										</Label>
										<Input
											id="postalCode"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t("settings.locations.field.postalCodePlaceholder", "e.g., 10001")}
										/>
									</div>
								)}
							</form.Field>
						</div>

						{/* Country */}
						<form.Field name="country">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="country">
										{t("settings.locations.field.country", "Country Code")}
									</Label>
									<Input
										id="country"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value.toUpperCase())}
										onBlur={field.handleBlur}
										placeholder={t("settings.locations.field.countryPlaceholder", "e.g., US, DE")}
										maxLength={2}
									/>
									<p className="text-xs text-muted-foreground">
										{t("settings.locations.field.countryHelp", "ISO 3166-1 alpha-2 code")}
									</p>
								</div>
							)}
						</form.Field>

						{/* Active Status (only show when editing) */}
						{isEditing && (
							<form.Field name="isActive">
								{(field) => (
									<div className="flex items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label htmlFor="isActive">
												{t("settings.locations.field.active", "Active")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.locations.field.activeHelp",
													"Inactive locations won't appear in selection lists",
												)}
											</p>
										</div>
										<Switch
											id="isActive"
											checked={field.state.value}
											onCheckedChange={field.handleChange}
										/>
									</div>
								)}
							</form.Field>
						)}
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isEditing
								? t("settings.locations.dialog.save", "Save Changes")
								: t("settings.locations.dialog.create", "Create Location")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
