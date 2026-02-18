"use client";

import { IconLoader2, IconTag } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAvailableCategoriesForEmployee } from "@/app/[locale]/(app)/settings/work-categories/actions";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query";
import { formatFactorAsMultiplier } from "@/lib/work-category/work-category.service";

const LAST_CATEGORY_KEY = "z8-last-work-category-id";

interface WorkCategory {
	id: string;
	name: string;
	factor: string;
	color: string | null;
}

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
	/**
	 * Whether to auto-select the last used category
	 */
	autoSelectLast?: boolean;
}

/**
 * Work category selector component for time tracking
 * Shows available work categories based on employee's assigned category set
 */
export function WorkCategorySelector({
	employeeId,
	value,
	onValueChange,
	disabled = false,
	showLabel = true,
	autoSelectLast = true,
}: WorkCategorySelectorProps) {
	const { t } = useTranslate();
	const hasAutoSelectedRef = useRef(false);
	const [lastCategoryId, setLastCategoryId] = useState<string | null>(() => {
		if (typeof window === "undefined") {
			return null;
		}
		return localStorage.getItem(LAST_CATEGORY_KEY);
	});

	// Fetch available categories for this employee
	const {
		data: categoriesResult,
		isLoading,
		isError,
	} = useQuery({
		queryKey: queryKeys.workCategories.available(employeeId),
		queryFn: async () => {
			const result = await getAvailableCategoriesForEmployee(employeeId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch categories");
			}
			return result.data as WorkCategory[];
		},
		enabled: !!employeeId,
	});

	const categories = categoriesResult || [];

	// Build a Map for O(1) category lookups
	const categoriesMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

	// Auto-select last used category on initial load
	useEffect(() => {
		if (autoSelectLast && !hasAutoSelectedRef.current && categories.length > 0 && value === undefined) {
			if (lastCategoryId && categoriesMap.has(lastCategoryId)) {
				onValueChange(lastCategoryId);
			}
			hasAutoSelectedRef.current = true;
		}
	}, [
		autoSelectLast,
		categories.length,
		categoriesMap,
		value,
		onValueChange,
		lastCategoryId,
	]);

	// Save selected category to localStorage and update cache
	const handleValueChange = (newValue: string) => {
		if (newValue === "none") {
			localStorage.removeItem(LAST_CATEGORY_KEY);
			setLastCategoryId(null);
			onValueChange(undefined);
		} else {
			localStorage.setItem(LAST_CATEGORY_KEY, newValue);
			setLastCategoryId(newValue);
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
					<Label className="text-sm text-muted-foreground">
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
				<Label className="text-sm text-muted-foreground">
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
