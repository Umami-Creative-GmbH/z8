"use client";

import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** The wording of one policy's withdraw confirmation, translated by its card. */
export interface WithdrawVersionCopy {
	trigger: string;
	title: string;
	description: string;
	confirm: string;
	failed: string;
	withdrawn: string;
}

/**
 * Withdraws one dated policy version after a confirmation. The policy card
 * supplies the withdraw action, the query to refresh and its own wording.
 */
export function WithdrawVersionButton({
	withdraw: withdrawVersion,
	queryKey,
	copy,
}: {
	withdraw: () => Promise<{ success: boolean }>;
	queryKey: QueryKey;
	copy: WithdrawVersionCopy;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	async function withdraw() {
		setBusy(true);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await withdrawAndRefresh().finally(() => setBusy(false));
	}
	async function withdrawAndRefresh() {
		const result = await withdrawVersion();
		if (!result.success) {
			toast.error(copy.failed);
			return;
		}
		toast.success(copy.withdrawn);
		await queryClient.invalidateQueries({ queryKey });
	}
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button type="button" variant="ghost" size="sm" disabled={busy}>
					{copy.trigger}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{copy.title}</AlertDialogTitle>
					<AlertDialogDescription>{copy.description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction onClick={() => void withdraw()}>{copy.confirm}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
