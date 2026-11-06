"use client";

import { IconCamera, IconEdit, IconLoader2, IconTrash, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { removeOrganizationLogo } from "@/app/[locale]/(app)/settings/organization/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type * as authSchema from "@/db/auth-schema";
import { useImageUpload } from "@/hooks/use-image-upload";
import { useRouter } from "@/navigation";
import { EditOrganizationDialog } from "./edit-organization-dialog";
import { OrganizationLogo } from "./organization-logo";

interface OrganizationDetailsCardProps {
	organization: typeof authSchema.organization.$inferSelect;
	memberCount: number;
	currentMemberRole: "owner" | "admin" | "member";
}

function getOrganizationDescription(metadata: unknown): string | null {
	if (typeof metadata !== "object" || metadata === null || !("description" in metadata)) {
		return null;
	}
	return typeof metadata.description === "string" ? metadata.description : null;
}

export function OrganizationDetailsCard({
	organization,
	memberCount,
	currentMemberRole,
}: OrganizationDetailsCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [logoOverride, setLogoOverride] = useState<{
		organizationId: string;
		serverLogo: string | null;
		value: string | null;
	} | null>(null);
	const [isRemovingLogo, setIsRemovingLogo] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const logoUrl =
		logoOverride?.organizationId === organization.id &&
		logoOverride.serverLogo === organization.logo
			? logoOverride.value
			: organization.logo;

	const canEdit = currentMemberRole === "owner";
	const metadataDescription = getOrganizationDescription(organization.metadata);

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
			setLogoOverride({
				organizationId: organization.id,
				serverLogo: organization.logo,
				value: url,
			});
			router.refresh();
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

		setLogoOverride({
			organizationId: organization.id,
			serverLogo: organization.logo,
			value: null,
		});
		router.refresh();
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
								{canEdit && (
									<div className="mt-2 flex flex-wrap items-center gap-1 -ml-2">
										<Button
											variant="ghost"
											size="sm"
											className="h-7 px-2 text-xs text-muted-foreground"
											onClick={() => inputRef.current?.click()}
											disabled={isUploading}
										>
											<IconCamera className="size-3.5" aria-hidden="true" />
											{logoUrl
												? t("organization.logo.changeLabel", "Change organization logo")
												: t("organization.logo.uploadLabel", "Upload organization logo")}
										</Button>
										{logoUrl && (
											<Button
												variant="ghost"
												size="sm"
												className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
												onClick={handleRemoveLogo}
												disabled={isRemovingLogo || isUploading}
											>
												{isRemovingLogo ? (
													<IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" />
												) : (
													<IconTrash className="size-3.5" aria-hidden="true" />
												)}
												{t("organization.logo.removeLabel", "Remove organization logo")}
											</Button>
										)}
									</div>
								)}
							</div>
						</div>
						{canEdit && (
							<Button
								variant="outline"
								size="sm"
								className="shrink-0 px-2 sm:px-3"
								onClick={() => setEditDialogOpen(true)}
							>
								<IconEdit className="size-4" aria-hidden="true" />
								{t("common.edit", "Edit")}
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
