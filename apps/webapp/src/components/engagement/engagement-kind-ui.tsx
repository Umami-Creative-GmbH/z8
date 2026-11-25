"use client";

import { IconBriefcase } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { EngagementFilter } from "@/lib/engagement/engagement-filter";
import { isEngagementFilter } from "@/lib/engagement/engagement-filter";
import type { EngagementKind } from "@/lib/engagement/engagement-kind";
import { cn } from "@/lib/utils";

/**
 * The label views put on an External Contractor (#1995). Renders nothing for an
 * employee, so a list can place it next to every name.
 */
export function ExternalContractorBadge({
	engagementKind,
	className,
}: {
	engagementKind: EngagementKind | null | undefined;
	className?: string;
}) {
	const { t } = useTranslate();
	if (engagementKind !== "contractor") return null;
	return (
		<Badge variant="outline" className={cn("shrink-0 gap-1 text-xs", className)}>
			<IconBriefcase aria-hidden="true" className="size-3" />
			{t("common:engagement.externalContractor", "External Contractor")}
		</Badge>
	);
}

/** `All | Employees | External Contractors`, the roster filter by engagement kind (#1995). */
export function EngagementFilterToggle({
	value,
	onValueChange,
	disabled,
	className,
}: {
	value: EngagementFilter;
	onValueChange: (value: EngagementFilter) => void;
	disabled?: boolean;
	className?: string;
}) {
	const { t } = useTranslate();
	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			value={value}
			disabled={disabled}
			aria-label={t("common:engagement.filter.label", "Engagement")}
			className={className}
			onValueChange={(next) => {
				// The group sends "" when the pressed item is clicked again; keep the selection.
				if (isEngagementFilter(next)) onValueChange(next);
			}}
		>
			<ToggleGroupItem value="all">{t("common:engagement.filter.all", "All")}</ToggleGroupItem>
			<ToggleGroupItem value="employee">
				{t("common:engagement.filter.employees", "Employees")}
			</ToggleGroupItem>
			<ToggleGroupItem value="contractor">
				{t("common:engagement.filter.contractors", "External Contractors")}
			</ToggleGroupItem>
		</ToggleGroup>
	);
}
