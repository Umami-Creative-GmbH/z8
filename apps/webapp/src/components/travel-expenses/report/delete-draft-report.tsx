"use client";

import { IconLoader2, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { deleteDraftTravelExpenseReportAction } from "@/app/[locale]/(app)/travel-expenses/report-actions";
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
import { buttonVariants } from "@/components/ui/button-variants";
import { queryKeys } from "@/lib/query/keys";

const NOT_DELETABLE = "This expense report can no longer be deleted";

/**
 * Deletes a draft that was never submitted (#684), with its expenses and
 * receipts, after an explicit confirmation. A draft continued from an earlier
 * claim (#616) takes that claim with it. `compact` renders an icon button for
 * list rows; `label` then names the draft for assistive technology.
 */
export function DeleteDraftReportButton({
	reportId,
	continuesLegacyClaim,
	onDeleted,
	compact = false,
	label,
}: {
	reportId: string;
	continuesLegacyClaim: boolean;
	onDeleted?: () => void;
	compact?: boolean;
	label?: string;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState(false);
	const actionLabel = t("travelExpenses.report.delete.action", "Delete draft");

	async function remove() {
		setPending(true);
		// No `finally`: the React Compiler cannot compile try statements with one.
		try {
			const result = await deleteDraftTravelExpenseReportAction({ reportId });
			if (result.success) {
				toast.success(t("travelExpenses.report.delete.done", "Draft deleted."));
				await queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.history() });
				// Leave the deleted draft's page before forgetting it, so it is not loaded again.
				onDeleted?.();
				queryClient.removeQueries({ queryKey: queryKeys.travelExpenses.report(reportId) });
				queryClient.removeQueries({
					queryKey: queryKeys.travelExpenses.legacyConversion(reportId),
				});
			} else {
				toast.error(
					result.error === NOT_DELETABLE
						? t(
								"travelExpenses.report.delete.notDeletable",
								"This report was already submitted, so it can no longer be deleted.",
							)
						: t(
								"travelExpenses.report.delete.failed",
								"The draft could not be deleted. Please retry.",
							),
				);
				if (result.error === NOT_DELETABLE) {
					await queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.all });
				}
			}
		} catch {
			toast.error(
				t("travelExpenses.report.delete.failed", "The draft could not be deleted. Please retry."),
			);
		}
		setPending(false);
	}

	const icon = pending ? (
		<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
	) : (
		<IconTrash aria-hidden="true" className="size-4" />
	);
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				{compact ? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						disabled={pending}
						aria-label={label ?? actionLabel}
						title={actionLabel}
					>
						{icon}
					</Button>
				) : (
					<Button type="button" variant="outline" size="sm" disabled={pending}>
						<span className="mr-2">{icon}</span>
						{actionLabel}
					</Button>
				)}
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("travelExpenses.report.delete.title", "Delete this draft?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{continuesLegacyClaim
							? t(
									"travelExpenses.report.delete.descriptionLegacy",
									"The draft, its expenses and their receipts are deleted, together with the earlier claim draft it continues. This cannot be undone.",
								)
							: t(
									"travelExpenses.report.delete.description",
									"The draft, its expenses and their receipts are deleted. This cannot be undone.",
								)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction
						className={buttonVariants({ variant: "destructive" })}
						onClick={() => void remove()}
					>
						{actionLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
