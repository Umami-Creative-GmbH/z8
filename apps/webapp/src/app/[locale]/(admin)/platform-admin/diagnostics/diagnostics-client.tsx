"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconKey,
	IconLoader2,
	IconRefresh,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useReducer, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
	DiagnosticsItem,
	DiagnosticsStatus,
	PlatformDiagnosticsSnapshot,
} from "@/lib/platform-diagnostics";
import { cn } from "@/lib/utils";
import type { PlatformKeyManagerEncryptionResult } from "@/lib/vault/platform-key-manager";
import { Link } from "@/navigation";
import {
	refreshPlatformDiagnosticsAction,
	sendPlatformDiagnosticsTestEmailAction,
	testPlatformKeyManagerEncryptionAction,
} from "./actions";

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

function StatusBadge({
	status,
	label,
	showLabel = true,
}: {
	status: DiagnosticsStatus;
	label: string;
	showLabel?: boolean;
}) {
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
				{item.description ? (
					<p className="break-words text-sm text-muted-foreground">{item.description}</p>
				) : null}
				{item.actionHref && item.actionLabel ? (
					<Link href={item.actionHref} className="text-sm font-medium text-primary hover:underline">
						{item.actionLabel}
					</Link>
				) : null}
			</div>
			<div className="break-words font-mono text-sm text-muted-foreground sm:text-right">
				{item.value}
			</div>
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
					<DiagnosticsItemRow
						key={item.title}
						item={item}
						statusLabel={statusLabels[item.status]}
					/>
				))}
			</CardContent>
		</Card>
	);
}

type DiagnosticsTranslate = ReturnType<typeof useTranslate>["t"];

type SmtpOverrideState = {
	host: string;
	port: string;
	username: string;
	password: string;
	fromEmail: string;
	fromName: string;
	secure: boolean;
	requireTls: boolean;
	ipMode: "auto" | "ipv4" | "ipv6";
};

const initialSmtpOverride: SmtpOverrideState = {
	host: "",
	port: "587",
	username: "",
	password: "",
	fromEmail: "",
	fromName: "",
	secure: true,
	requireTls: true,
	ipMode: "auto",
};

type DiagnosticsClientState = {
	snapshot: PlatformDiagnosticsSnapshot;
	error: string | null;
	emailRecipient: string;
	smtpOverride: SmtpOverrideState;
	emailResult: { recipient: string; messageId?: string } | null;
	emailError: string | null;
	encryptionResult: PlatformKeyManagerEncryptionResult | null;
	encryptionError: string | null;
};

type DiagnosticsClientAction =
	| { type: "refreshStarted" }
	| { type: "refreshSucceeded"; snapshot: PlatformDiagnosticsSnapshot }
	| { type: "refreshFailed"; error: string }
	| { type: "emailRecipientChanged"; recipient: string }
	| { type: "smtpOverrideChanged"; update: (current: SmtpOverrideState) => SmtpOverrideState }
	| { type: "emailStarted" }
	| { type: "emailSucceeded"; result: { recipient: string; messageId?: string } }
	| { type: "emailFailed"; error: string }
	| { type: "encryptionStarted" }
	| { type: "encryptionSucceeded"; result: PlatformKeyManagerEncryptionResult }
	| { type: "encryptionFailed"; error: string };

function diagnosticsClientReducer(
	state: DiagnosticsClientState,
	action: DiagnosticsClientAction,
): DiagnosticsClientState {
	switch (action.type) {
		case "refreshStarted":
			return { ...state, error: null };
		case "refreshSucceeded":
			return { ...state, snapshot: action.snapshot };
		case "refreshFailed":
			return { ...state, error: action.error };
		case "emailRecipientChanged":
			return { ...state, emailRecipient: action.recipient };
		case "smtpOverrideChanged":
			return { ...state, smtpOverride: action.update(state.smtpOverride) };
		case "emailStarted":
			return { ...state, emailError: null, emailResult: null };
		case "emailSucceeded":
			return { ...state, emailResult: action.result };
		case "emailFailed":
			return { ...state, emailError: action.error };
		case "encryptionStarted":
			return { ...state, encryptionError: null, encryptionResult: null };
		case "encryptionSucceeded":
			return { ...state, encryptionResult: action.result };
		case "encryptionFailed":
			return { ...state, encryptionError: action.error };
	}
}

