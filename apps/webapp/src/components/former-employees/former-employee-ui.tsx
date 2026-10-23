"use client";

import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * The label views put on a former employee (Organization glossary, #1438).
 * Just "Former" until the moment they left is recorded (#1439).
 */
export function FormerEmployeeBadge({ className }: { className?: string }) {
	const { t } = useTranslate();
	return (
		<Badge variant="secondary" className={cn("shrink-0 text-xs", className)}>
			{t("common:formerEmployees.former", "Former")}
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
	className,
}: {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	className?: string;
}) {
	const { t } = useTranslate();
	const id = useId();
	return (
		<div className={cn("flex items-center gap-2", className)}>
			<Switch id={id} checked={checked} onCheckedChange={(next) => onCheckedChange(next)} />
			<Label htmlFor={id} className="text-sm font-normal">
				{t("common:formerEmployees.showFormer", "Show former employees")}
			</Label>
		</div>
	);
}
