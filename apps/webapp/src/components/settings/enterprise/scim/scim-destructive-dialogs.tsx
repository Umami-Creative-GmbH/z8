"use client";
import { useTranslate } from "@tolgee/react";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";

/**
 * Confirms revoking a SCIM credential or decommissioning SCIM. The dialog stays
 * open while the change runs and shows a failure inline; the controller closes
 * it once the change is done.
 */
export function ScimDestructiveDialogs({
	action,
	pending = false,
	error = null,
	onCancel,
	onConfirm,
}: {
	action: "revoke" | "decommission" | null;
	pending?: boolean;
	error?: string | null;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const decommission = action === "decommission";
	const { t } = useTranslate();
	return (
		<ConfirmActionDialog
			open={action !== null}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
			title={
				decommission
					? t("settings.enterprise.identity.scim.dialog.decommission.title", "Decommission SCIM")
					: t("settings.enterprise.identity.scim.dialog.revoke.title", "Revoke credential")
			}
			description={
				decommission
					? t(
							"settings.enterprise.identity.scim.dialog.decommission.description",
							"This permanently decommissions SCIM provisioning and cannot be undone.",
						)
					: t(
							"settings.enterprise.identity.scim.dialog.revoke.description",
							"This immediately prevents the credential from provisioning users.",
						)
			}
			confirmLabel={
				decommission
					? t("settings.enterprise.identity.scim.action.decommission", "Decommission")
					: t("settings.enterprise.identity.scim.credentials.revoke", "Revoke")
			}
			isPending={pending}
			error={error}
			onConfirm={onConfirm}
		/>
	);
}