function DiagnosticsOverviewCard({
	snapshot,
	statusLabels,
	isRefreshPending,
	error,
	onRefresh,
	t,
}: {
	snapshot: PlatformDiagnosticsSnapshot;
	statusLabels: Record<DiagnosticsStatus, string>;
	isRefreshPending: boolean;
	error: string | null;
	onRefresh: () => void;
	t: DiagnosticsTranslate;
}) {
	return (
		<Card>
			<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-3">
						<CardTitle>{t("admin:admin.diagnostics.title", "Deployment Diagnostics")}</CardTitle>
						<StatusBadge
							status={snapshot.overallStatus}
							label={statusLabels[snapshot.overallStatus]}
						/>
					</div>
					<CardDescription>
						{t(
							"admin:admin.diagnostics.clientDescription",
							"Safe platform configuration and app-level service health. Last refreshed {date}.",
							{ date: snapshot.fetchedAt },
						)}
					</CardDescription>
					<output className="sr-only" aria-live="polite">
						{t(
							"admin:admin.diagnostics.statusAnnouncement",
							"Diagnostics status {status}. Last refreshed {date}.",
							{ status: statusLabels[snapshot.overallStatus], date: snapshot.fetchedAt },
						)}
					</output>
				</div>
				<Button
					onClick={onRefresh}
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
	);
}

