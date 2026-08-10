"use client";

import { IconLoader2, IconTag } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { formatFactorAsMultiplier } from "@/lib/work-category/work-category.service";
import { writeLastWorkCategoryId } from "./selection-preferences";
import {
	useAvailableWorkCategories,
	type WorkCategory,
} from "./use-available-work-categories";

interface WorkCategorySelectorProps {
	/**
	 * Employee ID to fetch categories for
	 */
	employeeId: string;
	/**
	 * Currently selected category ID
	 */
	value: string | undefined;
	/**
	 * Callback when category selection changes
	 */
	onValueChange: (categoryId: string | undefined) => void;
	/**
	 * Whether the selector is disabled
	 */
	disabled?: boolean;
	/**
	 * Whether to show the label
	 */
	showLabel?: boolean;
}

interface WorkCategorySelectorViewProps extends WorkCategorySelectorProps {
	categories: WorkCategory[];
	isLoading: boolean;
	isError: boolean;
}

/**
 * Work category selector component for time tracking
 * Shows available work categories based on employee's assigned category set
 */
export function WorkCategorySelector({ ...props }: WorkCategorySelectorProps) {
	const query = useAvailableWorkCategories(props.employeeId);

	return <WorkCategorySelectorView {...props} {...query} />;
}

export function WorkCategorySelectorView({
	value,
	onValueChange,
	disabled = false,
	showLabel = true,
	categories,
	isLoading,
	isError,
}: WorkCategorySelectorViewProps) {
	const { t } = useTranslate();

	// Build a Map for O(1) category lookups
	const categoriesMap = new Map(categories.map((c) => [c.id, c]));

	// Save selected category to localStorage and update cache
	const handleValueChange = (newValue: string) => {
		if (newValue === "none") {
			writeLastWorkCategoryId(undefined);
			onValueChange(undefined);
		} else {
			writeLastWorkCategoryId(newValue);
			onValueChange(newValue);
		}
	};

	// Don't render if error
	if (isError) {
		return null;
	}

	// Show loading state
	if (isLoading) {
		return (
			<div className="grid gap-2">
				{showLabel && (
					<Label className="text-sm text-foreground">
						{t("timeTracking.workCategory", "Work Category")}
					</Label>
				)}
				<div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
					<IconLoader2 className="size-4 animate-spin" />
					{t("common.loading", "Loading…")}
				</div>
			</div>
		);
	}

	// Don't render if no categories available
	if (categories.length === 0) {
		return null;
	}

	return (
		<div className="grid gap-2">
			{showLabel && (
				<Label className="text-sm text-foreground">
					{t("timeTracking.workCategory", "Work Category")}
				</Label>
			)}
			<Select value={value ?? "none"} onValueChange={handleValueChange} disabled={disabled}>
				<SelectTrigger className="w-full">
					<SelectValue placeholder={t("timeTracking.selectCategory", "Select a category")}>
						{value ? (
							<CategoryOption
								category={categoriesMap.get(value)}
								unknownLabel={t("timeTracking.unknownCategory", "Unknown category")}
							/>
						) : (
							<span className="text-muted-foreground">
								{t("timeTracking.noCategory", "No category (100%)")}
							</span>
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="none">
						<div className="flex items-center gap-2">
							<div className="size-3 rounded-full border border-dashed border-muted-foreground" />
							<span>{t("timeTracking.noCategory", "No category (100%)")}</span>
						</div>
					</SelectItem>
					{categories.map((category) => (
						<SelectItem key={category.id} value={category.id}>
							<CategoryOption
								category={category}
								unknownLabel={t("timeTracking.unknownCategory", "Unknown category")}
							/>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function CategoryOption({
	category,
	unknownLabel,
}: {
	category: WorkCategory | undefined;
	unknownLabel: string;
}) {
	if (!category) {
		return <span>{unknownLabel}</span>;
	}

	const factor = parseFloat(category.factor);

	return (
		<div className="flex items-center gap-2">
			{category.color ? (
				<div className="size-3 rounded-full" style={{ backgroundColor: category.color }} />
			) : (
				<IconTag className="size-3 text-muted-foreground" />
			)}
			<span>{category.name}</span>
			<Badge variant="outline" className="ml-auto text-xs">
				{formatFactorAsMultiplier(factor)}
			</Badge>
		</div>
	);
}
