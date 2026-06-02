"use client";

import { useTranslate } from "@tolgee/react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatSignedWorkBalance, getWorkBalanceStatus } from "@/lib/work-balance/format";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";

interface WorkBalanceCardProps {
	balance: EmployeeWorkBalancePayload | null;
	compact?: boolean;
	mobileCompact?: boolean;
}

export function WorkBalanceCard({
	balance,
	compact = false,
	mobileCompact = false,
}: WorkBalanceCardProps) {
	const { t } = useTranslate();
	const status = balance ? getWorkBalanceStatus(balance.balanceMinutes) : "neutral";

	return (
		<Card
			className={cn(compact && "min-w-52 gap-0 overflow-hidden py-0", mobileCompact && "min-w-0")}
		>
			<CardHeader
				className={cn(
					compact && "bg-muted/45 px-4 py-3 dark:bg-muted/25",
					mobileCompact && "flex-row items-center justify-between gap-3 px-3 py-2",
				)}
			>
				<CardDescription>{t("workBalance.label", "All-time balance")}</CardDescription>
				<CardTitle
					className={cn(
						"tabular-nums text-2xl",
						compact && "text-xl",
						mobileCompact && "text-lg",
						status === "positive" && "text-emerald-600 dark:text-emerald-400",
						status === "negative" && "text-destructive",
					)}
				>
					{balance
						? formatSignedWorkBalance(balance.balanceMinutes)
						: t("workBalance.notCalculated", "Not calculated yet")}
				</CardTitle>
				<p className={cn("text-muted-foreground text-xs", mobileCompact && "hidden")}>
					{balance?.computedAt
						? t("workBalance.updatedEveryThreeHours", "Updated every 3 hours")
						: t("workBalance.pendingDescription", "The worker will calculate this balance soon.")}
				</p>
			</CardHeader>
		</Card>
	);
}
