"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { cn } from "@/lib/utils";

/**
 * Whether a row the server sent belongs to a former employee: marked by the
 * current-roster rule, or at least deactivated when the source predates the mark.
 */
export function isMarkedFormer(row: { isFormer?: boolean | null; isActive?: boolean | null }) {
	return row.isFormer === true || row.isActive === false;
}

/**
 * The label views put on a former employee (Organization glossary, #1438).
 * `since` is the organization-local date they left (`YYYY-MM-DD`, #1439):
 * "Former since 12 Oct 2026". `null` means the date isn't recorded; leave it
 * out where the source doesn't say, and the label is just "Former".
 */
export function FormerEmployeeBadge({
	since,
	className,
}: {
	since?: string | null;
	className?: string;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() || "en";
	const label =
		since === undefined
			? t("common:formerEmployees.former", "Former")
			: since === null
				? t("common:formerEmployees.formerDateNotRecorded", "Former · date not recorded")
				: t("common:formerEmployees.formerSince", "Former since {date}", {
						date: formatPlainDate(parsePlainDate(since), locale, "dateMedium"),
					});
	return (
		<Badge variant="secondary" className={cn("shrink-0 text-xs", className)}>
			{label}
		</Badge>
	);
}

/**
 * The toggle of a list that hides former employees by default (#1438). Rows it
 * reveals carry `FormerEmployeeBadge`.
 */
export function ShowFormerEmployeesSwitch({
	checked,
	onCheckedChange,
	disabled,
	className,
}: {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	className?: string;
}) {
	const { t } = useTranslate();
	const id = useId();
	return (
		<div className={cn("flex items-center gap-2", className)}>
			<Switch
				id={id}
				checked={checked}
				disabled={disabled}
				onCheckedChange={(next) => onCheckedChange(next)}
			/>
			<Label htmlFor={id} className="cursor-pointer text-sm font-normal">
				{t("common:formerEmployees.showFormer", "Show former employees")}
			</Label>
		</div>
	);
}
