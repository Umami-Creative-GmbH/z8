"use client";

import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { startExportAction } from "@/app/[locale]/(app)/settings/export/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { EXPORT_CATEGORIES, type ExportCategory } from "@/lib/export/data-fetchers";

interface ExportFormProps {
	organizationId: string;
}

export function ExportForm({ organizationId }: ExportFormProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [selectedCategories, setSelectedCategories] = useState<Set<ExportCategory>>(new Set());
	const [isSubmitting, setIsSubmitting] = useState(false);

	const allSelected = selectedCategories.size === EXPORT_CATEGORIES.length;
	const someSelected = selectedCategories.size > 0 && !allSelected;

	const handleSelectAll = () => {
		if (allSelected) {
			setSelectedCategories(new Set());
		} else {
			setSelectedCategories(new Set(EXPORT_CATEGORIES));
		}
	};

	const handleCategoryToggle = (category: ExportCategory) => {
		const newSelected = new Set(selectedCategories);
		if (newSelected.has(category)) {
			newSelected.delete(category);
		} else {
			newSelected.add(category);
		}
		setSelectedCategories(newSelected);
	};

	const handleSubmit = async () => {
		if (selectedCategories.size === 0) {
			toast.error(t("settings.dataExport.form.selectAtLeastOne", "Please select at least one category"));
			return;
		}

		setIsSubmitting(true);
		try {
			const result = await startExportAction({
				organizationId,
				categories: Array.from(selectedCategories),
			});

			if (result.success) {
				toast.success(t("settings.dataExport.form.submitSuccess", "Export started successfully"));
				// Switch to history tab
				router.refresh();
			} else {
				toast.error(result.error || t("settings.dataExport.form.submitError", "Failed to start export"));
			}
		} catch (error) {
			toast.error(t("settings.dataExport.form.unexpectedError", "An unexpected error occurred"));
			console.error("Export error:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.dataExport.form.title", "Export Data")}</CardTitle>
				<CardDescription>{t("settings.dataExport.form.description", "Select the data categories you want to export")}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-6">
					{/* Select All */}
					<div className="flex items-center space-x-2 border-b pb-4">
						<Checkbox
							id="select-all"
							checked={allSelected}
							onCheckedChange={handleSelectAll}
							className={someSelected ? "data-[state=checked]:bg-muted" : ""}
						/>
						<Label
							htmlFor="select-all"
							className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
						>
							{t("settings.dataExport.form.selectAll", "Select All")}
						</Label>
					</div>

					{/* Category Checkboxes */}
					<div className="grid gap-4 sm:grid-cols-2">
						{EXPORT_CATEGORIES.map((category) => (
							<div key={category} className="flex items-start space-x-3">
								<Checkbox
									id={category}
									checked={selectedCategories.has(category)}
									onCheckedChange={() => handleCategoryToggle(category)}
								/>
								<div className="grid gap-1.5 leading-none">
									<Label
										htmlFor={category}
										className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
									>
										{t(`settings.dataExport.categories.${category}.label`, category)}
									</Label>
									<p className="text-xs text-muted-foreground">
										{t(`settings.dataExport.categories.${category}.description`, `Export ${category} data`)}
									</p>
								</div>
							</div>
						))}
					</div>

					{/* Info Box */}
					<div className="rounded-lg border bg-muted/50 p-4 text-sm">
						<h4 className="font-medium">{t("settings.dataExport.form.aboutTitle", "About Data Export")}</h4>
						<ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
							<li>{t("settings.dataExport.form.aboutAsync", "Exports are processed asynchronously")}</li>
							<li>{t("settings.dataExport.form.aboutEmail", "You'll receive an email when ready")}</li>
							<li>{t("settings.dataExport.form.aboutLinkValidity", "Download links are valid for 24 hours")}</li>
							<li>{t("settings.dataExport.form.aboutStorageDuration", "Export files are stored for 7 days")}</li>
							<li>{t("settings.dataExport.form.aboutOrgDataOnly", "Only your organization's data is included")}</li>
						</ul>
					</div>

					{/* Submit Button */}
					<Button
						onClick={handleSubmit}
						disabled={isSubmitting || selectedCategories.size === 0}
						className="w-full sm:w-auto"
					>
						{isSubmitting ? (
							<>
								<IconLoader2 className="mr-2 size-4 animate-spin" />
								{t("settings.dataExport.form.startingExport", "Starting Export...")}
							</>
						) : (
							<>
								<IconDownload className="mr-2 size-4" />
								{t("settings.dataExport.form.startExport", `Start Export (${selectedCategories.size})`, {
									count: selectedCategories.size,
								})}
							</>
						)}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