function EmailTestCard({
	emailRecipient,
	emailError,
	emailResult,
	smtpOverride,
	isEmailPending,
	onRecipientChange,
	onSmtpOverrideChange,
	onSend,
	t,
}: {
	emailRecipient: string;
	emailError: string | null;
	emailResult: { recipient: string; messageId?: string } | null;
	smtpOverride: SmtpOverrideState;
	isEmailPending: boolean;
	onRecipientChange: (value: string) => void;
	onSmtpOverrideChange: (update: (current: SmtpOverrideState) => SmtpOverrideState) => void;
	onSend: () => void;
	t: DiagnosticsTranslate;
}) {
	return (
		<Card>
			<CardHeader className="space-y-2">
				<CardTitle>{t("admin:admin.diagnostics.emailTest.title", "Email Delivery Test")}</CardTitle>
				<CardDescription>
					{t(
						"admin:admin.diagnostics.emailTest.description",
						"Send a diagnostics email through the system email transport.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
					<label className="space-y-2 text-sm font-medium">
						<span>{t("admin:admin.diagnostics.emailTest.recipient", "Recipient email")}</span>
						<input
							className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							type="email"
							value={emailRecipient}
							onChange={(event) => onRecipientChange(event.target.value)}
							disabled={isEmailPending}
						/>
					</label>
					<Button onClick={onSend} disabled={isEmailPending || emailRecipient.trim().length === 0}>
						{isEmailPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : null}
						{t("admin:admin.diagnostics.emailTest.actions.send", "Send test email")}
					</Button>
				</div>
				<div className="space-y-4 rounded-lg border bg-muted/20 p-4">
					<div className="space-y-1">
						<h3 className="text-sm font-medium">
							{t("admin:admin.diagnostics.emailTest.smtpOverride.title", "Temporary SMTP override")}
						</h3>
						<p className="text-sm text-muted-foreground">
							{t(
								"admin:admin.diagnostics.emailTest.smtpOverride.description",
								"Leave blank to use the configured system email transport. If filled, the test uses these SMTP settings only.",
							)}
						</p>
					</div>
					<div className="grid gap-3 md:grid-cols-2">
						<label className="space-y-2 text-sm font-medium">
							<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.host", "SMTP host")}</span>
							<input
								className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								name="smtp-host"
								autoComplete="off"
								spellCheck={false}
								value={smtpOverride.host}
								onChange={(event) =>
									onSmtpOverrideChange((current) => ({ ...current, host: event.target.value }))
								}
								disabled={isEmailPending}
							/>
						</label>
						<label className="space-y-2 text-sm font-medium">
							<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.port", "SMTP port")}</span>
							<input
								className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								name="smtp-port"
								autoComplete="off"
								type="number"
								value={smtpOverride.port}
								onChange={(event) =>
									onSmtpOverrideChange((current) => ({ ...current, port: event.target.value }))
								}
								disabled={isEmailPending}
							/>
						</label>
						<label className="space-y-2 text-sm font-medium">
							<span>
								{t("admin:admin.diagnostics.emailTest.smtpOverride.username", "SMTP username")}
							</span>
							<input
								className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								name="smtp-username"
								autoComplete="off"
								spellCheck={false}
								value={smtpOverride.username}
								onChange={(event) =>
									onSmtpOverrideChange((current) => ({ ...current, username: event.target.value }))
								}
								disabled={isEmailPending}
							/>
						</label>
						<label className="space-y-2 text-sm font-medium">
							<span>
								{t("admin:admin.diagnostics.emailTest.smtpOverride.password", "SMTP password")}
							</span>
							<input
								className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								name="smtp-password"
								autoComplete="off"
								type="password"
								value={smtpOverride.password}
								onChange={(event) =>
									onSmtpOverrideChange((current) => ({ ...current, password: event.target.value }))
								}
								disabled={isEmailPending}
							/>
						</label>
						<label className="space-y-2 text-sm font-medium">
							<span>
								{t("admin:admin.diagnostics.emailTest.smtpOverride.fromEmail", "From email")}
							</span>
							<input
								className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								name="smtp-from-email"
								autoComplete="off"
								spellCheck={false}
								type="email"
								value={smtpOverride.fromEmail}
								onChange={(event) =>
									onSmtpOverrideChange((current) => ({ ...current, fromEmail: event.target.value }))
								}
								disabled={isEmailPending}
							/>
						</label>
						<label className="space-y-2 text-sm font-medium">
							<span>
								{t("admin:admin.diagnostics.emailTest.smtpOverride.fromName", "From name")}
							</span>
							<input
								className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								name="smtp-from-name"
								autoComplete="off"
								value={smtpOverride.fromName}
								onChange={(event) =>
									onSmtpOverrideChange((current) => ({ ...current, fromName: event.target.value }))
								}
								disabled={isEmailPending}
							/>
						</label>
						<label className="space-y-2 text-sm font-medium">
							<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.ipMode", "IP mode")}</span>
							<select
								className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								name="smtp-ip-mode"
								value={smtpOverride.ipMode}
								onChange={(event) =>
									onSmtpOverrideChange((current) => ({
										...current,
										ipMode: event.target.value as "auto" | "ipv4" | "ipv6",
									}))
								}
								disabled={isEmailPending}
							>
								<option value="auto">
									{t("admin:admin.diagnostics.emailTest.smtpOverride.ipMode.auto", "Auto")}
								</option>
								<option value="ipv4">
									{t("admin:admin.diagnostics.emailTest.smtpOverride.ipMode.ipv4", "IPv4 only")}
								</option>
								<option value="ipv6">
									{t("admin:admin.diagnostics.emailTest.smtpOverride.ipMode.ipv6", "IPv6 only")}
								</option>
							</select>
						</label>
					</div>
					<div className="flex flex-wrap gap-4">
						<label className="flex items-center gap-2 text-sm font-medium">
							<input
								type="checkbox"
								name="smtp-secure"
								checked={smtpOverride.secure}
								onChange={(event) =>
									onSmtpOverrideChange((current) => ({ ...current, secure: event.target.checked }))
								}
								disabled={isEmailPending}
							/>
							<span>{t("admin:admin.diagnostics.emailTest.smtpOverride.secure", "Use TLS")}</span>
						</label>
						<label className="flex items-center gap-2 text-sm font-medium">
							<input
								type="checkbox"
								name="smtp-require-tls"
								checked={smtpOverride.requireTls}
								onChange={(event) =>
									onSmtpOverrideChange((current) => ({
										...current,
										requireTls: event.target.checked,
									}))
								}
								disabled={isEmailPending}
							/>
							<span>
								{t("admin:admin.diagnostics.emailTest.smtpOverride.requireTls", "Require STARTTLS")}
							</span>
						</label>
					</div>
				</div>
				{emailError ? (
					<div
						className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400"
						role="alert"
						aria-live="polite"
					>
						{emailError}
					</div>
				) : null}
				{emailResult ? (
					<output
						className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400"
						aria-live="polite"
					>
						<span className="block">
							{t("admin:admin.diagnostics.emailTest.success", "Test email sent to {recipient}.", {
								recipient: emailResult.recipient,
							})}
						</span>
						{emailResult.messageId ? (
							<span className="block font-mono">
								{t("admin:admin.diagnostics.emailTest.messageId", "Message ID: {messageId}", {
									messageId: emailResult.messageId,
								})}
							</span>
						) : null}
					</output>
				) : null}
			</CardContent>
		</Card>
	);
}

function KeyManagerEncryptionCard({
	encryptionResult,
	encryptionError,
	encryptionStatusLabel,
	encryptionLiveStatus,
	isEncryptionPending,
	onTestEncryption,
	t,
}: {
	encryptionResult: PlatformKeyManagerEncryptionResult | null;
	encryptionError: string | null;
	encryptionStatusLabel: string;
	encryptionLiveStatus: string;
	isEncryptionPending: boolean;
	onTestEncryption: () => void;
	t: DiagnosticsTranslate;
}) {
	return (
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
					<output className="sr-only" aria-live="polite">
						{encryptionLiveStatus}
					</output>
				</div>
				<Button
					onClick={onTestEncryption}
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
							<dt className="text-muted-foreground">
								{t("admin:admin.diagnostics.keyManager.input", "Input")}
							</dt>
							<dd className="break-words font-mono">{encryptionResult.input}</dd>
						</div>
						<div className="space-y-1 rounded-lg border p-3">
							<dt className="text-muted-foreground">
								{t("admin:admin.diagnostics.keyManager.output", "Output")}
							</dt>
							<dd className="break-words font-mono">{encryptionResult.output}</dd>
						</div>
						<div className="space-y-1 rounded-lg border p-3">
							<dt className="text-muted-foreground">
								{t("admin:admin.diagnostics.keyManager.platformKeyId", "Platform key ID")}
							</dt>
							<dd className="break-words font-mono">{encryptionResult.platformKeyId}</dd>
						</div>
						<div className="space-y-1 rounded-lg border p-3">
							<dt className="text-muted-foreground">
								{t("admin:admin.diagnostics.keyManager.keyStatus", "Key status")}
							</dt>
							<dd>
								{encryptionResult.keyStatus === "created"
									? t(
											"admin:admin.diagnostics.keyManager.keyStatus.created",
											"Created new platform key",
										)
									: t(
											"admin:admin.diagnostics.keyManager.keyStatus.reused",
											"Reused existing platform key",
										)}
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
	);
}

function RecommendedActionsCard({ actions, t }: { actions: string[]; t: DiagnosticsTranslate }) {
	return (
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
					{actions.map((action) => (
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
	);
}

export function DiagnosticsClient({
	initialSnapshot,
	adminEmail,
}: {
	initialSnapshot: PlatformDiagnosticsSnapshot;
	adminEmail: string;
}) {
	const { t } = useTranslate();
	const [state, dispatch] = useReducer(diagnosticsClientReducer, {
		snapshot: initialSnapshot,
		error: null,
		emailRecipient: adminEmail,
		smtpOverride: initialSmtpOverride,
		emailResult: null,
		emailError: null,
		encryptionResult: null,
		encryptionError: null,
	});
	const [isRefreshPending, startRefreshTransition] = useTransition();
	const [isEmailPending, startEmailTransition] = useTransition();
	const [isEncryptionPending, startEncryptionTransition] = useTransition();
	const statusLabels: Record<DiagnosticsStatus, string> = {
		healthy: t("admin:admin.diagnostics.status.healthy", "Healthy"),
		warning: t("admin:admin.diagnostics.status.warning", "Warning"),
		error: t("admin:admin.diagnostics.status.error", "Error"),
		disabled: t("admin:admin.diagnostics.status.disabled", "Disabled"),
	};
	const encryptionStatusLabel = state.encryptionResult?.matches
		? t("admin:admin.diagnostics.keyManager.result.match", "Input and output match")
		: t("admin:admin.diagnostics.keyManager.result.mismatch", "Input and output differ");
	const encryptionLiveStatus = isEncryptionPending
		? t("admin:admin.diagnostics.keyManager.status.pending", "Encryption test is running.")
		: state.encryptionResult
			? encryptionStatusLabel
			: "";

	function refreshDiagnostics() {
		dispatch({ type: "refreshStarted" });
		startRefreshTransition(async () => {
			const result = await refreshPlatformDiagnosticsAction();

			if (result.success) {
				dispatch({ type: "refreshSucceeded", snapshot: result.data });
				return;
			}

			dispatch({ type: "refreshFailed", error: result.error });
		});
	}

	function testEncryption() {
		dispatch({ type: "encryptionStarted" });
		startEncryptionTransition(async () => {
			const result = await testPlatformKeyManagerEncryptionAction();

			if (result.success) {
				dispatch({ type: "encryptionSucceeded", result: result.data });
				return;
			}

			dispatch({ type: "encryptionFailed", error: result.error });
		});
	}

	function buildSmtpOverrideInput() {
		const hasTextOverride =
			state.smtpOverride.host.trim().length > 0 ||
			state.smtpOverride.username.trim().length > 0 ||
			state.smtpOverride.password.length > 0 ||
			state.smtpOverride.fromEmail.trim().length > 0 ||
			state.smtpOverride.fromName.trim().length > 0;
		const hasControlOverride =
			state.smtpOverride.port !== "587" ||
			!state.smtpOverride.secure ||
			!state.smtpOverride.requireTls ||
			state.smtpOverride.ipMode !== "auto";

		if (!hasTextOverride && !hasControlOverride) {
			return undefined;
		}

		const input = {
			host: state.smtpOverride.host.trim(),
			port: Number.parseInt(state.smtpOverride.port, 10),
			username: state.smtpOverride.username.trim(),
			password: state.smtpOverride.password,
			fromEmail: state.smtpOverride.fromEmail.trim(),
			secure: state.smtpOverride.secure,
			requireTls: state.smtpOverride.requireTls,
			ipMode: state.smtpOverride.ipMode,
		};

		if (state.smtpOverride.fromName.trim().length > 0) {
			return { ...input, fromName: state.smtpOverride.fromName.trim() };
		}

		return input;
	}

	function sendTestEmail() {
		dispatch({ type: "emailStarted" });
		startEmailTransition(async () => {
			const result = await sendPlatformDiagnosticsTestEmailAction({
				to: state.emailRecipient,
				smtpOverride: buildSmtpOverrideInput(),
			});

			if (result.success) {
				dispatch({ type: "emailSucceeded", result: result.data });
				return;
			}

			dispatch({ type: "emailFailed", error: result.error });
		});
	}

	return (
		<div className="space-y-6">
			<DiagnosticsOverviewCard
				snapshot={state.snapshot}
				statusLabels={statusLabels}
				isRefreshPending={isRefreshPending}
				error={state.error}
				onRefresh={refreshDiagnostics}
				t={t}
			/>

			<div className="grid gap-6 xl:grid-cols-2">
				<DiagnosticsSection
					title={t(
						"admin:admin.diagnostics.sections.configuration.title",
						"Platform Configuration",
					)}
					description={t(
						"admin:admin.diagnostics.sections.configuration.description",
						"Safe deployment configuration states. Secret values are never shown.",
					)}
					items={state.snapshot.configuration}
					statusLabels={statusLabels}
				/>
				<DiagnosticsSection
					title={t("admin:admin.diagnostics.sections.health.title", "Service Health")}
					description={t(
						"admin:admin.diagnostics.sections.health.description",
						"App-only checks for infrastructure dependencies used by the webapp.",
					)}
					items={state.snapshot.health}
					statusLabels={statusLabels}
				/>
			</div>

			<EmailTestCard
				emailRecipient={state.emailRecipient}
				emailError={state.emailError}
				emailResult={state.emailResult}
				smtpOverride={state.smtpOverride}
				isEmailPending={isEmailPending}
				onRecipientChange={(recipient) => dispatch({ type: "emailRecipientChanged", recipient })}
				onSmtpOverrideChange={(update) => dispatch({ type: "smtpOverrideChanged", update })}
				onSend={sendTestEmail}
				t={t}
			/>

			{state.snapshot.secretStoreProvider === "scaleway" ? (
				<KeyManagerEncryptionCard
					encryptionResult={state.encryptionResult}
					encryptionError={state.encryptionError}
					encryptionStatusLabel={encryptionStatusLabel}
					encryptionLiveStatus={encryptionLiveStatus}
					isEncryptionPending={isEncryptionPending}
					onTestEncryption={testEncryption}
					t={t}
				/>
			) : null}

			{state.snapshot.recommendedActions.length > 0 ? (
				<RecommendedActionsCard actions={state.snapshot.recommendedActions} t={t} />
			) : null}
		</div>
	);
}
