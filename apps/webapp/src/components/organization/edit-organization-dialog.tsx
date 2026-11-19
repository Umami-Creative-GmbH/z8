"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { updateOrganizationDetails } from "@/app/[locale]/(app)/settings/organization/actions";
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
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type * as authSchema from "@/db/auth-schema";
import { useRouter } from "@/navigation";

type Organization = typeof authSchema.organization.$inferSelect;

interface EditOrganizationDialogProps {
	organization: Organization;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface EditOrganizationFormValues {
	name: string;
	slug: string;
	description: string;
}

// Mirrors `updateOrganizationSchema` (lib/validations/invitation.ts), which the
// server applies to every field it receives.
const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 100;
const SLUG_MIN_LENGTH = 2;
const SLUG_MAX_LENGTH = 50;

function parseOrganizationMetadata(metadata: string | null): Record<string, string> {
	if (!metadata) return {};
	try {
		const parsed: unknown = JSON.parse(metadata);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, string>)
			: {};
	} catch {
		return {};
	}
}

function organizationFormValues(organization: Organization): EditOrganizationFormValues {
	return {
		name: organization.name,
		slug: organization.slug || "",
		description: parseOrganizationMetadata(organization.metadata).description || "",
	};
}

export function EditOrganizationDialog({
	organization,
	open,
	onOpenChange,
}: EditOrganizationDialogProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();

	const form = useForm({
		defaultValues: organizationFormValues(organization),
		onSubmit: async ({ value }) => {
			// Parse existing metadata; unreadable metadata must not crash the settings page.
			const existingMetadata = parseOrganizationMetadata(organization.metadata);
			const metadata = JSON.stringify({
				...existingMetadata,
				description: value.description,
			});

			try {
				// Only changed fields are sent, as before.
				const result = await updateOrganizationDetails({
					name: value.name !== organization.name ? value.name : undefined,
					slug: value.slug !== (organization.slug || "") ? value.slug : undefined,
					metadata:
						value.description !== (existingMetadata.description || "") ? metadata : undefined,
				});

				if (result.success) {
					toast.success(t("organization.edit.updateSuccess", "Organization updated successfully"));
					onOpenChange(false);
					refresh();
				} else {
					toast.error(
						result.error || t("organization.edit.updateError", "Failed to update organization"),
					);
				}
			} catch {
				toast.error(t("organization.edit.updateError", "Failed to update organization"));
			}
		},
	});

	// Start every editing session from the organization as it is now, so a
	// cancelled edit or a change saved elsewhere never leaves stale values behind.
	const wasOpen = useRef(open);
	useEffect(() => {
		if (open && !wasOpen.current) {
			form.reset(organizationFormValues(organization));
		}
		wasOpen.current = open;
	}, [open, organization, form]);

	const handleOpenChange = (nextOpen: boolean) => {
		// A save that is still running keeps the panel open.
		if (!nextOpen && form.state.isSubmitting) return;
		onOpenChange(nextOpen);
	};

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("organization.edit.title", "Edit Organization")}</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"organization.edit.description",
							"Update your organization details. Changes will be visible to all members.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<>
								<ActionPanelBody className="space-y-4">
									<fieldset className="contents" disabled={isSubmitting}>
										<form.Field
											name="name"
											validators={{
												onChange: ({ value }) => {
													// Like the slug, the name is sent and validated only when it changed.
													if (value === organization.name) return undefined;
													if (value.length < NAME_MIN_LENGTH) {
														return t(
															"organization.edit.validation.nameMin",
															"Name must be at least 2 characters",
														);
													}
													if (value.length > NAME_MAX_LENGTH) {
														return t(
															"organization.edit.validation.nameMax",
															"Name cannot exceed 100 characters",
														);
													}
													return undefined;
												},
											}}
										>
											{(field) => (
												<TFormItem>
													<TFormLabel hasError={fieldHasError(field)} required>
														{t("organization.edit.nameLabel", "Organization Name")}
													</TFormLabel>
													<TFormControl hasError={fieldHasError(field)}>
														<Input
															name={field.name}
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															onBlur={field.handleBlur}
															placeholder="Acme Corporation"
															autoComplete="organization"
															aria-required="true"
														/>
													</TFormControl>
													<TFormMessage field={field} />
												</TFormItem>
											)}
										</form.Field>

										<form.Field
											name="slug"
											validators={{
												onChange: ({ value }) => {
													// The server validates the slug only when it is sent, i.e. when it changed.
													if (value === (organization.slug || "")) return undefined;
													if (value.length < SLUG_MIN_LENGTH) {
														return t(
															"organization.edit.validation.slugMin",
															"Slug must be at least 2 characters",
														);
													}
													if (value.length > SLUG_MAX_LENGTH) {
														return t(
															"organization.edit.validation.slugMax",
															"Slug cannot exceed 50 characters",
														);
													}
													return undefined;
												},
											}}
										>
											{(field) => (
												<TFormItem>
													<TFormLabel hasError={fieldHasError(field)}>
														{t("organization.edit.slugLabel", "Organization Slug")}
													</TFormLabel>
													<TFormControl hasError={fieldHasError(field)}>
														<Input
															name={field.name}
															value={field.state.value}
															onChange={(e) =>
																field.handleChange(
																	e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
																)
															}
															onBlur={field.handleBlur}
															placeholder="acme-corp"
															autoComplete="off"
															spellCheck={false}
														/>
													</TFormControl>
													<TFormDescription className="text-xs">
														{t(
															"organization.edit.slugHelp",
															"Only lowercase letters, numbers, and hyphens",
														)}
													</TFormDescription>
													<TFormMessage field={field} />
												</TFormItem>
											)}
										</form.Field>

										<form.Field name="description">
											{(field) => (
												<TFormItem>
													<TFormLabel>{t("common.description", "Description")}</TFormLabel>
													<TFormControl>
														<Textarea
															name={field.name}
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															onBlur={field.handleBlur}
															placeholder={t(
																"organization.edit.descriptionPlaceholder",
																"A brief description of your organization",
															)}
															rows={3}
														/>
													</TFormControl>
												</TFormItem>
											)}
										</form.Field>
									</fieldset>
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
									<Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
										{isSubmitting && (
											<IconLoader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
										)}
										{t("common.saveChanges", "Save Changes")}
									</Button>
								</ActionPanelFooter>
							</>
						)}
					</form.Subscribe>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
