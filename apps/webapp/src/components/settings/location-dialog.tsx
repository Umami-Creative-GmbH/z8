"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
	createLocation,
	type LocationListItem,
	updateLocation,
} from "@/app/[locale]/(app)/settings/locations/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";

interface LocationDialogProps {
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

function useLocationForm({
	location,
	onSuccess,
}: Pick<LocationDialogProps, "location" | "onSuccess">) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const submissionPending = useRef(false);
	const nameInputRef = useRef<HTMLInputElement>(null);
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
		onSubmitInvalid: () => nameInputRef.current?.focus(),
		onSubmit: async ({ value }) => {
			if (submissionPending.current) return;
			submissionPending.current = true;
			setIsSubmitting(true);
			setSubmitError(null);
			if (isEditing && location) {
				const result = await updateLocation({
					locationId: location.id,
					data: {
						name: value.name,
						street: value.street || undefined,
						city: value.city || undefined,
						postalCode: value.postalCode || undefined,
						country: value.country || undefined,
						isActive: value.isActive,
					},
				}).then(
					(response) => response,
					() => null,
				);

				if (result?.success) {
					toast.success(t("settings.locations.updated", "Location updated"));
					onSuccess();
				} else {
					setSubmitError(
						actionErrorMessage(t, result, {}, [
							"settings.locations.updateFailed",
							"Failed to update location",
						]),
					);
					toast.error(
						actionErrorMessage(t, result, {}, [
							"settings.locations.updateFailed",
							"Failed to update location",
						]),
					);
				}
			} else {
				const result = await createLocation({
					name: value.name,
					street: value.street || undefined,
					city: value.city || undefined,
					postalCode: value.postalCode || undefined,
					country: value.country || undefined,
				}).then(
					(response) => response,
					() => null,
				);

				if (result?.success) {
					toast.success(t("settings.locations.created", "Location created"));
					onSuccess();
				} else {
					setSubmitError(
						actionErrorMessage(t, result, {}, [
							"settings.locations.createFailed",
							"Failed to create location",
						]),
					);
					toast.error(
						actionErrorMessage(t, result, {}, [
							"settings.locations.createFailed",
							"Failed to create location",
						]),
					);
				}
			}

			setIsSubmitting(false);
			submissionPending.current = false;
		},
	});
	return { form, isSubmitting, submitError, nameInputRef, isEditing };
}

export function LocationDialog({
	location,
	open,
	onOpenChange,
	onSuccess,
}: LocationDialogProps) {
	const { t } = useTranslate();
	const { form, isSubmitting, submitError, nameInputRef, isEditing } =
		useLocationForm({ location, onSuccess });
	// Unique per instance, so two open panels never share label targets.
	const idPrefix = useId();
	const fieldIds = {
		street: `${idPrefix}-street`,
		city: `${idPrefix}-city`,
		postalCode: `${idPrefix}-postalCode`,
		country: `${idPrefix}-country`,
		isActive: `${idPrefix}-isActive`,
	};

	return (
		<ActionPanel
			open={open}
			onOpenChange={(nextOpen, details) => {
				if (!nextOpen && isSubmitting) {
					details.cancel();
					return;
				}
				onOpenChange(nextOpen);
			}}
		>
			<ActionPanelContent showCloseButton={!isSubmitting}>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{isEditing
							? t("settings.locations.dialog.editTitle", "Edit Location")
							: t("settings.locations.dialog.createTitle", "Create Location")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{isEditing
							? t(
									"settings.locations.dialog.editDescription",
									"Update location details",
								)
							: t(
									"settings.locations.dialog.createDescription",
									"Create a new location for your organization",
								)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					aria-busy={isSubmitting}
					noValidate
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						if (!isSubmitting) void form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="grid content-start gap-4">
						{submitError && (
							<p role="alert" className="text-sm text-destructive">
								{submitError}
							</p>
						)}
						{/* Name */}
						<form.Field
							name="name"
							validators={{
								onChange: ({ value }) =>
									value.trim()
										? undefined
										: t("settings.locations.nameRequired", "Name is required"),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel required hasError={fieldHasError(field)}>
										{t("settings.locations.field.name", "Name")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											ref={nameInputRef}
											name={field.name}
											required
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.locations.field.namePlaceholder",
												"e.g., Main Office",
											)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						{/* Street */}
						<form.Field name="street">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={fieldIds.street}>
										{t("settings.locations.field.street", "Street")}
									</Label>
									<Input
										id={fieldIds.street}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.locations.field.streetPlaceholder",
											"e.g., 123 Main St",
										)}
									/>
								</div>
							)}
						</form.Field>

						{/* City & Postal Code */}
						<div className="grid grid-cols-2 gap-4">
							<form.Field name="city">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor={fieldIds.city}>
											{t("settings.locations.field.city", "City")}
										</Label>
										<Input
											id={fieldIds.city}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.locations.field.cityPlaceholder",
												"e.g., New York",
											)}
										/>
									</div>
								)}
							</form.Field>

							<form.Field name="postalCode">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor={fieldIds.postalCode}>
											{t("settings.locations.field.postalCode", "Postal Code")}
										</Label>
										<Input
											id={fieldIds.postalCode}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.locations.field.postalCodePlaceholder",
												"e.g., 10001",
											)}
										/>
									</div>
								)}
							</form.Field>
						</div>

						{/* Country */}
						<form.Field name="country">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={fieldIds.country}>
										{t("settings.locations.field.country", "Country Code")}
									</Label>
									<Input
										id={fieldIds.country}
										value={field.state.value}
										onChange={(e) =>
											field.handleChange(e.target.value.toUpperCase())
										}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.locations.field.countryPlaceholder",
											"e.g., US, DE",
										)}
										maxLength={2}
									/>
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.locations.field.countryHelp",
											"ISO 3166-1 alpha-2 code",
										)}
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
											<Label htmlFor={fieldIds.isActive}>
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
											id={fieldIds.isActive}
											checked={field.state.value}
											onCheckedChange={field.handleChange}
										/>
									</div>
								)}
							</form.Field>
						)}
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							)}
							{isEditing
								? t("settings.locations.dialog.save", "Save Changes")
								: t("settings.locations.dialog.create", "Create Location")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
