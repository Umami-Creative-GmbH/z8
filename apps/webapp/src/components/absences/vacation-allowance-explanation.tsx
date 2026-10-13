"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { ProratedAllowance } from "@/lib/absences/prorated-allowance";
import {
	explainOverdrawnVacation,
	explainVacationAllowance,
} from "@/lib/absences/prorated-allowance-explanation";
import { cn } from "@/lib/utils";

/**
 * Why a vacation allowance is prorated (#1111): "8 of 30 days, prorated: started 1 Oct 2026, 3 full
 * employment months". Renders nothing for a full allowance. Its keys are in `common`.
 */
export function VacationAllowanceExplanation({
	allowance,
	year,
	className,
}: {
	allowance: ProratedAllowance | undefined;
	year: number;
	className?: string;
}) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	if (!allowance) return null;
	const text = explainVacationAllowance({
		allowance,
		year,
		locale: tolgee.getLanguage() || "en",
		t,
	});
	if (!text) return null;
	return <p className={cn("text-sm text-muted-foreground", className)}>{text}</p>;
}

/**
 * Overdrawn vacation (#1111), for admins and managers only: "2 days overdrawn". Information only;
 * nothing is deducted. Renders nothing when no vacation is overdrawn.
 */
export function OverdrawnVacationBadge({
	overdrawnDays,
	className,
}: {
	overdrawnDays: number;
	className?: string;
}) {
	const { t } = useTranslate();
	const text = explainOverdrawnVacation({ overdrawnDays, t });
	if (!text) return null;
	return (
		<Badge
			variant="outline"
			className={cn("gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400", className)}
			title={t(
				"common.vacationAllowance.overdrawnHint",
				"Vacation taken beyond the allowance. Shown for information only: nothing is deducted.",
			)}
		>
			<IconAlertTriangle className="size-3" aria-hidden="true" />
			{text}
		</Badge>
	);
}
