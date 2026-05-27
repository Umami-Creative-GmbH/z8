"use client";

import { IconCamera, IconEdit, IconLoader2, IconTrash, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { removeOrganizationLogo } from "@/app/[locale]/(app)/settings/organizations/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type * as authSchema from "@/db/auth-schema";
import { useImageUpload } from "@/hooks/use-image-upload";
import { EditOrganizationDialog } from "./edit-organization-dialog";
import { OrganizationLogo } from "./organization-logo";

interface OrganizationDetailsCardProps {
	organization: typeof authSchema.organization.$inferSelect;
	memberCount: number;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationDetailsCard({
	organization,
	memberCount,
	currentMemberRole,
}: OrganizationDetailsCardProps) {
	const { t } = useTranslate();
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [logoUrl, setLogoUrl] = useState(organization.logo);
	const [isRemovingLogo, setIsRemovingLogo] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const canEdit = currentMemberRole === "owner";
	const metadata = organization.metadata as Record<string, unknown> | null;
	const metadataDescription =
		typeof metadata === "object" && metadata !== null && typeof metadata.description === "string"
			? metadata.description
			: null;

	// Image upload hook
	const {
		addFile,
		progress: uploadProgress,
		isUploading,
		previewUrl,
	} = useImageUpload({
		uploadType: "org-logo",
		organizationId: organization.id,
		onSuccess: (url) => {
			setLogoUrl(url); // Update local state with new logo URL
			toast.success(t("organization.logo-uploaded", "Logo uploaded successfully"));
			// Cache invalidation is handled by useImageProcessMutation
		},
		onError: (error) => {
			toast.error(error?.message || t("organization.logo-upload-failed", "Failed to upload logo"));
		},
	});

	// Handle file input change
	const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (files && files.length > 0) {
			addFile(files[0]);
			e.target.value = "";
		}
	};

	const handleRemoveLogo = async () => {
		setIsRemovingLogo(true);
		const result = await removeOrganizationLogo(organization.id);
		setIsRemovingLogo(false);

		if (!result.success) {
			toast.error(result.error || t("organization.logo-remove-failed", "Failed to remove logo"));
			return;
		}

		setLogoUrl(null);
		toast.success(t("organization.logo-removed", "Organization logo removed"));
	};

	return (
		<>
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between gap-3">
						<div className="flex min-w-0 items-start gap-4">
							{/* Hidden file input */}
							<input
								ref={inputRef}
								type="file"
								accept="image/*"
								className="hidden"
								aria-label={t("organization.logo.uploadLabel", "Upload organization logo")}
								onChange={handleFileInputChange}
							/>
							<div className="relative size-16 shrink-0">
								<OrganizationLogo logo={previewUrl || logoUrl} name={organization.name} />
								{/* Upload progress overlay */}
								{isUploading && (
									<div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-full bg-black/70">
										<IconLoader2 className="size-5 animate-spin text-white" />
										<span className="mt-0.5 text-[10px] font-medium text-white">
											{uploadProgress}%
										</span>
									</div>
								)}
								{canEdit && logoUrl && !isUploading && (
									<button
										type="button"
										onClick={handleRemoveLogo}
										disabled={isRemovingLogo}
										aria-label={t("organization.logo.removeLabel", "Remove organization logo")}
										className="absolute top-0 right-0 rounded-full bg-destructive p-1.5 text-destructive-foreground shadow-lg ring-2 ring-background transition-transform hover:scale-110 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
									>
										{isRemovingLogo ? (
											<IconLoader2 className="size-3 animate-spin text-white" aria-hidden="true" />
										) : (
											<IconTrash className="size-3 text-white" aria-hidden="true" />
										)}
									</button>
								)}
								{canEdit && !isUploading && (
									<button
										type="button"
										onClick={() => inputRef.current?.click()}
										aria-label={t("organization.logo.changeLabel", "Change organization logo")}
										className="absolute right-0 bottom-0 rounded-full bg-primary p-1.5 text-primary-foreground shadow-lg transition-transform hover:scale-110 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
									>
										<IconCamera className="size-3" aria-hidden="true" />
									</button>
								)}
							</div>
							<div className="min-w-0">
								<CardTitle className="text-2xl">{organization.name}</CardTitle>
								<CardDescription className="mt-1">
									{organization.slug && (
										<span className="inline-block max-w-full truncate text-xs font-mono bg-muted px-2 py-1 rounded align-bottom">
											{organization.slug}
										</span>
									)}
								</CardDescription>
							</div>
						</div>
						{canEdit && (
							<Button
								variant="outline"
								size="sm"
								className="shrink-0 px-2 sm:px-3"
								onClick={() => setEditDialogOpen(true)}
							>
								<IconEdit className="size-4 sm:mr-2" />
								<span className="sr-only sm:not-sr-only">{t("common.edit", "Edit")}</span>
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconUsers className="size-4" />
						<span>
							{t(
								"organization.members.count",
								"{count, plural, one {# member} other {# members}}",
								{
									count: memberCount,
								},
							)}
						</span>
					</div>
					{metadataDescription && (
						<p className="mt-4 text-sm text-muted-foreground">{metadataDescription}</p>
					)}
				</CardContent>
			</Card>

			<EditOrganizationDialog
				organization={organization}
				open={editDialogOpen}
				onOpenChange={setEditDialogOpen}
			/>
		</>
	);
}
