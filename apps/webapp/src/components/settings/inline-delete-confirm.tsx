"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The inline "Delete this …?" confirmation of a list row (project tasks and
 * templates): a question, Cancel, and a destructive Delete that shows a spinner
 * while the deletion runs.
 */
export function InlineDeleteConfirm({
	question,
	confirmLabel,
	deleteText,
	isDeleting,
	onCancel,
	onConfirm,
	className,
}: {
	question: string;
	/** The accessible name of the Delete button, naming what is deleted. */
	confirmLabel: string;
	deleteText: string;
	isDeleting: boolean;
	onCancel: () => void;
	onConfirm: () => void;
	className?: string;
}) {
	const { t } = useTranslate();
	return (
		<div className={cn("flex items-center gap-1", className)}>
			<span className="text-xs text-muted-foreground">{question}</span>
			<Button type="button" variant="ghost" size="sm" disabled={isDeleting} onClick={onCancel}>
				{t("common.cancel", "Cancel")}
			</Button>
			<Button
				type="button"
				variant="destructive"
				size="sm"
				disabled={isDeleting}
				aria-label={confirmLabel}
				onClick={onConfirm}
			>
				{isDeleting && <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />}
				{deleteText}
			</Button>
		</div>
	);
}
