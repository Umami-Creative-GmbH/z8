"use client";

import { IconAlertTriangle, IconCheck, IconKey, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DiagnosticsItem, DiagnosticsStatus, PlatformDiagnosticsSnapshot } from "@/lib/platform-diagnostics";
import { cn } from "@/lib/utils";
import type { PlatformKeyManagerEncryptionResult } from "@/lib/vault/platform-key-manager";
import { Link } from "@/navigation";
import { refreshPlatformDiagnosticsAction, testPlatformKeyManagerEncryptionAction } from "./actions";

const statusStyles: Record<DiagnosticsStatus, string> = {
	healthy: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
	warning: "border-amber-500/40 text-amber-700 dark:text-amber-400",
	error: "border-red-500/40 text-red-700 dark:text-red-400",
	disabled: "border-muted-foreground/30 text-muted-foreground",
};

function StatusIcon({ status }: { status: DiagnosticsStatus }) {
	if (status === "healthy") {
		return <IconCheck className="size-3" aria-hidden="true" />;
	}

	if (status === "error") {
		return <IconX className="size-3" aria-hidden="true" />;
	}

	return <IconAlertTriangle className="size-3" aria-hidden="true" />;
}

function StatusBadge({ status, label, showLabel = true }: { status: DiagnosticsStatus; label: string; showLabel?: boolean }) {
	return (
		<Badge variant="outline" className={cn("capitalize", statusStyles[status])}>
			<StatusIcon status={status} />
			{showLabel ? label : <span className="sr-only">{label}</span>}
		</Badge>
	);
}

function DiagnosticsItemRow({ item, statusLabel }: { item: DiagnosticsItem; statusLabel: string }) {
	return (
		<div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0 space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<h3 className="text-sm font-medium">{item.title}</h3>
					<StatusBadge status={item.status} label={statusLabel} showLabel={false} />
				</div>
				{item.description ? <p className="break-words text-sm text-muted-foreground">{item.description}</p> : null}
				{item.actionHref && item.actionLabel ? (
					<Link href={item.actionHref} className="text-sm font-medium text-primary hover:underline">
						{item.actionLabel}
					</Link>
				) : null}
			</div>
			<div className="break-words font-mono text-sm text-muted-foreground sm:text-right">{item.value}</div>
		</div>
	);
}

function DiagnosticsSection({
	title,
	description,
	items,
	statusLabels,
}: {
	title: string;
	description: string;
	items: DiagnosticsItem[];
	statusLabels: Record<DiagnosticsStatus, string>;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{items.map((item) => (
					<DiagnosticsItemRow key={item.title} item={item} statusLabel={statusLabels[item.status]} />
				))}
			</CardContent>
		</Card>
	);
}

