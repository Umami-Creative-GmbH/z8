"use client";

import { IconCheck, IconCopy, IconKey } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { ActionPanel, ActionPanelBody, ActionPanelContent, ActionPanelDescription, ActionPanelFooter, ActionPanelHeader, ActionPanelTitle } from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function ScimOneTimeCredentialDialog({ credential, open, onClosed }: { credential: string | null; open: boolean; onClosed: () => void }) {
	const { t } = useTranslate();
	const [copied, setCopied] = useState(false);
	const [saved, setSaved] = useState(false);
	const [confirmClose, setConfirmClose] = useState(false);
	if (!credential) return null;
	const close = () => {
		if (!saved && !confirmClose) return setConfirmClose(true);
		setCopied(false); setSaved(false); setConfirmClose(false); onClosed();
	};
	const copy = async () => {
		try { await navigator.clipboard.writeText(credential); setCopied(true); } catch { setCopied(false); }
	};
	return <ActionPanel open={open} onOpenChange={(next) => { if (!next) close(); }}>
		<ActionPanelContent onPointerDownOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
			<ActionPanelHeader><ActionPanelTitle className="flex items-center gap-2"><IconKey className="size-5" aria-hidden="true" />{t("settings.enterprise.identity.scim.credential.title", "SCIM Credential")}</ActionPanelTitle><ActionPanelDescription>{t("settings.enterprise.identity.scim.credential.description", "Copy and store this credential now. It cannot be displayed again.")}</ActionPanelDescription></ActionPanelHeader>
			<ActionPanelBody className="space-y-4"><div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{t("settings.enterprise.identity.scim.credential.warning", "This credential is shown once. Store it in your identity provider securely.")}</div><div className="min-w-0 space-y-2"><Label htmlFor="scim-one-time-credential">{t("settings.enterprise.identity.scim.credential.label", "Credential")}</Label><div className="flex min-w-0 gap-2"><code id="scim-one-time-credential" translate="no" className="min-w-0 flex-1 break-all rounded-md border bg-muted p-3 font-mono text-sm">{credential}</code><Button type="button" variant="outline" size="icon" aria-label={t("settings.enterprise.identity.scim.credential.copy", "Copy credential")} onClick={copy}>{copied ? <IconCheck className="size-4" aria-hidden="true" /> : <IconCopy className="size-4" aria-hidden="true" />}</Button></div><p aria-live="polite" className="text-muted-foreground text-sm">{copied ? t("settings.enterprise.identity.scim.credential.copied", "Credential copied to clipboard.") : ""}</p></div><div className="flex items-start gap-3"><Checkbox id="scim-credential-saved" checked={saved} onCheckedChange={(value) => setSaved(value === true)} /><Label htmlFor="scim-credential-saved">{t("settings.enterprise.identity.scim.credential.saved", "I have saved this credential")}</Label></div></ActionPanelBody>
			<ActionPanelFooter className="flex-col gap-2 sm:flex-row">{confirmClose ? <p className="mr-auto text-destructive text-sm" aria-live="polite">{t("settings.enterprise.identity.scim.credential.confirmClose", "Confirm that the credential is saved before closing.")}</p> : null}<Button type="button" onClick={close}>{t("settings.enterprise.identity.scim.credential.close", "Close")}</Button></ActionPanelFooter>
		</ActionPanelContent>
	</ActionPanel>;
}
