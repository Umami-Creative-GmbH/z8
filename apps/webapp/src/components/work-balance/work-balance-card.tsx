"use client";

import { useTranslate } from "@tolgee/react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatSignedWorkBalance, getWorkBalanceStatus } from "@/lib/work-balance/format";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";

interface WorkBalanceCardProps {
	balance: EmployeeWorkBalancePayload | null;
	compact?: boolean;
}

export function WorkBalanceCard({ balance, compact = false }: WorkBalanceCardProps) {
	const { t } = useTranslate();
	const status = balance ? getWorkBalanceStatus(balance.balanceMinutes) : "neutral";

	return (
		<Card className={compact ? "min-w-52" : undefined}>
			<CardHeader className={compact ? "p-3" : undefined}>
				<CardDescription>{t("workBalance.label", "All-time balance")}</CardDescription>
				<CardTitle
					className={cn(
						"tabular-nums text-2xl",
						status === "positive" && "text-emerald-600 dark:text-emerald-400",
						status === "negative" && "text-destructive",
					)}
				>
					{balance
						? formatSignedWorkBalance(balance.balanceMinutes)
						: t("workBalance.notCalculated", "Not calculated yet")}
				</CardTitle>
				<p className="text-muted-foreground text-xs">
					{balance?.computedAt
						? t("workBalance.updatedEveryThreeHours", "Updated every 3 hours")
						: t("workBalance.pendingDescription", "The worker will calculate this balance soon.")}
				</p>
			</CardHeader>
		</Card>
	);
}
