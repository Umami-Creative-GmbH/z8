"use client";

import { IconCheck, IconCopy, IconKey } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
			toast.success(t("webhooks.secret-copied", "Secret copied to clipboard"));
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error(t("webhooks.copy-failed", "Failed to copy to clipboard"));
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<IconKey className="h-5 w-5" aria-hidden="true" />
						{t("webhooks.secret-dialog.title", "Webhook Secret")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"webhooks.secret-dialog.description",
							"This secret is used to verify webhook signatures. Store it securely.",
						)}
					</DialogDescription>
				</DialogHeader>

				<Alert variant="default" className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
					<AlertTitle className="text-yellow-700 dark:text-yellow-400">
						{t("webhooks.secret-dialog.warning-title", "Important")}
					</AlertTitle>
					<AlertDescription className="text-yellow-600 dark:text-yellow-500">
						{t(
							"webhooks.secret-dialog.warning",
							"This secret will only be shown once. Make sure to save it now.",
						)}
					</AlertDescription>
				</Alert>

				<div className="space-y-2">
					<label htmlFor="webhook-secret-input" className="text-sm font-medium">
						{t("webhooks.secret-dialog.secret", "Signing Secret")}
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
							aria-label={t("webhooks.secret-dialog.copy-secret", "Copy secret to clipboard")}
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
						{t("webhooks.secret-dialog.verification", "Signature Verification")}
					</label>
					<p className="text-sm text-muted-foreground">
						{t(
							"webhooks.secret-dialog.verification-hint",
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

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)}>
						{t("webhooks.secret-dialog.done", "I've saved the secret")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
