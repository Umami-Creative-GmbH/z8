"use client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function ScimDestructiveDialogs({ action, onCancel, onConfirm }: { action: "revoke" | "decommission" | null; onCancel: () => void; onConfirm: () => void }) {
	const decommission = action === "decommission";
	return <AlertDialog open={action !== null} onOpenChange={(open) => { if (!open) onCancel(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{decommission ? "Decommission SCIM" : "Revoke credential"}</AlertDialogTitle><AlertDialogDescription>{decommission ? "This permanently decommissions SCIM provisioning and cannot be undone." : "This immediately prevents the credential from provisioning users."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onConfirm}>{decommission ? "Decommission" : "Revoke"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
