"use client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useTranslate } from "@tolgee/react";

export function ScimDestructiveDialogs({ action, onCancel, onConfirm }: { action: "revoke" | "decommission" | null; onCancel: () => void; onConfirm: () => void }) {
	const decommission = action === "decommission";
	const { t } = useTranslate();
	return <AlertDialog open={action !== null} onOpenChange={(open) => { if (!open) onCancel(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{decommission ? t("settings.enterprise.identity.scim.dialog.decommission.title", "Decommission SCIM") : t("settings.enterprise.identity.scim.dialog.revoke.title", "Revoke credential")}</AlertDialogTitle><AlertDialogDescription>{decommission ? t("settings.enterprise.identity.scim.dialog.decommission.description", "This permanently decommissions SCIM provisioning and cannot be undone.") : t("settings.enterprise.identity.scim.dialog.revoke.description", "This immediately prevents the credential from provisioning users.")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={onCancel}>{t("settings.enterprise.identity.scim.dialog.cancel", "Cancel")}</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onConfirm}>{decommission ? t("settings.enterprise.identity.scim.action.decommission", "Decommission") : t("settings.enterprise.identity.scim.credentials.revoke", "Revoke")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
