"use client";

import { IconHistory, IconLoader2, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	dismissWageHistoryMergeNoteAction,
	getWageHistoryMergeNoteAction,
} from "@/app/[locale]/(app)/settings/employees/wage-history-merge-note-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { queryKeys } from "@/lib/query/keys";

/**
 * The one-time note that the employee's wage history was merged from the old rate history
 * (#1176). Render it for org admins only; the server refuses everyone else. Dismissing it hides
 * it for every org admin, for good.
 */
export function WageHistoryMergeNote({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const queryClient = useQueryClient();
	const queryKey = queryKeys.employees.wageHistoryMergeNote(employeeId);
	const { data: note } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getWageHistoryMergeNoteAction(employeeId);
			return result.success ? result.data : null;
		},
		staleTime: 5 * 60 * 1000,
	});
	const dismiss = useMutation({
		mutationFn: () => dismissWageHistoryMergeNoteAction(employeeId),
		onSuccess: (result) => {
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			queryClient.setQueryData(queryKey, null);
		},
		onError: () => {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
		},
	});

	if (!note) return null;

	return (
		<Alert>
			<IconHistory aria-hidden="true" className="size-4" />
			<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
				<span>
					{t(
						"settings.employmentHistory.wageHistoryMergeNote",
						"Wage history was merged from the old rate history on {date}; {count, plural, one {# rate change was adjusted} other {# rate changes were adjusted}}.",
						{
							date: formatPlainDate(parsePlainDate(note.mergedOn), locale, "dateMedium"),
							count: note.adjustedCount,
						},
					)}
				</span>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => dismiss.mutate()}
					disabled={dismiss.isPending}
				>
					{dismiss.isPending ? (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					) : (
						<IconX aria-hidden="true" className="size-4" />
					)}
					{t("settings.employmentHistory.wageHistoryMergeNoteDismiss", "Dismiss")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}
