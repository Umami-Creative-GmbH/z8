"use client";

import { IconBuilding, IconCamera, IconEdit, IconLoader2, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type * as authSchema from "@/db/auth-schema";
import { useImageUpload } from "@/hooks/use-image-upload";
import { EditOrganizationDialog } from "./edit-organization-dialog";

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
	const inputRef = useRef<HTMLInputElement>(null);

	const canEdit = currentMemberRole === "owner";
	const metadataDescription =
		typeof organization.metadata === "object" &&
		organization.metadata !== null &&
		"description" in organization.metadata &&
		typeof organization.metadata.description === "string"
			? organization.metadata.description
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
	const handleFileInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files;
			if (files && files.length > 0) {
				addFile(files[0]);
				e.target.value = "";
			}
		},
		[addFile],
	);

	return (
		<>
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between">
						<div className="flex items-start gap-4">
							{/* Hidden file input */}
							<input
								ref={inputRef}
								type="file"
								accept="image/*"
								className="hidden"
								aria-label="Upload organization logo"
								onChange={handleFileInputChange}
							/>
							<div className="relative h-16 w-16">
								<Avatar className="h-16 w-16">
									<AvatarImage src={previewUrl || logoUrl || undefined} alt={organization.name} />
									<AvatarFallback className="bg-primary/10">
										<IconBuilding className="h-8 w-8 text-primary" />
									</AvatarFallback>
								</Avatar>
								{/* Upload progress overlay */}
								{isUploading && (
									<div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-full bg-black/70">
										<IconLoader2 className="h-5 w-5 animate-spin text-white" />
										<span className="mt-0.5 text-[10px] font-medium text-white">
											{uploadProgress}%
										</span>
									</div>
								)}
								{canEdit && !isUploading && (
									<button
										type="button"
										onClick={() => inputRef.current?.click()}
										className="absolute bottom-0 right-0 rounded-full bg-primary p-1.5 text-primary-foreground shadow-lg transition-transform hover:scale-110"
									>
										<IconCamera className="h-3 w-3" />
									</button>
								)}
							</div>
							<div>
								<CardTitle className="text-2xl">{organization.name}</CardTitle>
								<CardDescription className="mt-1">
									{organization.slug && (
										<span className="text-xs font-mono bg-muted px-2 py-1 rounded">
											{organization.slug}
										</span>
									)}
								</CardDescription>
							</div>
						</div>
						{canEdit && (
							<Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
								<IconEdit className="h-4 w-4 mr-2" />
								Edit
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconUsers className="h-4 w-4" />
						<span>
							{memberCount} {memberCount === 1 ? "member" : "members"}
						</span>
					</div>
					{metadataDescription && (
						<p className="mt-4 text-sm text-muted-foreground">
							{metadataDescription}
						</p>
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
