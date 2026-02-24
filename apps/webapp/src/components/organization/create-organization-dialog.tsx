"use client";

import { IconBuilding, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { checkSlugAvailability } from "@/app/[locale]/(app)/organization-actions";
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
import { authClient } from "@/lib/auth-client";
import { generateSlug } from "@/lib/validations/organization";

interface CreateOrganizationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: () => void;
}

export function CreateOrganizationDialog({
	open,
	onOpenChange,
	onSuccess,
}: CreateOrganizationDialogProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [checkingSlug, setCheckingSlug] = useState(false);
	const [slugError, setSlugError] = useState<string | null>(null);
	const slugManuallyEdited = useRef(false);

	const form = useForm({
		defaultValues: {
			name: "",
			slug: "",
		},
		onSubmit: async ({ value }) => {
			// Final slug availability check
			if (slugError) {
				return;
			}

			setLoading(true);

			// Create organization using Better Auth
			const result = await authClient.organization
				.create({
					name: value.name,
					slug: value.slug,
				})
				.catch((error: unknown) => {
					console.error("Error creating organization:", error);
					const message =
						error instanceof Error
							? error.message
							: t("organization.createError", "Failed to create organization");
					toast.error(message);
					return null;
				});

			if (!result) {
				setLoading(false);
				return;
			}

			if (result.error) {
				toast.error(
					result.error.message || t("organization.createError", "Failed to create organization"),
				);
				setLoading(false);
				return;
			}

			toast.success(t("organization.createSuccess", "Organization created successfully!"));

			// Reset form
			form.reset();
			slugManuallyEdited.current = false;

			// Close dialog
			onOpenChange(false);

			// Call success callback
			onSuccess?.();

			// Refresh the page to update organization context
			router.refresh();
			setLoading(false);
		},
	});

	const formValues = useStore(form.store, (state) => state.values);
	const name = formValues.name;
	const slug = formValues.slug;

	// Auto-generate slug from name
	useEffect(() => {
		if (name && !slugManuallyEdited.current) {
			const generatedSlug = generateSlug(name);
			form.setFieldValue("slug", generatedSlug);
		}
	}, [name, form]);

	// Validate slug availability (debounced)
	useEffect(() => {
		if (!slug || slug.length < 2) {
			return;
		}

		const timeoutId = setTimeout(async () => {
			setCheckingSlug(true);
			checkSlugAvailability(slug)
				.then((isAvailable) => {
					if (!isAvailable) {
						setSlugError(
							t(
								"organization.slugTaken",
								"This slug is already taken. Please choose a different one.",
							),
						);
						return;
					}

					setSlugError(null);
				})
				.catch((error: unknown) => {
					console.error("Error checking slug availability:", error);
				})
				.finally(() => {
					setCheckingSlug(false);
				});
		}, 500);

		return () => clearTimeout(timeoutId);
	}, [slug, t]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<div className="flex items-center gap-3">
						<div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
							<IconBuilding className="size-5 text-primary" />
						</div>
						<div>
							<DialogTitle>
								{t("organization.createDialog.title", "Create Organization")}
							</DialogTitle>
							<DialogDescription>
								{t(
									"organization.createDialog.description",
									"Set up your organization to get started",
								)}
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					{/* Organization Name */}
					<form.Field
						name="name"
						validators={{
							onChange: z
								.string()
								.min(2, "Organization name must be at least 2 characters")
								.max(100),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label>{t("organization.nameLabel", "Organization Name")}</Label>
								<Input
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder={t("organization.namePlaceholder", "Acme Inc.")}
									disabled={loading}
								/>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm font-medium text-destructive">
										{typeof field.state.meta.errors[0] === "string"
											? field.state.meta.errors[0]
											: (field.state.meta.errors[0] as any)?.message}
									</p>
								)}
							</div>
						)}
					</form.Field>

					{/* Organization Slug */}
					<form.Field
						name="slug"
						validators={{
							onChange: z
								.string()
								.min(2, "Slug must be at least 2 characters")
								.max(50, "Slug must be less than 50 characters")
								.regex(
									/^[a-z0-9-]+$/,
									"Slug must contain only lowercase letters, numbers, and hyphens",
								)
								.refine((slug) => !slug.startsWith("-") && !slug.endsWith("-"), {
									message: "Slug cannot start or end with a hyphen",
								}),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label>{t("organization.slugLabel", "Organization Slug")}</Label>
								<div className="relative">
									<Input
										value={field.state.value}
										onChange={(e) => {
											slugManuallyEdited.current = true;
											setSlugError(null);
											field.handleChange(e.target.value);
										}}
										onBlur={field.handleBlur}
										placeholder={t("organization.slugPlaceholder", "acme-inc")}
										disabled={loading}
									/>
									{checkingSlug && (
										<div className="absolute right-3 top-1/2 -translate-y-1/2">
											<IconLoader2 className="size-4 animate-spin text-muted-foreground" />
										</div>
									)}
								</div>
								<p className="text-sm text-muted-foreground">
									{t("organization.slugDescription", "Used in URLs. Auto-generated from name.")}
								</p>
								{slugError && <p className="text-sm font-medium text-destructive">{slugError}</p>}
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm font-medium text-destructive">
										{typeof field.state.meta.errors[0] === "string"
											? field.state.meta.errors[0]
											: (field.state.meta.errors[0] as any)?.message}
									</p>
								)}
							</div>
						)}
					</form.Field>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={loading}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={loading || checkingSlug || !!slugError}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("common.create", "Create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
