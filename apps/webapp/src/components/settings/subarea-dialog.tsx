"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createSubarea,
	updateSubarea,
	type SubareaWithEmployees,
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

interface SubareaDialogProps {
	locationId: string;
	subarea: SubareaWithEmployees | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
}

interface FormValues {
	name: string;
	isActive: boolean;
}

export function SubareaDialog({
	locationId,
	subarea,
	open,
	onOpenChange,
	onSuccess,
}: SubareaDialogProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const isEditing = !!subarea;

	const defaultValues: FormValues = {
		name: subarea?.name || "",
		isActive: subarea?.isActive ?? true,
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);
			try {
				if (isEditing && subarea) {
					const result = await updateSubarea(subarea.id, {
						name: value.name,
						isActive: value.isActive,
					});

					if (result.success) {
						toast.success(t("settings.locations.subareaUpdated", "Subarea updated"));
						onSuccess();
					} else {
						toast.error(
							result.error ||
								t("settings.locations.subareaUpdateFailed", "Failed to update subarea"),
						);
					}
				} else {
					const result = await createSubarea({
						locationId,
						name: value.name,
					});

					if (result.success) {
						toast.success(t("settings.locations.subareaCreated", "Subarea created"));
						onSuccess();
					} else {
						toast.error(
							result.error ||
								t("settings.locations.subareaCreateFailed", "Failed to create subarea"),
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
			<DialogContent className="sm:max-w-[400px]">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.locations.subareaDialog.editTitle", "Edit Subarea")
							: t("settings.locations.subareaDialog.createTitle", "Add Subarea")}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? t("settings.locations.subareaDialog.editDescription", "Update subarea details")
							: t(
									"settings.locations.subareaDialog.createDescription",
									"Add a new subarea to this location",
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
									<Label htmlFor="subarea-name">
										{t("settings.locations.field.subareaName", "Name")} *
									</Label>
									<Input
										id="subarea-name"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.locations.field.subareaNamePlaceholder",
											"e.g., Cashier, Storage, Bistro",
										)}
									/>
								</div>
							)}
						</form.Field>

						{/* Active Status (only show when editing) */}
						{isEditing && (
							<form.Field name="isActive">
								{(field) => (
									<div className="flex items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label htmlFor="subarea-isActive">
												{t("settings.locations.field.active", "Active")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.locations.field.subareaActiveHelp",
													"Inactive subareas won't appear in selection lists",
												)}
											</p>
										</div>
										<Switch
											id="subarea-isActive"
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
								? t("settings.locations.subareaDialog.save", "Save Changes")
								: t("settings.locations.subareaDialog.create", "Add Subarea")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
