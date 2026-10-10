"use client";

import { IconHistory, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	isRefusal,
	useBalanceAdjustmentSection,
} from "@/components/settings/work-balance/use-employee-work-balance";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { BalanceAdjustmentHistory } from "./balance-adjustment-history";

/**
 * Opens the history of an employee's balance adjustments from a work balance
 * card (#996): the employee's own, or one they manage. Loads it only when
 * opened; the server decides who may see it.
 */
export function BalanceAdjustmentHistoryButton({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button type="button" variant="link" size="sm" className="h-auto self-start px-0">
					<IconHistory className="size-4" aria-hidden="true" />
					{t("workBalance.adjustments.open", "Balance adjustments")}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{t("workBalance.adjustments.title", "Balance adjustments")}</DialogTitle>
					<DialogDescription>
						{t(
							"workBalance.adjustments.description",
							"Overtime payouts and opening balances on this work balance. A mistaken one is cancelled, never deleted, so cancelled ones stay listed.",
						)}
					</DialogDescription>
				</DialogHeader>
				{open ? <HistoryBody employeeId={employeeId} /> : null}
			</DialogContent>
		</Dialog>
	);
}

function HistoryBody({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const section = useBalanceAdjustmentSection(employeeId);

	if (section.isLoading) {
		return (
			<output
				className="flex items-center justify-center p-6"
				aria-label={t("workBalance.adjustments.loading", "Loading balance adjustments")}
			>
				<IconLoader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
			</output>
		);
	}
	if (section.isError || !section.data) {
		return (
			<p role="alert" className="text-destructive text-sm">
				{isRefusal(section.error) && section.error.code === "not_permitted"
					? t(
							"workBalance.adjustments.notPermitted",
							"You can see the balance adjustments of yourself and of employees you manage.",
						)
					: t("workBalance.adjustments.loadFailed", "The balance adjustments could not be loaded.")}
			</p>
		);
	}
	return <BalanceAdjustmentHistory adjustments={section.data.adjustments} />;
}
