"use client";

import { IconCheck, IconCopy, IconKey } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface WebhookSecretDialogProps {
	secret: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function WebhookSecretDialog({ secret, open, onOpenChange }: WebhookSecretDialogProps) {
	const { t } = useTranslate();
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (!secret) return;

		try {
			await navigator.clipboard.writeText(secret);
			setCopied(true);
			toast.success(t("settings:webhooks.secret-copied", "Secret copied to clipboard"));
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error(t("settings:webhooks.copy-failed", "Failed to copy to clipboard"));
		}
	};

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle className="flex items-center gap-2">
						<IconKey className="h-5 w-5" aria-hidden="true" />
						{t("settings:webhooks.secret-dialog.title", "Webhook Secret")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings:webhooks.secret-dialog.description",
							"This secret is used to verify webhook signatures. Store it securely.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody className="space-y-4">
					<Alert variant="default" className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
						<AlertTitle className="text-yellow-700 dark:text-yellow-400">
							{t("settings:webhooks.secret-dialog.warning-title", "Important")}
						</AlertTitle>
						<AlertDescription className="text-yellow-600 dark:text-yellow-500">
							{t(
								"settings:webhooks.secret-dialog.warning",
								"This secret will only be shown once. Make sure to save it now.",
							)}
						</AlertDescription>
					</Alert>

					<div className="space-y-2">
						<label htmlFor="webhook-secret-input" className="text-sm font-medium">
							{t("settings:webhooks.secret-dialog.secret", "Signing Secret")}
						</label>
						<div className="flex gap-2">
							<Input
								id="webhook-secret-input"
								value={secret ?? ""}
								readOnly
								className="font-mono text-sm"
							/>
							<Button
								variant="outline"
								size="icon"
								onClick={handleCopy}
								className="shrink-0"
								aria-label={t(
									"settings:webhooks.secret-dialog.copy-secret",
									"Copy secret to clipboard",
								)}
							>
								{copied ? (
									<IconCheck className="h-4 w-4 text-green-600" aria-hidden="true" />
								) : (
									<IconCopy className="h-4 w-4" aria-hidden="true" />
								)}
							</Button>
						</div>
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium">
							{t("settings:webhooks.secret-dialog.verification", "Signature Verification")}
						</label>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings:webhooks.secret-dialog.verification-hint",
								"Verify webhook signatures using HMAC-SHA256. The signature is sent in the X-Z8-Signature header.",
							)}
						</p>
						<pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto">
							{`// Example verification in Node.js
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const expected = 'sha256=' +
    crypto.createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}`}
						</pre>
					</div>
				</ActionPanelBody>

				<ActionPanelFooter>
					<Button onClick={() => onOpenChange(false)}>
						{t("settings:webhooks.secret-dialog.done", "I've saved the secret")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
