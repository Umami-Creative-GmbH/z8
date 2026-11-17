"use client";

import { IconAlertTriangle, IconCheck, IconCopy, IconKey } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { CreateApiKeyResponse } from "@/lib/validations/api-key";

interface ApiKeyShowDialogProps {
	apiKey: CreateApiKeyResponse | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ApiKeyShowDialog(props: ApiKeyShowDialogProps) {
	if (!props.apiKey || !props.open) return null;
	return <ApiKeyReveal key={props.apiKey.id} {...props} apiKey={props.apiKey} />;
}

function ApiKeyReveal({
	apiKey,
	open,
	onOpenChange,
}: ApiKeyShowDialogProps & { apiKey: CreateApiKeyResponse }) {
	const { t } = useTranslate();
	const [copied, setCopied] = useState(false);
	const [hasConfirmed, setHasConfirmed] = useState(false);
	const [visible, setVisible] = useState(true);
	const lifetime = useRef<object | null>(null);
	useLayoutEffect(() => {
		lifetime.current = {};
		return () => {
			lifetime.current = null;
		};
	}, []);

	const handleCopy = async () => {
		if (!lifetime.current) return;
		const owner = lifetime.current;
		try {
			await navigator.clipboard.writeText(apiKey.key);
		} catch {
			if (lifetime.current === owner)
				toast.error(t("settings.apiKeys.copyFailed", "Could not copy the key. Try again."));
			return;
		}
		if (lifetime.current !== owner) return;
		setCopied(true);
		toast.success(t("settings.apiKeys.keyCopied", "API key copied to clipboard"));
	};

	const handleClose = () => {
		if (!copied && !hasConfirmed) {
			setHasConfirmed(true);
			return; // First click shows warning
		}
		// Reset state and close
		setCopied(false);
		setHasConfirmed(false);
		onOpenChange(false);
	};

	if (!apiKey) return null;

	return (
		<ActionPanel open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
			<ActionPanelContent onPointerDownOutside={(e) => e.preventDefault()}>
				<ActionPanelHeader>
					<ActionPanelTitle className="flex items-center gap-2">
						<IconKey className="size-5 text-green-600" />
						{t("settings.apiKeys.showTitle", "API Key Created")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.apiKeys.showDescription",
							'Your new API key "{name}" has been created. Copy it now - you won\'t be able to see it again!',
							{ name: apiKey.name },
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody className="space-y-4">
					{/* Warning Banner */}
					<div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md">
						<IconAlertTriangle className="size-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
						<div className="text-sm text-amber-800 dark:text-amber-200">
							<strong>{t("settings.apiKeys.showWarningTitle", "Important:")}</strong>{" "}
							{t(
								"settings.apiKeys.showWarning",
								"This is the only time you will see this key. Make sure to copy and store it securely.",
							)}
						</div>
					</div>

					{/* API Key Display */}
					<div className="space-y-2">
						<Label htmlFor="api-key-display">
							{t("settings.apiKeys.showLabel", "Your API Key")}
						</Label>
						<div className="relative">
							<div
								id="api-key-display"
								className="font-mono text-sm bg-muted p-4 rounded-md break-all pr-12 border"
							>
								{visible ? apiKey.key : t("settings.apiKeys.keyHidden", "Key hidden")}
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="absolute right-2 top-2"
								onClick={handleCopy}
								aria-label={t("settings.apiKeys.copyKey", "Copy API key")}
							>
								{copied ? (
									<IconCheck className="size-4 text-green-600" />
								) : (
									<IconCopy className="size-4" />
								)}
							</Button>
						</div>
						{
							<Button variant="outline" onClick={() => setVisible((value) => !value)}>
								{visible
									? t("settings.apiKeys.hideKey", "Hide key")
									: t("settings.apiKeys.revealKey", "Reveal key")}
							</Button>
						}
					</div>

					{/* Key Details */}
					<div className="grid grid-cols-2 gap-4 text-sm">
						<div>
							<span className="text-muted-foreground">
								{t("settings.apiKeys.showName", "Name:")}
							</span>
							<span className="ml-2 font-medium">{apiKey.name}</span>
						</div>
						<div>
							<span className="text-muted-foreground">
								{t("settings.apiKeys.showExpires", "Expires:")}
							</span>
							<span className="ml-2 font-medium">
								{apiKey.expiresAt
									? Temporal.Instant.from(apiKey.expiresAt).toLocaleString(undefined, {
											timeZone: "UTC",
											year: "numeric",
											month: "short",
											day: "numeric",
										})
									: t("settings.apiKeys.showNever", "Never")}
							</span>
						</div>
					</div>

					{/* Copy Status */}
					{copied && (
						<div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
							<IconCheck className="size-4" />
							{t("settings.apiKeys.showCopied", "Key copied to clipboard")}
						</div>
					)}
				</ActionPanelBody>

				<ActionPanelFooter className="flex-col sm:flex-row gap-2">
					{!copied && hasConfirmed && (
						<p className="text-sm text-destructive mr-auto">
							{t(
								"settings.apiKeys.showConfirmWarning",
								"Are you sure? You haven't copied the key yet.",
							)}
						</p>
					)}
					<Button onClick={handleClose} variant={copied ? "default" : "outline"}>
						{copied
							? t("settings.apiKeys.showDone", "Done")
							: hasConfirmed
								? t("settings.apiKeys.showCloseAnyway", "Close Anyway")
								: t("settings.apiKeys.showClose", "Close")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
