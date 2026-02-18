"use client";

import {
	IconCopy,
	IconDownload,
	IconKey,
	IconLoader2,
	IconRefresh,
	IconShieldCheck,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	exportPublicKeyAction,
	getSigningKeyHistoryAction,
	rotateSigningKeyAction,
} from "@/app/[locale]/(app)/settings/audit-export/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/navigation";

interface KeyInfo {
	keyId: string;
	fingerprint: string;
	version: number;
	isActive: boolean;
	createdAt: Date;
}

interface KeyManagementProps {
	organizationId: string;
	activeKeyFingerprint?: string;
	activeKeyVersion?: number;
}

export function KeyManagement({
	organizationId,
	activeKeyFingerprint,
	activeKeyVersion,
}: KeyManagementProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [keyHistory, setKeyHistory] = useState<KeyInfo[]>([]);
	const [publicKey, setPublicKey] = useState<{
		publicKeyPem: string;
		fingerprint: string;
		algorithm: string;
		version: number;
	} | null>(null);
	const [publicKeyLoading, setPublicKeyLoading] = useState(false);

	const handleRotateKey = async () => {
		setLoading(true);
		const result = await rotateSigningKeyAction(organizationId).catch((error: unknown) => {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Rotate key error:", error);
			return null;
		});

		if (!result) {
			setLoading(false);
			return;
		}

		if (result.success) {
			toast.success(t("settings.auditExport.keys.rotateSuccess", "Signing key rotated successfully"));
			router.refresh();
		} else {
			toast.error(result.error || t("settings.auditExport.keys.rotateError", "Key rotation failed"));
		}

		setLoading(false);
	};

	const loadKeyHistory = async () => {
		setHistoryLoading(true);
		const result = await getSigningKeyHistoryAction(organizationId).catch((error: unknown) => {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Load key history error:", error);
			return null;
		});

		if (!result) {
			setHistoryLoading(false);
			return;
		}

		if (result.success) {
			setKeyHistory(result.data);
		} else {
			toast.error(result.error || t("settings.auditExport.keys.historyError", "Failed to load key history"));
		}

		setHistoryLoading(false);
	};

	const loadPublicKey = async () => {
		setPublicKeyLoading(true);
		const result = await exportPublicKeyAction(organizationId).catch((error: unknown) => {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Export public key error:", error);
			return null;
		});

		if (!result) {
			setPublicKeyLoading(false);
			return;
		}

		if (result.success) {
			setPublicKey(result.data);
		} else {
			toast.error(result.error || t("settings.auditExport.keys.exportError", "Failed to export public key"));
		}

		setPublicKeyLoading(false);
	};

	const handleCopyPublicKey = () => {
		if (publicKey?.publicKeyPem) {
			navigator.clipboard.writeText(publicKey.publicKeyPem);
			toast.success(t("settings.auditExport.keys.copied", "Public key copied to clipboard"));
		}
	};

	const handleDownloadPublicKey = () => {
		if (publicKey?.publicKeyPem) {
			const blob = new Blob([publicKey.publicKeyPem], { type: "application/x-pem-file" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `audit-signing-key-v${publicKey.version}.pem`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			toast.success(t("settings.auditExport.keys.downloaded", "Public key downloaded"));
		}
	};

	if (!activeKeyFingerprint) {
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconKey className="size-5" />
					{t("settings.auditExport.keys.title", "Signing Key Management")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.auditExport.keys.description",
						"Manage Ed25519 signing keys for audit package authentication",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Active Key Info */}
				<div className="rounded-lg border p-4 space-y-3">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<IconShieldCheck className="size-5 text-green-600" />
							<span className="font-medium">
								{t("settings.auditExport.keys.activeKey", "Active Key")}
							</span>
							<Badge variant="secondary">
								{t("settings.auditExport.keys.version", "v{version}", {
									version: activeKeyVersion ?? 1,
								})}
							</Badge>
						</div>
					</div>
					<div className="space-y-1">
						<p className="text-sm text-muted-foreground">
							{t("settings.auditExport.keys.fingerprint", "Fingerprint")}
						</p>
						<code className="block rounded bg-muted px-2 py-1 font-mono text-sm break-all">
							{activeKeyFingerprint}
						</code>
					</div>
				</div>

				{/* Actions */}
				<div className="flex flex-wrap gap-2">
					{/* Export Public Key */}
					<Dialog>
						<DialogTrigger asChild>
							<Button variant="outline" onClick={loadPublicKey}>
								<IconDownload className="mr-2 size-4" />
								{t("settings.auditExport.keys.exportPublicKey", "Export Public Key")}
							</Button>
						</DialogTrigger>
						<DialogContent className="max-w-2xl">
							<DialogHeader>
								<DialogTitle>
									{t("settings.auditExport.keys.exportTitle", "Export Public Key")}
								</DialogTitle>
								<DialogDescription>
									{t(
										"settings.auditExport.keys.exportDescription",
										"Use this public key to verify audit package signatures externally",
									)}
								</DialogDescription>
							</DialogHeader>
							{publicKeyLoading ? (
								<div className="flex items-center justify-center py-8">
									<IconLoader2 className="size-6 animate-spin" />
								</div>
							) : publicKey ? (
								<div className="space-y-4">
									<div className="space-y-2">
										<div className="flex items-center justify-between">
											<p className="text-sm font-medium">
												{t("settings.auditExport.keys.pemFormat", "PEM Format")}
											</p>
											<div className="flex gap-2">
												<Button variant="outline" size="sm" onClick={handleCopyPublicKey}>
													<IconCopy className="mr-2 size-4" />
													{t("common.copy", "Copy")}
												</Button>
												<Button variant="outline" size="sm" onClick={handleDownloadPublicKey}>
													<IconDownload className="mr-2 size-4" />
													{t("common.download", "Download")}
												</Button>
											</div>
										</div>
										<Textarea
											readOnly
											value={publicKey.publicKeyPem}
											className="font-mono text-xs h-32"
										/>
									</div>
									<div className="grid grid-cols-2 gap-4 text-sm">
										<div>
											<p className="text-muted-foreground">
												{t("settings.auditExport.keys.algorithm", "Algorithm")}
											</p>
											<p className="font-medium">{publicKey.algorithm}</p>
										</div>
										<div>
											<p className="text-muted-foreground">
												{t("settings.auditExport.keys.keyVersion", "Version")}
											</p>
											<p className="font-medium">{publicKey.version}</p>
										</div>
									</div>
								</div>
							) : (
								<p className="text-muted-foreground text-center py-4">
									{t("settings.auditExport.keys.noKeyData", "No key data available")}
								</p>
							)}
						</DialogContent>
					</Dialog>

					{/* View History */}
					<Dialog>
						<DialogTrigger asChild>
							<Button variant="outline" onClick={loadKeyHistory}>
								{historyLoading ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" />
								) : (
									<IconRefresh className="mr-2 size-4" />
								)}
								{t("settings.auditExport.keys.viewHistory", "Key History")}
							</Button>
						</DialogTrigger>
						<DialogContent className="max-w-2xl">
							<DialogHeader>
								<DialogTitle>
									{t("settings.auditExport.keys.historyTitle", "Signing Key History")}
								</DialogTitle>
								<DialogDescription>
									{t(
										"settings.auditExport.keys.historyDescription",
										"All signing keys used by this organization",
									)}
								</DialogDescription>
							</DialogHeader>
							{historyLoading ? (
								<div className="flex items-center justify-center py-8">
									<IconLoader2 className="size-6 animate-spin" />
								</div>
							) : keyHistory.length > 0 ? (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t("settings.auditExport.keys.colVersion", "Version")}</TableHead>
											<TableHead>
												{t("settings.auditExport.keys.colFingerprint", "Fingerprint")}
											</TableHead>
											<TableHead>{t("settings.auditExport.keys.colCreated", "Created")}</TableHead>
											<TableHead>{t("settings.auditExport.keys.colStatus", "Status")}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{keyHistory.map((key) => (
											<TableRow key={key.keyId}>
												<TableCell>v{key.version}</TableCell>
												<TableCell className="font-mono text-xs">
													{key.fingerprint.substring(0, 16)}…
												</TableCell>
												<TableCell>{new Date(key.createdAt).toLocaleDateString()}</TableCell>
												<TableCell>
													{key.isActive ? (
														<Badge>{t("settings.auditExport.keys.active", "Active")}</Badge>
													) : (
														<Badge variant="secondary">
															{t("settings.auditExport.keys.rotated", "Rotated")}
														</Badge>
													)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							) : (
								<p className="text-muted-foreground text-center py-4">
									{t("settings.auditExport.keys.noHistory", "No key history available")}
								</p>
							)}
						</DialogContent>
					</Dialog>

					{/* Rotate Key */}
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant="outline">
								<IconRefresh className="mr-2 size-4" />
								{t("settings.auditExport.keys.rotateKey", "Rotate Key")}
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									{t("settings.auditExport.keys.rotateTitle", "Rotate Signing Key")}
								</AlertDialogTitle>
								<AlertDialogDescription>
									{t(
										"settings.auditExport.keys.rotateDescription",
										"This will generate a new signing key. The old key will be kept for verification of existing packages but will no longer be used for new signatures. This action cannot be undone.",
									)}
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
								<AlertDialogAction onClick={handleRotateKey} disabled={loading}>
									{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
									{t("settings.auditExport.keys.rotateConfirm", "Rotate Key")}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>

				<p className="text-xs text-muted-foreground">
					{t(
						"settings.auditExport.keys.rotateHint",
						"Key rotation is recommended annually or if you suspect key compromise. Old keys remain valid for verifying previously signed packages.",
					)}
				</p>
			</CardContent>
		</Card>
	);
}
