"use client";

import { IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { startExportAction } from "@/app/[locale]/(app)/settings/export/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
	CATEGORY_LABELS,
	EXPORT_CATEGORIES,
	type ExportCategory,
} from "@/lib/export/data-fetchers";

interface ExportFormProps {
	organizationId: string;
}

export function ExportForm({ organizationId }: ExportFormProps) {
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
			toast.error("Please select at least one data category to export");
			return;
		}

		setIsSubmitting(true);
		try {
			const result = await startExportAction({
				organizationId,
				categories: Array.from(selectedCategories),
			});

			if (result.success) {
				toast.success(
					"Export request submitted! You will receive an email when it's ready for download.",
				);
				// Switch to history tab
				router.refresh();
			} else {
				toast.error(result.error || "Failed to start export");
			}
		} catch (error) {
			toast.error("An unexpected error occurred");
			console.error("Export error:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Create New Export</CardTitle>
				<CardDescription>
					Select the data categories you want to export. The export will be processed in the
					background and you'll receive an email with a download link when it's ready.
				</CardDescription>
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
							Select All
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
										{CATEGORY_LABELS[category]}
									</Label>
									<p className="text-xs text-muted-foreground">
										{getCategoryDescription(category)}
									</p>
								</div>
							</div>
						))}
					</div>

					{/* Info Box */}
					<div className="rounded-lg border bg-muted/50 p-4 text-sm">
						<h4 className="font-medium">About Data Exports</h4>
						<ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
							<li>Exports are processed asynchronously and may take a few minutes</li>
							<li>You will receive an email with a download link when ready</li>
							<li>Download links are valid for 24 hours</li>
							<li>Export files are stored for 30 days</li>
							<li>Only data from your organization is included</li>
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
								Starting Export...
							</>
						) : (
							<>
								<IconDownload className="mr-2 size-4" />
								Start Export ({selectedCategories.size}{" "}
								{selectedCategories.size === 1 ? "category" : "categories"})
							</>
						)}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function getCategoryDescription(category: ExportCategory): string {
	const descriptions: Record<ExportCategory, string> = {
		employees: "Names, positions, roles, and team assignments",
		teams: "Team structure and permissions",
		time_entries: "Clock in/out records (CSV format)",
		work_periods: "Aggregated work sessions (CSV format)",
		absences: "Leave records and approvals (CSV format)",
		holidays: "Holiday calendar and recurrence rules",
		vacation: "Vacation policies and balances",
		schedules: "Work schedule templates and assignments",
		shifts: "Shift scheduling data (CSV format)",
		audit_logs: "Activity history (CSV format)",
	};
	return descriptions[category];
}
