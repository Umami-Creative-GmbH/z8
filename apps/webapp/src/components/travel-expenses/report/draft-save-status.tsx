"use client";

import {
	IconAlertTriangle,
	IconCircleCheck,
	IconLoader2,
	IconPencil,
	IconRefresh,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { DraftSaverState } from "@/lib/travel-expenses/draft-saver";

/** Visible autosave state: saving, saved, failed, invalid or a version conflict. */
export function DraftSaveStatus<Item>({
	state,
	onRetry,
	onUseTheirs,
	onKeepMine,
}: {
	state: DraftSaverState<Item>;
	onRetry: () => void;
	onUseTheirs: () => void;
	onKeepMine: () => void;
}) {
	const { t } = useTranslate();

	if (state.status === "conflict") {
		return (
			<Alert variant="destructive">
				<IconAlertTriangle aria-hidden="true" className="size-4" />
				<AlertTitle>
					{t("travelExpenses.report.save.conflictTitle", "This expense changed elsewhere")}
				</AlertTitle>
				<AlertDescription className="space-y-3">
					<p>
						{t(
							"travelExpenses.report.save.conflictDescription",
							"It was saved in another window or on another device after you opened it. Your latest edits are not saved yet.",
						)}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button type="button" size="sm" variant="outline" onClick={onUseTheirs}>
							{t("travelExpenses.report.save.useTheirs", "Load the saved version")}
						</Button>
						<Button type="button" size="sm" onClick={onKeepMine}>
							{t("travelExpenses.report.save.keepMine", "Save my edits instead")}
						</Button>
					</div>
				</AlertDescription>
			</Alert>
		);
	}

	if (state.status === "failed") {
		return (
			<Alert variant="destructive">
				<IconAlertTriangle aria-hidden="true" className="size-4" />
				<AlertTitle>
					{t("travelExpenses.report.save.failedTitle", "Your changes could not be saved")}
				</AlertTitle>
				<AlertDescription className="space-y-3">
					<p>
						{t(
							"travelExpenses.report.save.failedDescription",
							"Your edits are kept on this page. Check your connection and try again.",
						)}
					</p>
					<Button type="button" size="sm" variant="outline" onClick={onRetry}>
						<IconRefresh aria-hidden="true" className="mr-2 size-4" />
						{t("travelExpenses.report.save.retry", "Try again")}
					</Button>
				</AlertDescription>
			</Alert>
		);
	}

	const display = {
		saved: {
			icon: <IconCircleCheck aria-hidden="true" className="size-4 text-emerald-600" />,
			label: t("travelExpenses.report.save.saved", "All changes saved"),
		},
		pending: {
			icon: <IconPencil aria-hidden="true" className="size-4" />,
			label: t("travelExpenses.report.save.pending", "Unsaved changes"),
		},
		saving: {
			icon: <IconLoader2 aria-hidden="true" className="size-4 animate-spin" />,
			label: t("travelExpenses.report.save.saving", "Saving…"),
		},
		invalid: {
			icon: <IconAlertTriangle aria-hidden="true" className="size-4 text-destructive" />,
			label: t("travelExpenses.report.save.invalid", "Not saved: correct the highlighted fields"),
		},
	}[state.status];

	return (
		<p
			role="status"
			aria-live="polite"
			className="flex items-center gap-2 text-sm text-muted-foreground"
		>
			{display.icon}
			{display.label}
		</p>
	);
}
