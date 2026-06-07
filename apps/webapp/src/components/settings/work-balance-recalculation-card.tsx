"use client";

import { IconRefresh, IconShieldCheck } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type Translate = (
	key: string,
	defaultValue: string,
	values?: Record<string, string | number>,
) => string;

type WorkBalanceRecalculationCardProps = {
	employeeName: string;
	isPending: boolean;
	onRecalculate: () => Promise<unknown>;
	t: Translate;
};

function focusConfirmButton(node: HTMLButtonElement | null) {
	node?.focus();
}

export function WorkBalanceRecalculationCard({
	employeeName,
	isPending,
	onRecalculate,
	t,
}: WorkBalanceRecalculationCardProps) {
	const [isConfirming, setIsConfirming] = useState(false);

	const handleConfirm = async () => {
		try {
			await onRecalculate();
		} catch {
			// Parent handlers own user-facing error toasts; this prevents unhandled event rejections.
		}

		setIsConfirming(false);
	};

	return (
		<Card>
			<CardHeader className="space-y-2">
				<div className="flex items-start gap-3">
					<div className="mt-0.5 rounded-md border bg-muted p-2 text-muted-foreground">
						<IconShieldCheck className="size-4" aria-hidden="true" />
					</div>
					<div className="min-w-0 space-y-1">
						<CardTitle>
							{t("settings.workBalanceRecalculation.title", "Work Balance Recalculation")}
						</CardTitle>
						<CardDescription className="break-words">
							{t(
								"settings.workBalanceRecalculation.description",
								"Queue a full rebuild of monthly and yearly work-balance aggregates for {employeeName}. This maintenance task runs in the background and does not block this page.",
								{ employeeName },
							)}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				{isPending ? (
					<Button disabled className="w-full sm:w-auto">
						<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						{t("settings.workBalanceRecalculation.queued", "Recalculation Queued")}
					</Button>
				) : isConfirming ? (
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground" aria-live="polite">
							{t(
								"settings.workBalanceRecalculation.confirmMessage",
								"Confirm before queueing this recalculation.",
							)}
						</p>
						<div className="flex flex-col gap-2 sm:flex-row">
							<Button variant="outline" onClick={() => setIsConfirming(false)}>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button ref={focusConfirmButton} onClick={handleConfirm}>
								<IconRefresh className="mr-2 size-4" aria-hidden="true" />
								{t("settings.workBalanceRecalculation.confirm", "Confirm Recalculation")}
							</Button>
						</div>
					</div>
				) : (
					<Button onClick={() => setIsConfirming(true)} className="w-full sm:w-auto">
						<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						{t("settings.workBalanceRecalculation.recalculate", "Recalculate Work Balance")}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
