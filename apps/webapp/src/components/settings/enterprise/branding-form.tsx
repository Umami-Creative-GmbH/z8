"use client";

import { IconUpload, IconX } from "@tabler/icons-react";
import Image from "next/image";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { updateBrandingAction } from "@/app/[locale]/(app)/settings/enterprise/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useImageUpload } from "@/hooks/use-image-upload";
import type { OrganizationBranding } from "@/lib/domain";

interface BrandingFormProps {
	initialBranding: OrganizationBranding;
	organizationId: string;
}

export function BrandingForm({ initialBranding, organizationId }: BrandingFormProps) {
	const [branding, setBranding] = useState<OrganizationBranding>(initialBranding);
	const [isSaving, setIsSaving] = useState(false);

	// Logo upload
	const logoUpload = useImageUpload({
		uploadType: "branding-logo",
		organizationId,
		maxFileSize: 2 * 1024 * 1024, // 2MB
		onSuccess: (url) => {
			setBranding((prev) => ({ ...prev, logoUrl: url }));
			toast.success("Logo uploaded successfully");
		},
		onError: (error) => {
			toast.error(error.message || "Failed to upload logo");
		},
	});

	// Background upload
	const backgroundUpload = useImageUpload({
		uploadType: "branding-background",
		organizationId,
		maxFileSize: 5 * 1024 * 1024, // 5MB
		onSuccess: (url) => {
			setBranding((prev) => ({ ...prev, backgroundImageUrl: url }));
			toast.success("Background image uploaded successfully");
		},
		onError: (error) => {
			toast.error(error.message || "Failed to upload background image");
		},
	});

	const handleLogoChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) {
				logoUpload.addFile(file);
			}
		},
		[logoUpload],
	);

	const handleBackgroundChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) {
				backgroundUpload.addFile(file);
			}
		},
		[backgroundUpload],
	);

	const handleSave = async () => {
		setIsSaving(true);
		try {
			await updateBrandingAction(branding);
			toast.success("Branding settings saved");
		} catch (_error) {
			toast.error("Failed to save branding settings");
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="space-y-6">
			{/* Logo */}
			<Card>
				<CardHeader>
					<CardTitle>Logo</CardTitle>
					<CardDescription>
						Upload your organization logo to display on the login page.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-6">
						<div className="relative h-20 w-20 rounded-lg border bg-muted flex items-center justify-center overflow-hidden">
							{logoUpload.previewUrl || branding.logoUrl ? (
								<Image
									src={logoUpload.previewUrl || branding.logoUrl || ""}
									alt="Logo preview"
									fill
									className="object-contain"
								/>
							) : (
								<IconUpload className="h-8 w-8 text-muted-foreground" />
							)}
						</div>
						<div className="flex-1">
							<Input
								type="file"
								accept="image/*"
								onChange={handleLogoChange}
								disabled={logoUpload.isUploading}
								className="max-w-xs"
							/>
							<p className="text-sm text-muted-foreground mt-2">
								Recommended: 200x200px, PNG or SVG with transparent background
							</p>
							{logoUpload.isUploading && (
								<p className="text-sm text-muted-foreground">Uploading... {logoUpload.progress}%</p>
							)}
						</div>
						{branding.logoUrl && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setBranding((prev) => ({ ...prev, logoUrl: null }))}
							>
								<IconX className="h-4 w-4" />
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Background Image */}
			<Card>
				<CardHeader>
					<CardTitle>Background Image</CardTitle>
					<CardDescription>Upload a custom background image for the login page.</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-start gap-6">
						<div className="relative h-32 w-48 rounded-lg border bg-muted flex items-center justify-center overflow-hidden">
							{backgroundUpload.previewUrl || branding.backgroundImageUrl ? (
								<Image
									src={backgroundUpload.previewUrl || branding.backgroundImageUrl || ""}
									alt="Background preview"
									fill
									className="object-cover"
								/>
							) : (
								<IconUpload className="h-8 w-8 text-muted-foreground" />
							)}
						</div>
						<div className="flex-1">
							<Input
								type="file"
								accept="image/*"
								onChange={handleBackgroundChange}
								disabled={backgroundUpload.isUploading}
								className="max-w-xs"
							/>
							<p className="text-sm text-muted-foreground mt-2">
								Recommended: 1920x1080px or larger, high quality JPEG or PNG
							</p>
							{backgroundUpload.isUploading && (
								<p className="text-sm text-muted-foreground">
									Uploading... {backgroundUpload.progress}%
								</p>
							)}
						</div>
						{branding.backgroundImageUrl && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setBranding((prev) => ({ ...prev, backgroundImageUrl: null }))}
							>
								<IconX className="h-4 w-4" />
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* App Name */}
			<Card>
				<CardHeader>
					<CardTitle>App Name</CardTitle>
					<CardDescription>Override the default app name shown on the login page.</CardDescription>
				</CardHeader>
				<CardContent>
					<Input
						placeholder="z8"
						value={branding.appName || ""}
						onChange={(e) =>
							setBranding((prev) => ({
								...prev,
								appName: e.target.value || null,
							}))
						}
						className="max-w-xs"
					/>
				</CardContent>
			</Card>

			{/* Theme Colors */}
			<Card>
				<CardHeader>
					<CardTitle>Theme Colors</CardTitle>
					<CardDescription>
						Customize the primary and accent colors for your login page.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center gap-4">
						<div className="flex-1">
							<Label htmlFor="primaryColor">Primary Color</Label>
							<p className="text-sm text-muted-foreground mb-2">
								Used for buttons, links, and focus states
							</p>
							<div className="flex items-center gap-3">
								<Input
									id="primaryColor"
									type="color"
									value={branding.primaryColor || "#3b82f6"}
									onChange={(e) =>
										setBranding((prev) => ({
											...prev,
											primaryColor: e.target.value,
										}))
									}
									className="w-16 h-10 p-1 cursor-pointer"
								/>
								<Input
									value={branding.primaryColor || ""}
									placeholder="#3b82f6"
									onChange={(e) =>
										setBranding((prev) => ({
											...prev,
											primaryColor: e.target.value || null,
										}))
									}
									className="max-w-32"
								/>
								{branding.primaryColor && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setBranding((prev) => ({ ...prev, primaryColor: null }))}
									>
										Reset
									</Button>
								)}
							</div>
						</div>
						<div className="flex-1">
							<Label htmlFor="accentColor">Accent Color (Optional)</Label>
							<p className="text-sm text-muted-foreground mb-2">Secondary color for highlights</p>
							<div className="flex items-center gap-3">
								<Input
									id="accentColor"
									type="color"
									value={branding.accentColor || "#10b981"}
									onChange={(e) =>
										setBranding((prev) => ({
											...prev,
											accentColor: e.target.value,
										}))
									}
									className="w-16 h-10 p-1 cursor-pointer"
								/>
								<Input
									value={branding.accentColor || ""}
									placeholder="#10b981"
									onChange={(e) =>
										setBranding((prev) => ({
											...prev,
											accentColor: e.target.value || null,
										}))
									}
									className="max-w-32"
								/>
								{branding.accentColor && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setBranding((prev) => ({ ...prev, accentColor: null }))}
									>
										Reset
									</Button>
								)}
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Save Button */}
			<div className="flex justify-end">
				<Button onClick={handleSave} disabled={isSaving} size="lg">
					{isSaving ? "Saving..." : "Save Branding Settings"}
				</Button>
			</div>
		</div>
	);
}