export function DiagnosticsClient({ initialSnapshot }: { initialSnapshot: PlatformDiagnosticsSnapshot }) {
	const { t } = useTranslate();
	const [snapshot, setSnapshot] = useState<PlatformDiagnosticsSnapshot>(() => initialSnapshot);
	const [error, setError] = useState<string | null>(null);
	const [encryptionResult, setEncryptionResult] = useState<PlatformKeyManagerEncryptionResult | null>(null);
	const [encryptionError, setEncryptionError] = useState<string | null>(null);
	const [isRefreshPending, startRefreshTransition] = useTransition();
	const [isEncryptionPending, startEncryptionTransition] = useTransition();
	const statusLabels: Record<DiagnosticsStatus, string> = {
		healthy: t("admin:admin.diagnostics.status.healthy", "Healthy"),
		warning: t("admin:admin.diagnostics.status.warning", "Warning"),
		error: t("admin:admin.diagnostics.status.error", "Error"),
		disabled: t("admin:admin.diagnostics.status.disabled", "Disabled"),
	};
	const encryptionStatusLabel = encryptionResult?.matches
		? t("admin:admin.diagnostics.keyManager.result.match", "Input and output match")
		: t("admin:admin.diagnostics.keyManager.result.mismatch", "Input and output differ");
	const encryptionLiveStatus = isEncryptionPending
		? t("admin:admin.diagnostics.keyManager.status.pending", "Encryption test is running.")
		: encryptionResult
			? encryptionStatusLabel
			: "";

	function refreshDiagnostics() {
		setError(null);
		startRefreshTransition(async () => {
			const result = await refreshPlatformDiagnosticsAction();

			if (result.success) {
				setSnapshot(result.data);
				return;
			}

			setError(result.error);
		});
	}

	function testEncryption() {
		setEncryptionError(null);
		setEncryptionResult(null);
		startEncryptionTransition(async () => {
			const result = await testPlatformKeyManagerEncryptionAction();

			if (result.success) {
				setEncryptionResult(result.data);
				return;
			}

			setEncryptionError(result.error);
		});
	}

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-2">
						<div className="flex flex-wrap items-center gap-3">
							<CardTitle>{t("admin:admin.diagnostics.title", "Deployment Diagnostics")}</CardTitle>
							<StatusBadge status={snapshot.overallStatus} label={statusLabels[snapshot.overallStatus]} />
						</div>
						<CardDescription>
							{t(
								"admin:admin.diagnostics.clientDescription",
								"Safe platform configuration and app-level service health. Last refreshed {date}.",
								{ date: snapshot.fetchedAt },
							)}
						</CardDescription>
						<p className="sr-only" role="status" aria-live="polite">
							{t(
								"admin:admin.diagnostics.statusAnnouncement",
								"Diagnostics status {status}. Last refreshed {date}.",
								{ status: statusLabels[snapshot.overallStatus], date: snapshot.fetchedAt },
							)}
						</p>
					</div>
					<Button
						onClick={refreshDiagnostics}
						disabled={isRefreshPending}
						aria-label={t("admin:admin.diagnostics.actions.refresh", "Refresh diagnostics")}
					>
						{isRefreshPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						)}
						{t("admin:admin.diagnostics.actions.refresh", "Refresh diagnostics")}
					</Button>
				</CardHeader>
				{error ? (
					<CardContent>
						<div
							className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400"
							role="alert"
							aria-live="polite"
						>
							{error}
						</div>
					</CardContent>
				) : null}
			</Card>

			<div className="grid gap-6 xl:grid-cols-2">
				<DiagnosticsSection
					title={t("admin:admin.diagnostics.sections.configuration.title", "Platform Configuration")}
					description={t(
						"admin:admin.diagnostics.sections.configuration.description",
						"Safe deployment configuration states. Secret values are never shown.",
					)}
					items={snapshot.configuration}
					statusLabels={statusLabels}
				/>
				<DiagnosticsSection
					title={t("admin:admin.diagnostics.sections.health.title", "Service Health")}
					description={t(
						"admin:admin.diagnostics.sections.health.description",
						"App-only checks for infrastructure dependencies used by the webapp.",
					)}
					items={snapshot.health}
					statusLabels={statusLabels}
				/>
			</div>

			<Card>
				<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-2">
						<CardTitle className="flex items-center gap-2">
							<IconKey className="size-5 text-primary" aria-hidden="true" />
							{t("admin:admin.diagnostics.keyManager.title", "Scaleway Key Manager Encryption")}
						</CardTitle>
						<CardDescription>
							{t(
								"admin:admin.diagnostics.keyManager.description",
								"Run an end-to-end platform key encrypt/decrypt test.",
							)}
						</CardDescription>
						<p className="sr-only" role="status" aria-live="polite">
							{encryptionLiveStatus}
						</p>
					</div>
					<Button
						onClick={testEncryption}
						disabled={isEncryptionPending}
						aria-label={t("admin:admin.diagnostics.keyManager.actions.test", "Test encryption")}
					>
						{isEncryptionPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconKey className="mr-2 size-4" aria-hidden="true" />
						)}
						{t("admin:admin.diagnostics.keyManager.actions.test", "Test encryption")}
					</Button>
				</CardHeader>
				{encryptionError ? (
					<CardContent>
						<div
							className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400"
							role="alert"
							aria-live="polite"
						>
							{encryptionError}
						</div>
					</CardContent>
				) : null}
				{encryptionResult ? (
					<CardContent className="space-y-4">
						<Badge
							variant="outline"
							className={cn(
								encryptionResult.matches
									? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
									: "border-amber-500/40 text-amber-700 dark:text-amber-400",
							)}
						>
							{encryptionStatusLabel}
						</Badge>
						<dl className="grid gap-3 text-sm sm:grid-cols-2">
							<div className="space-y-1 rounded-lg border p-3">
								<dt className="text-muted-foreground">{t("admin:admin.diagnostics.keyManager.input", "Input")}</dt>
								<dd className="break-words font-mono">{encryptionResult.input}</dd>
							</div>
							<div className="space-y-1 rounded-lg border p-3">
								<dt className="text-muted-foreground">{t("admin:admin.diagnostics.keyManager.output", "Output")}</dt>
								<dd className="break-words font-mono">{encryptionResult.output}</dd>
							</div>
							<div className="space-y-1 rounded-lg border p-3">
								<dt className="text-muted-foreground">
									{t("admin:admin.diagnostics.keyManager.platformKeyId", "Platform key ID")}
								</dt>
								<dd className="break-words font-mono">{encryptionResult.platformKeyId}</dd>
							</div>
							<div className="space-y-1 rounded-lg border p-3">
								<dt className="text-muted-foreground">{t("admin:admin.diagnostics.keyManager.keyStatus", "Key status")}</dt>
								<dd>
									{encryptionResult.keyStatus === "created"
										? t("admin:admin.diagnostics.keyManager.keyStatus.created", "Created new platform key")
										: t("admin:admin.diagnostics.keyManager.keyStatus.reused", "Reused existing platform key")}
								</dd>
							</div>
							<div className="space-y-1 rounded-lg border p-3 sm:col-span-2">
								<dt className="text-muted-foreground">
									{t("admin:admin.diagnostics.keyManager.ciphertextPreview", "Ciphertext preview")}
								</dt>
								<dd className="break-words font-mono">{encryptionResult.ciphertextPreview}</dd>
							</div>
						</dl>
					</CardContent>
				) : null}
			</Card>

			{snapshot.recommendedActions.length > 0 ? (
				<Card className="border-amber-500/30 bg-amber-500/5">
					<CardHeader>
						<CardTitle>
							{t("admin:admin.diagnostics.recommendedActions.title", "Recommended Actions")}
						</CardTitle>
						<CardDescription>
							{t(
								"admin:admin.diagnostics.recommendedActions.description",
								"Resolve these items to return diagnostics to a healthy state.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ul className="space-y-2 text-sm">
							{snapshot.recommendedActions.map((action) => (
								<li key={action} className="flex gap-2">
									<IconAlertTriangle
										className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
										aria-hidden="true"
									/>
									<span>{action}</span>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}
