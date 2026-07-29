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
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	exportPublicKeyAction,
	getSigningKeyHistoryAction,
	rotateSigningKeyAction,
} from "@/app/[locale]/(app)/settings/audit-export/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
	ActionPanelTrigger,
} from "@/components/ui/action-panel";
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
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useDisplayContext } from "@/hooks/use-display-context";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
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

type Translate = ReturnType<typeof useTranslate>["t"];
type DisplayContext = ReturnType<typeof useDisplayContext>;
type PublicKeyInfo = {
	publicKeyPem: string;
	fingerprint: string;
	algorithm: string;
	version: number;
};
type AsyncResult<T> =
	| { success: true; value: T }
	| { success: false; error: unknown };

async function settle<T>(promise: Promise<T>): Promise<AsyncResult<T>> {
	try {
		return { success: true, value: await promise };
	} catch (error) {
		return { success: false, error };
	}
}

export function KeyManagement({
	organizationId,
	activeKeyFingerprint,
	activeKeyVersion,
}: KeyManagementProps) {
	return (
		<KeyManagementForOrganization
			key={organizationId}
			organizationId={organizationId}
			activeKeyFingerprint={activeKeyFingerprint}
			activeKeyVersion={activeKeyVersion}
		/>
	);
}

function KeyManagementForOrganization({
	organizationId,
	activeKeyFingerprint,
	activeKeyVersion,
}: KeyManagementProps) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [keyHistory, setKeyHistory] = useState<KeyInfo[]>([]);
	const [publicKey, setPublicKey] = useState<PublicKeyInfo | null>(null);
	const [publicKeyLoading, setPublicKeyLoading] = useState(false);
	const organizationOperationRef = useRef({ organizationId, active: true });
	const rotateOperationRef = useRef(0);
	const historyOperationRef = useRef(0);
	const publicKeyOperationRef = useRef(0);

	useEffect(() => {
		return () => {
			organizationOperationRef.current.active = false;
			rotateOperationRef.current += 1;
			historyOperationRef.current += 1;
			publicKeyOperationRef.current += 1;
		};
	}, []);

	const handleRotateKey = async () => {
		const organizationOperation = organizationOperationRef.current;
		const keyOperation = ++rotateOperationRef.current;
		setLoading(true);
		const actionResult = await settle(rotateSigningKeyAction(organizationId));
		if (
			organizationOperationRef.current !== organizationOperation ||
			!organizationOperation.active ||
			rotateOperationRef.current !== keyOperation
		) {
			return;
		}
		setLoading(false);
		if (!actionResult.success) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Rotate key error:", actionResult.error);
			return;
		}

		const result = actionResult.value;
		if (result.success) {
			toast.success(
				t(
					"settings.auditExport.keys.rotateSuccess",
					"Signing key rotated successfully",
				),
			);
			router.refresh();
		} else {
			toast.error(
				result.error ||
					t("settings.auditExport.keys.rotateError", "Key rotation failed"),
			);
		}
	};

	const loadKeyHistory = async () => {
		const organizationOperation = organizationOperationRef.current;
		const keyOperation = ++historyOperationRef.current;
		setHistoryLoading(true);
		const actionResult = await settle(
			getSigningKeyHistoryAction(organizationId),
		);
		if (
			organizationOperationRef.current !== organizationOperation ||
			!organizationOperation.active ||
			historyOperationRef.current !== keyOperation
		) {
			return;
		}
		setHistoryLoading(false);
		if (!actionResult.success) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Load key history error:", actionResult.error);
			return;
		}

		const result = actionResult.value;
		if (result.success) {
			setKeyHistory(result.data);
		} else {
			toast.error(
				result.error ||
					t(
						"settings.auditExport.keys.historyError",
						"Failed to load key history",
					),
			);
		}
	};

	const loadPublicKey = async () => {
		const organizationOperation = organizationOperationRef.current;
		const keyOperation = ++publicKeyOperationRef.current;
		setPublicKeyLoading(true);
		const actionResult = await settle(exportPublicKeyAction(organizationId));
		if (
			organizationOperationRef.current !== organizationOperation ||
			!organizationOperation.active ||
			publicKeyOperationRef.current !== keyOperation
		) {
			return;
		}
		setPublicKeyLoading(false);
		if (!actionResult.success) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			console.error("Export public key error:", actionResult.error);
			return;
		}

		const result = actionResult.value;
		if (result.success) {
			setPublicKey(result.data);
		} else {
			toast.error(
				result.error ||
					t(
						"settings.auditExport.keys.exportError",
						"Failed to export public key",
					),
			);
		}
	};

	const handleCopyPublicKey = async () => {
		if (publicKey?.publicKeyPem) {
			try {
				await navigator.clipboard.writeText(publicKey.publicKeyPem);
				toast.success(
					t(
						"settings.auditExport.keys.copied",
						"Public key copied to clipboard",
					),
				);
			} catch {
				toast.error(
					t("settings.auditExport.keys.copyError", "Failed to copy public key"),
				);
			}
		}
	};

	const handleDownloadPublicKey = () => {
		if (publicKey?.publicKeyPem) {
			const blob = new Blob([publicKey.publicKeyPem], {
				type: "application/x-pem-file",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `audit-signing-key-v${publicKey.version}.pem`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			toast.success(
				t("settings.auditExport.keys.downloaded", "Public key downloaded"),
			);
		}
	};

	if (!activeKeyFingerprint) {
		return null;
	}

	return (
		<KeyManagementCard
			activeKeyFingerprint={activeKeyFingerprint}
			activeKeyVersion={activeKeyVersion}
			displayContext={displayContext}
			historyLoading={historyLoading}
			keyHistory={keyHistory}
			loading={loading}
			publicKey={publicKey}
			publicKeyLoading={publicKeyLoading}
			onCopyPublicKey={() => void handleCopyPublicKey()}
			onDownloadPublicKey={handleDownloadPublicKey}
			onLoadKeyHistory={loadKeyHistory}
			onLoadPublicKey={loadPublicKey}
			onRotateKey={handleRotateKey}
			t={t}
		/>
	);
}

function KeyManagementCard({
	activeKeyFingerprint,
	activeKeyVersion,
	displayContext,
	historyLoading,
	keyHistory,
	loading,
	publicKey,
	publicKeyLoading,
	onCopyPublicKey,
	onDownloadPublicKey,
	onLoadKeyHistory,
	onLoadPublicKey,
	onRotateKey,
	t,
}: {
	activeKeyFingerprint: string;
	activeKeyVersion?: number;
	displayContext: DisplayContext;
	historyLoading: boolean;
	keyHistory: KeyInfo[];
	loading: boolean;
	publicKey: PublicKeyInfo | null;
	publicKeyLoading: boolean;
	onCopyPublicKey: () => void;
	onDownloadPublicKey: () => void;
	onLoadKeyHistory: () => Promise<void>;
	onLoadPublicKey: () => Promise<void>;
	onRotateKey: () => Promise<void>;
	t: Translate;
}) {
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
				<ActiveKeySummary
					fingerprint={activeKeyFingerprint}
					version={activeKeyVersion}
					t={t}
				/>

				{/* Actions */}
				<div className="flex flex-wrap gap-2">
					{/* Export Public Key */}
					<ActionPanel>
						<ActionPanelTrigger asChild>
							<Button variant="outline" onClick={onLoadPublicKey}>
								<IconDownload className="mr-2 size-4" />
								{t(
									"settings.auditExport.keys.exportPublicKey",
									"Export Public Key",
								)}
							</Button>
						</ActionPanelTrigger>
						<ActionPanelContent size="wide">
							<ActionPanelHeader>
								<ActionPanelTitle>
									{t(
										"settings.auditExport.keys.exportTitle",
										"Export Public Key",
									)}
								</ActionPanelTitle>
								<ActionPanelDescription>
									{t(
										"settings.auditExport.keys.exportDescription",
										"Use this public key to verify audit package signatures externally",
									)}
								</ActionPanelDescription>
							</ActionPanelHeader>
							<ActionPanelBody>
								{publicKeyLoading ? (
									<div className="flex items-center justify-center py-8">
										<IconLoader2 className="size-6 animate-spin" />
									</div>
								) : publicKey ? (
									<div className="space-y-4">
										<div className="space-y-2">
											<div className="flex items-center justify-between">
												<p className="text-sm font-medium">
													{t(
														"settings.auditExport.keys.pemFormat",
														"PEM Format",
													)}
												</p>
												<div className="flex gap-2">
													<Button
														variant="outline"
														size="sm"
														onClick={onCopyPublicKey}
													>
														<IconCopy className="mr-2 size-4" />
														{t("common.copy", "Copy")}
													</Button>
													<Button
														variant="outline"
														size="sm"
														onClick={onDownloadPublicKey}
													>
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
													{t(
														"settings.auditExport.keys.algorithm",
														"Algorithm",
													)}
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
										{t(
											"settings.auditExport.keys.noKeyData",
											"No key data available",
										)}
									</p>
								)}
							</ActionPanelBody>
						</ActionPanelContent>
					</ActionPanel>

					{/* View History */}
					<ActionPanel>
						<ActionPanelTrigger asChild>
							<Button variant="outline" onClick={onLoadKeyHistory}>
								{historyLoading ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" />
								) : (
									<IconRefresh className="mr-2 size-4" />
								)}
								{t("settings.auditExport.keys.viewHistory", "Key History")}
							</Button>
						</ActionPanelTrigger>
						<ActionPanelContent size="wide">
							<ActionPanelHeader>
								<ActionPanelTitle>
									{t(
										"settings.auditExport.keys.historyTitle",
										"Signing Key History",
									)}
								</ActionPanelTitle>
								<ActionPanelDescription>
									{t(
										"settings.auditExport.keys.historyDescription",
										"All signing keys used by this organization",
									)}
								</ActionPanelDescription>
							</ActionPanelHeader>
							<ActionPanelBody>
								{historyLoading ? (
									<div className="flex items-center justify-center py-8">
										<IconLoader2 className="size-6 animate-spin" />
									</div>
								) : keyHistory.length > 0 ? (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>
													{t("settings.auditExport.keys.colVersion", "Version")}
												</TableHead>
												<TableHead>
													{t(
														"settings.auditExport.keys.colFingerprint",
														"Fingerprint",
													)}
												</TableHead>
												<TableHead>
													{t("settings.auditExport.keys.colCreated", "Created")}
												</TableHead>
												<TableHead>
													{t("settings.auditExport.keys.colStatus", "Status")}
												</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{keyHistory.map((key) => (
												<TableRow key={key.keyId}>
													<TableCell>v{key.version}</TableCell>
													<TableCell className="font-mono text-xs">
														{key.fingerprint.substring(0, 16)}…
													</TableCell>
													<TableCell>
														{formatInstant(
															instantFromDate(key.createdAt),
															displayContext,
															"dateMedium",
														)}
													</TableCell>
													<TableCell>
														{key.isActive ? (
															<Badge>
																{t(
																	"settings.auditExport.keys.active",
																	"Active",
																)}
															</Badge>
														) : (
															<Badge variant="secondary">
																{t(
																	"settings.auditExport.keys.rotated",
																	"Rotated",
																)}
															</Badge>
														)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								) : (
									<p className="text-muted-foreground text-center py-4">
										{t(
											"settings.auditExport.keys.noHistory",
											"No key history available",
										)}
									</p>
								)}
							</ActionPanelBody>
						</ActionPanelContent>
					</ActionPanel>

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
									{t(
										"settings.auditExport.keys.rotateTitle",
										"Rotate Signing Key",
									)}
								</AlertDialogTitle>
								<AlertDialogDescription>
									{t(
										"settings.auditExport.keys.rotateDescription",
										"This will generate a new signing key. The old key will be kept for verification of existing packages but will no longer be used for new signatures. This action cannot be undone.",
									)}
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>
									{t("common.cancel", "Cancel")}
								</AlertDialogCancel>
								<AlertDialogAction onClick={onRotateKey} disabled={loading}>
									{loading && (
										<IconLoader2 className="mr-2 size-4 animate-spin" />
									)}
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

function ActiveKeySummary({
	fingerprint,
	version,
	t,
}: {
	fingerprint: string;
	version?: number;
	t: Translate;
}) {
	return (
		<div className="rounded-lg border p-4 space-y-3">
			<div className="flex items-center gap-2">
				<IconShieldCheck className="size-5 text-green-600" />
				<span className="font-medium">
					{t("settings.auditExport.keys.activeKey", "Active Key")}
				</span>
				<Badge variant="secondary">
					{t("settings.auditExport.keys.version", "v{version}", {
						version: version ?? 1,
					})}
				</Badge>
			</div>
			<div className="space-y-1">
				<p className="text-sm text-muted-foreground">
					{t("settings.auditExport.keys.fingerprint", "Fingerprint")}
				</p>
				<code className="block rounded bg-muted px-2 py-1 font-mono text-sm break-all">
					{fingerprint}
				</code>
			</div>
		</div>
	);
}
