"use client";

import { keepAlertDialogOpen } from "./confirm-action-utils";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button-variants";

/**
 * State for confirming one action on one record. `request` opens the dialog for a
 * record; `confirm` runs the action once (duplicate presses are ignored while it
 * runs), closes the dialog when it resolves and keeps it open with the worded
 * error when it rejects. The record is kept after closing so the dialog's text
 * does not blank out while it animates away.
 */
export function useConfirmedAction<T>() {
	const [target, setTarget] = useState<T | null>(null);
	const [open, setOpen] = useState(false);
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pending = useRef(false);

	const request = (record: T) => {
		if (pending.current) return;
		setTarget(record);
		setError(null);
		setOpen(true);
	};

	const onOpenChange = (nextOpen: boolean) => {
		if (pending.current) return;
		setOpen(nextOpen);
		if (!nextOpen) setError(null);
	};

	const confirm = async (
		run: (record: T) => Promise<void>,
		describeError: (error: unknown) => string,
	) => {
		if (pending.current || target === null) return;
		pending.current = true;
		setIsPending(true);
		setError(null);
		const confirmedTarget = target;
		const runAction = async () => {
			try {
				await run(confirmedTarget);
				setOpen(false);
			} catch (failure) {
				setError(describeError(failure));
			}
		};
		await runAction().finally(() => {
			pending.current = false;
			setIsPending(false);
		});
	};

	return { target, open, isPending, error, request, onOpenChange, confirm };
}

export type ConfirmedAction<T> = ReturnType<typeof useConfirmedAction<T>>;

/**
 * The confirmation of a settings action that runs a mutation (delete, remove,
 * revoke, reset, disconnect …). It follows `DeleteConfirmDialog`: the dialog
 * stays open while the action runs, Cancel, Escape and outside presses cannot
 * hide it, the confirm button shows a spinner and ignores repeated presses, and
 * the caller closes it on success. A failure stays visible inline so the user
 * can retry or cancel.
 */
export function ConfirmActionDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	pendingLabel,
	isPending,
	error,
	onConfirm,
	confirmDisabled = false,
	variant = "destructive",
	cancelLabel,
	trigger,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	description: ReactNode;
	confirmLabel: ReactNode;
	/** Shown on the confirm button while the action runs; the confirm label otherwise. */
	pendingLabel?: ReactNode;
	isPending: boolean;
	error?: string | null;
	onConfirm: () => void;
	/** Extra gate on the confirm button, e.g. a typed confirmation. */
	confirmDisabled?: boolean;
	variant?: "destructive" | "default";
	/** Defaults to "Cancel". */
	cancelLabel?: ReactNode;
	/** An `AlertDialogTrigger` that opens the dialog, when it lives inside it. */
	trigger?: ReactNode;
	/** Extra content between the description and the buttons. */
	children?: ReactNode;
}) {
	const { t } = useTranslate();
	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				// Escape or an outside press must not hide an action that is still running.
				if (!nextOpen && isPending) return;
				onOpenChange(nextOpen);
			}}
		>
			{trigger}
			<AlertDialogContent aria-busy={isPending}>
				<AlertDialogHeader>
					<AlertDialogTitle className="break-words">{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				{children}
				{error ? (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>
						{cancelLabel ?? t("common.cancel", "Cancel")}
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={(event) => {
							// Keep the dialog open so the pending state and any failure stay visible.
							keepAlertDialogOpen(event);
							if (isPending || confirmDisabled) return;
							onConfirm();
						}}
						disabled={isPending || confirmDisabled}
						className={variant === "destructive" ? buttonVariants({ variant: "destructive" }) : undefined}
					>
						{isPending ? (
							<IconLoader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
						) : null}
						{isPending && pendingLabel ? pendingLabel : confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
