"use client";

import { IconCheck, IconCopy, IconRefresh } from "@tabler/icons-react";
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

interface Domain {
	id: string;
	domain: string;
	domainVerified: boolean;
	verificationToken: string | null;
	verificationTokenExpiresAt: Date | null;
}

interface DomainVerificationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	domain: Domain | null;
	onVerify: (domainId: string) => Promise<void>;
	onRegenerateToken: (domainId: string) => Promise<void>;
	isVerifying: boolean;
}

export function DomainVerificationDialog({
	open,
	onOpenChange,
	domain,
	onVerify,
	onRegenerateToken,
	isVerifying,
}: DomainVerificationDialogProps) {
	const [copiedField, setCopiedField] = useState<string | null>(null);
	const [isRegenerating, setIsRegenerating] = useState(false);

	if (!domain) return null;

	const txtRecordName = `_z8-verify.${domain.domain}`;
	const txtRecordValue = domain.verificationToken || "";

	const copyToClipboard = async (text: string, field: string) => {
		await navigator.clipboard.writeText(text);
		setCopiedField(field);
		toast.success("Copied to clipboard");
		setTimeout(() => setCopiedField(null), 2000);
	};

	const handleRegenerateToken = async () => {
		setIsRegenerating(true);
		await onRegenerateToken(domain.id).catch(() => undefined);
		setIsRegenerating(false);
	};

	const isExpired =
		domain.verificationTokenExpiresAt && new Date() > new Date(domain.verificationTokenExpiresAt);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>Verify Domain Ownership</ActionPanelTitle>
					<ActionPanelDescription>
						Add a DNS TXT record to verify ownership of {domain.domain}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody className="space-y-4">
					{isExpired && (
						<Alert variant="destructive">
							<AlertTitle>Token Expired</AlertTitle>
							<AlertDescription>
								The verification token has expired. Please regenerate a new token.
							</AlertDescription>
						</Alert>
					)}

					<div className="space-y-4">
						<div>
							<p className="text-sm font-medium mb-2">Add the following TXT record to your DNS:</p>
							<div className="space-y-3">
								<div className="bg-muted p-3 rounded-md">
									<div className="flex items-center justify-between mb-1">
										<span className="text-xs text-muted-foreground">Name / Host</span>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => copyToClipboard(txtRecordName, "name")}
										>
											{copiedField === "name" ? (
												<IconCheck className="size-4" />
											) : (
												<IconCopy className="size-4" />
											)}
										</Button>
									</div>
									<code className="text-sm font-mono break-all">{txtRecordName}</code>
								</div>

								<div className="bg-muted p-3 rounded-md">
									<div className="flex items-center justify-between mb-1">
										<span className="text-xs text-muted-foreground">Value</span>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => copyToClipboard(txtRecordValue, "value")}
										>
											{copiedField === "value" ? (
												<IconCheck className="size-4" />
											) : (
												<IconCopy className="size-4" />
											)}
										</Button>
									</div>
									<code className="text-sm font-mono break-all">{txtRecordValue}</code>
								</div>
							</div>
						</div>

						<Alert>
							<AlertTitle>DNS Propagation</AlertTitle>
							<AlertDescription>
								DNS changes can take up to 48 hours to propagate, though they often complete within
								a few minutes. You can click &quot;Verify&quot; once you&apos;ve added the TXT
								record.
							</AlertDescription>
						</Alert>

						{domain.verificationTokenExpiresAt && !isExpired && (
							<p className="text-sm text-muted-foreground">
								Token expires: {new Date(domain.verificationTokenExpiresAt).toLocaleDateString()}
							</p>
						)}
					</div>
				</ActionPanelBody>

				<ActionPanelFooter className="flex-col sm:flex-row gap-2">
					<Button variant="outline" onClick={handleRegenerateToken} disabled={isRegenerating}>
						<IconRefresh className="mr-2 size-4" />
						{isRegenerating ? "Regenerating..." : "Regenerate Token"}
					</Button>
					<Button onClick={() => onVerify(domain.id)} disabled={isVerifying || !!isExpired}>
						{isVerifying ? "Verifying..." : "Verify Domain"}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
