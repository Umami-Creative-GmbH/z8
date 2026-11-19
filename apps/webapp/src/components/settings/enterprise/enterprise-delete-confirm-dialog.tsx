"use client";

import {
	ConfirmActionDialog,
	useConfirmedAction,
} from "@/components/settings/confirm-action-dialog";

/**
 * State for confirming the removal of one record; the shared settings
 * confirmation state (`useConfirmedAction`) under an enterprise name.
 */
export const useConfirmedRemoval = useConfirmedAction;

/**
 * The confirmation of an irreversible enterprise identity removal (custom domain,
 * SSO provider, social sign-in), built on the shared `ConfirmActionDialog`: the
 * dialog stays open while the removal runs, Cancel, Escape and outside presses
 * cannot hide it, and the caller closes it on success. A failure stays visible
 * inline so the administrator can retry or cancel.
 */
export function EnterpriseDeleteConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	isPending,
	error,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirmLabel: string;
	isPending: boolean;
	error: string | null;
	onConfirm: () => void;
}) {
	return (
		<ConfirmActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			description={description}
			confirmLabel={confirmLabel}
			isPending={isPending}
			error={error}
			onConfirm={onConfirm}
		/>
	);
}
