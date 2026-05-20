"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateOrganizationDetails } from "@/app/[locale]/(app)/settings/organizations/actions";
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
import { Textarea } from "@/components/ui/textarea";
import type * as authSchema from "@/db/auth-schema";
import { useRouter } from "@/navigation";

interface EditOrganizationDialogProps {
	organization: typeof authSchema.organization.$inferSelect;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function EditOrganizationDialog({
	organization,
	open,
	onOpenChange,
}: EditOrganizationDialogProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	// Parse existing metadata
	const existingMetadata = organization.metadata
		? (JSON.parse(organization.metadata as string) as Record<string, string>)
		: {};

	const [formData, setFormData] = useState({
		name: organization.name,
		slug: organization.slug || "",
		description: existingMetadata.description || "",
	});

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		startTransition(async () => {
			const metadata = JSON.stringify({
				...existingMetadata,
				description: formData.description,
			});

			const result = await updateOrganizationDetails(organization.id, {
				name: formData.name !== organization.name ? formData.name : undefined,
				slug: formData.slug !== organization.slug ? formData.slug : undefined,
				metadata: formData.description !== existingMetadata.description ? metadata : undefined,
			});

			if (result.success) {
				toast.success(t("organization.edit.updateSuccess", "Organization updated successfully"));
				onOpenChange(false);
				router.refresh();
			} else {
				toast.error(result.error || t("organization.edit.updateError", "Failed to update organization"));
			}
		});
	};

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
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

				<form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
					<ActionPanelBody className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="name">{t("organization.edit.nameLabel", "Organization Name")}</Label>
							<Input
								id="name"
								value={formData.name}
								onChange={(e) => setFormData({ ...formData, name: e.target.value })}
								placeholder="Acme Corporation"
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="slug">{t("organization.edit.slugLabel", "Organization Slug")}</Label>
							<Input
								id="slug"
								value={formData.slug}
								onChange={(e) =>
									setFormData({
										...formData,
										slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
									})
								}
								placeholder="acme-corp"
								pattern="[a-z0-9-]+"
								title={t("organization.edit.slugHelp", "Only lowercase letters, numbers, and hyphens")}
							/>
							<p className="text-xs text-muted-foreground">
								{t("organization.edit.slugHelp", "Only lowercase letters, numbers, and hyphens")}
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">{t("common.description", "Description")}</Label>
							<Textarea
								id="description"
								value={formData.description}
								onChange={(e) => setFormData({ ...formData, description: e.target.value })}
								placeholder={t(
									"organization.edit.descriptionPlaceholder",
									"A brief description of your organization",
								)}
								rows={3}
							/>
						</div>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("common.saveChanges", "Save Changes")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
