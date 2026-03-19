"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createCustomer,
	type CustomerData,
	updateCustomer,
} from "@/app/[locale]/(app)/settings/customers/actions";
import { getProjects } from "@/app/[locale]/(app)/settings/projects/actions";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query";
import type { SettingsAccessTier } from "@/lib/settings-access";
import {
	buildCreateCustomerInput,
	requiresScopedProjectSelection,
	type CustomerDialogFormValues,
} from "./customer-dialog.helpers";

interface CustomerDialogProps {
	accessTier: SettingsAccessTier;
	organizationId: string;
	customer: CustomerData | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
}

export function CustomerDialog({
	accessTier,
	organizationId,
	customer,
	open,
	onOpenChange,
	onSuccess,
}: CustomerDialogProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const isEditing = !!customer;
	const requiresScopedProject = requiresScopedProjectSelection(accessTier, isEditing);

	const { data: projectsData } = useQuery({
		queryKey: queryKeys.projects.list(organizationId, { scope: "customer-dialog" }),
		queryFn: async () => {
			const result = await getProjects(organizationId);
			if (!result.success) {
				return [];
			}

			return result.data.map((project) => ({ id: project.id, name: project.name }));
		},
		enabled: open && !isEditing,
	});

	const availableProjects = projectsData ?? [];

	const defaultValues: CustomerDialogFormValues = {
		projectId: "",
		name: customer?.name || "",
		address: customer?.address || "",
		vatId: customer?.vatId || "",
		email: customer?.email || "",
		contactPerson: customer?.contactPerson || "",
		phone: customer?.phone || "",
		website: customer?.website || "",
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);

			if (requiresScopedProject && !value.projectId) {
				toast.error(t("settings.customers.projectRequired", "Select a project first"));
				setIsSubmitting(false);
				return;
			}

			if (isEditing && customer) {
				const result = await updateCustomer(customer.id, {
					name: value.name,
					address: value.address || null,
					vatId: value.vatId || null,
					email: value.email || null,
					contactPerson: value.contactPerson || null,
					phone: value.phone || null,
					website: value.website || null,
				}).then((response) => response, () => null);

				if (result?.success) {
					toast.success(t("settings.customers.updated", "Customer updated"));
					onSuccess();
				} else {
					toast.error(
						result?.error ||
							t("settings.customers.updateFailed", "Failed to update customer"),
					);
				}
			} else {
				const result = await createCustomer(buildCreateCustomerInput(organizationId, value)).then(
					(response) => response,
					() => null,
				);

				if (result?.success) {
					toast.success(t("settings.customers.created", "Customer created"));
					onSuccess();
				} else {
					toast.error(
						result?.error ||
							t("settings.customers.createFailed", "Failed to create customer"),
					);
				}
			}

			setIsSubmitting(false);
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.customers.dialog.editTitle", "Edit Customer")
							: t("settings.customers.dialog.createTitle", "Add Customer")}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? t(
									"settings.customers.dialog.editDescription",
									"Update customer details",
								)
							: t(
									"settings.customers.dialog.createDescription",
									"Add a new customer for project assignments",
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
				{/* Company Name (required) */}
						{!isEditing && availableProjects.length > 0 ? (
							<form.Field name="projectId">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor="projectId">
											{requiresScopedProject
												? t("settings.customers.field.project", "Project") + " *"
												: t("settings.customers.field.project", "Project")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value)}
										>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.customers.field.projectPlaceholder",
														"Select a project",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{availableProjects.map((project) => (
													<SelectItem key={project.id} value={project.id}>
														{project.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>
						) : null}

						{/* Company Name (required) */}
						<form.Field name="name">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="name">
										{t("settings.customers.field.name", "Company Name")} *
									</Label>
									<Input
										id="name"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.customers.field.namePlaceholder",
											"Enter company name",
										)}
									/>
								</div>
							)}
						</form.Field>

						{/* Contact Person */}
						<form.Field name="contactPerson">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="contactPerson">
										{t("settings.customers.field.contactPerson", "Contact Person")}
									</Label>
									<Input
										id="contactPerson"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.customers.field.contactPersonPlaceholder",
											"e.g., John Smith",
										)}
									/>
								</div>
							)}
						</form.Field>

						{/* Email & Phone in two columns */}
						<div className="grid grid-cols-2 gap-4">
							<form.Field name="email">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor="email">
											{t("settings.customers.field.email", "Email")}
										</Label>
										<Input
											id="email"
											type="email"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder="email@example.com"
										/>
									</div>
								)}
							</form.Field>

							<form.Field name="phone">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor="phone">
											{t("settings.customers.field.phone", "Phone")}
										</Label>
										<Input
											id="phone"
											type="tel"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder="+49 ..."
										/>
									</div>
								)}
							</form.Field>
						</div>

						{/* Address */}
						<form.Field name="address">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="address">
										{t("settings.customers.field.address", "Address")}
									</Label>
									<Textarea
										id="address"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.customers.field.addressPlaceholder",
											"Street, City, ZIP",
										)}
										rows={2}
									/>
								</div>
							)}
						</form.Field>

						{/* VAT & Website in two columns */}
						<div className="grid grid-cols-2 gap-4">
							<form.Field name="vatId">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor="vatId">
											{t("settings.customers.field.vatId", "VAT ID")}
										</Label>
										<Input
											id="vatId"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder="DE123456789"
										/>
									</div>
								)}
							</form.Field>

							<form.Field name="website">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor="website">
											{t("settings.customers.field.website", "Website")}
										</Label>
										<Input
											id="website"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder="https://..."
										/>
									</div>
								)}
							</form.Field>
						</div>
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
								? t("settings.customers.dialog.save", "Save Changes")
								: t("settings.customers.dialog.create", "Add Customer")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
