"use client";

import {
	IconBrandTelegram,
	IconCheck,
	IconCopy,
	IconLoader2,
	IconPlugConnected,
	IconPlugConnectedX,
	IconUnlink,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
	disconnectTelegramBot,
	generateTelegramLinkCode,
	getTelegramConfig,
	getUserTelegramLink,
	setupTelegramBot,
	type TelegramConfig,
	type TelegramUserLink,
	unlinkTelegramAccount,
	updateTelegramSettings,
} from "@/app/[locale]/(app)/settings/telegram/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/lib/query/keys";

interface TelegramSettingsProps {
	initialConfig: TelegramConfig | null;
	initialUserLink: TelegramUserLink | null;
	organizationId: string;
	userId: string;
	isAdmin: boolean;
}

export function TelegramSettings({
	initialConfig,
	initialUserLink,
	organizationId,
	userId,
	isAdmin,
}: TelegramSettingsProps) {
	const { t } = useTranslate();

	// Fetch config (admin only)
	const { data: config } = useQuery({
		queryKey: queryKeys.telegram.config(organizationId),
		queryFn: async () => {
			const result = await getTelegramConfig(organizationId);
			return result.success ? result.data : null;
		},
		initialData: initialConfig,
		enabled: isAdmin,
	});

	// Fetch user link status
	const { data: userLink } = useQuery({
		queryKey: queryKeys.telegram.link(userId, organizationId),
		queryFn: async () => {
			const result = await getUserTelegramLink(userId, organizationId);
			return result.success ? result.data : null;
		},
		initialData: initialUserLink,
	});

	const isConnected = config?.setupStatus === "active";

	return (
		<div className="space-y-6">
			{isAdmin && (
				<>
					<BotConnectionCard config={config} organizationId={organizationId} />
					{isConnected && config && (
						<FeatureSettingsCard config={config} organizationId={organizationId} />
					)}
				</>
			)}
			{isConnected && (
				<AccountLinkingCard
					userLink={userLink}
					config={config}
					organizationId={organizationId}
					userId={userId}
				/>
			)}
			{!isAdmin && !isConnected && (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						{t(
							"settings.telegram.notConfigured",
							"Telegram is not configured for this organization. Contact your administrator.",
						)}
					</CardContent>
				</Card>
			)}
		</div>
	);
}

// ============================================
// BOT CONNECTION CARD
// ============================================

function BotConnectionCard({
	config,
	organizationId,
}: {
	config: TelegramConfig | null;
	organizationId: string;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [botToken, setBotToken] = useState("");

	const isConnected = config?.setupStatus === "active";

	const setupMutation = useMutation({
		mutationFn: () => setupTelegramBot(botToken, organizationId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.telegram.connected", "Telegram bot connected successfully"));
				setBotToken("");
				queryClient.invalidateQueries({ queryKey: queryKeys.telegram.config(organizationId) });
			} else {
				toast.error(result.error);
			}
		},
		onError: () => {
			toast.error(t("settings.telegram.connectError", "Failed to connect Telegram bot"));
		},
	});

	const disconnectMutation = useMutation({
		mutationFn: () => disconnectTelegramBot(organizationId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.telegram.disconnected", "Telegram bot disconnected"));
				queryClient.invalidateQueries({ queryKey: queryKeys.telegram.config(organizationId) });
			} else {
				toast.error(result.error);
			}
		},
		onError: () => {
			toast.error(t("settings.telegram.disconnectError", "Failed to disconnect Telegram bot"));
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconBrandTelegram className="h-5 w-5" aria-hidden="true" />
					{t("settings.telegram.bot.title", "Telegram Bot")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.telegram.bot.description",
						"Connect a Telegram bot to enable notifications and commands for your organization.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{isConnected && config ? (
					<div className="flex items-center justify-between rounded-lg border p-4">
						<div className="flex min-w-0 items-center gap-3">
							<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
								<IconBrandTelegram className="h-5 w-5 text-blue-500" aria-hidden="true" />
							</div>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="truncate font-medium">
										@{config.botUsername || config.botDisplayName}
									</span>
									<Badge className="shrink-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
										{t("settings.telegram.status.active", "Active")}
									</Badge>
								</div>
								<p className="text-sm text-muted-foreground">
									{config.webhookRegistered
										? t("settings.telegram.webhookActive", "Webhook registered")
										: t("settings.telegram.webhookPending", "Webhook pending")}
								</p>
							</div>
						</div>
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="destructive" size="sm" disabled={disconnectMutation.isPending}>
									{disconnectMutation.isPending ? (
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
									) : (
										<IconPlugConnectedX className="mr-2 h-4 w-4" aria-hidden="true" />
									)}
									{t("settings.telegram.disconnect", "Disconnect")}
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										{t("settings.telegram.disconnectConfirm.title", "Disconnect Telegram Bot?")}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{t(
											"settings.telegram.disconnectConfirm.description",
											"This will disable all Telegram notifications and commands for your organization. Employee account links will be preserved.",
										)}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
									<AlertDialogAction
										onClick={() => disconnectMutation.mutate()}
										className="bg-destructive text-white hover:bg-destructive/90"
									>
										{t("settings.telegram.disconnect", "Disconnect")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</div>
				) : (
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="botToken">{t("settings.telegram.botToken", "Bot Token")}</Label>
							<Input
								id="botToken"
								type="password"
								value={botToken}
								onChange={(e) => setBotToken(e.target.value)}
								placeholder="123456:ABC-DEF\u2026"
								disabled={setupMutation.isPending}
								autoComplete="off"
								spellCheck={false}
							/>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.telegram.botTokenHelp",
									"Create a bot with @BotFather on Telegram and paste the token here.",
								)}
							</p>
						</div>
						<Button
							onClick={() => setupMutation.mutate()}
							disabled={!botToken.trim() || setupMutation.isPending}
						>
							{setupMutation.isPending ? (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
							) : (
								<IconPlugConnected className="mr-2 h-4 w-4" aria-hidden="true" />
							)}
							{t("settings.telegram.connect", "Connect Bot")}
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

// ============================================
// FEATURE SETTINGS CARD
// ============================================

function FeatureSettingsCard({
	config,
	organizationId,
}: {
	config: TelegramConfig;
	organizationId: string;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		defaultValues: {
			enableApprovals: config.enableApprovals,
			enableCommands: config.enableCommands,
			enableDailyDigest: config.enableDailyDigest,
			enableEscalations: config.enableEscalations,
			digestTime: config.digestTime,
			digestTimezone: config.digestTimezone,
			escalationTimeoutHours: config.escalationTimeoutHours,
		},
		onSubmit: async ({ value }) => {
			setLoading(true);
			const result = await updateTelegramSettings(organizationId, value);
			setLoading(false);

			if (result.success) {
				toast.success(t("settings.telegram.saved", "Telegram settings saved"));
				queryClient.invalidateQueries({ queryKey: queryKeys.telegram.config(organizationId) });
			} else {
				toast.error(result.error);
			}
		},
	});

	const isDirty = useStore(form.store, (state) => state.isDirty);

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.telegram.features.title", "Features")}</CardTitle>
				<CardDescription>
					{t(
						"settings.telegram.features.description",
						"Configure which features are enabled for the Telegram bot.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					{/* Approvals */}
					<div className="flex items-center justify-between">
						<div>
							<Label id="approvals-label" className="text-sm font-medium">
								{t("settings.telegram.features.approvals", "Approval Notifications")}
							</Label>
							<p id="approvals-desc" className="text-sm text-muted-foreground">
								{t(
									"settings.telegram.features.approvalsDesc",
									"Send approval requests and allow approve/reject via Telegram",
								)}
							</p>
						</div>
						<form.Field name="enableApprovals">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading}
									aria-labelledby="approvals-label"
									aria-describedby="approvals-desc"
								/>
							)}
						</form.Field>
					</div>

					<div className="h-px bg-border" />

					{/* Commands */}
					<div className="flex items-center justify-between">
						<div>
							<Label id="commands-label" className="text-sm font-medium">
								{t("settings.telegram.features.commands", "Bot Commands")}
							</Label>
							<p id="commands-desc" className="text-sm text-muted-foreground">
								{t(
									"settings.telegram.features.commandsDesc",
									"Enable /clockedin, /whosout, /pending and other commands",
								)}
							</p>
						</div>
						<form.Field name="enableCommands">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading}
									aria-labelledby="commands-label"
									aria-describedby="commands-desc"
								/>
							)}
						</form.Field>
					</div>

					<div className="h-px bg-border" />

					{/* Daily Digest */}
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<div>
								<Label id="digest-label" className="text-sm font-medium">
									{t("settings.telegram.features.digest", "Daily Digest")}
								</Label>
								<p id="digest-desc" className="text-sm text-muted-foreground">
									{t(
										"settings.telegram.features.digestDesc",
										"Send a daily summary of absences and schedules",
									)}
								</p>
							</div>
							<form.Field name="enableDailyDigest">
								{(field) => (
									<Switch
										checked={field.state.value}
										onCheckedChange={field.handleChange}
										disabled={loading}
										aria-labelledby="digest-label"
										aria-describedby="digest-desc"
									/>
								)}
							</form.Field>
						</div>

						<form.Subscribe selector={(state) => state.values.enableDailyDigest}>
							{(digestEnabled) =>
								digestEnabled && (
									<div className="ml-0 grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3">
										<form.Field name="digestTime">
											{(field) => (
												<div className="space-y-1">
													<Label htmlFor="digestTime" className="text-xs">
														{t("settings.telegram.features.digestTime", "Time")}
													</Label>
													<Input
														id="digestTime"
														type="time"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														disabled={loading}
														className="h-8"
													/>
												</div>
											)}
										</form.Field>
										<form.Field name="digestTimezone">
											{(field) => (
												<div className="space-y-1">
													<Label htmlFor="digestTimezone" className="text-xs">
														{t("settings.telegram.features.digestTimezone", "Timezone")}
													</Label>
													<Input
														id="digestTimezone"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														disabled={loading}
														placeholder="Europe/Berlin\u2026"
														className="h-8"
													/>
												</div>
											)}
										</form.Field>
									</div>
								)
							}
						</form.Subscribe>
					</div>

					<div className="h-px bg-border" />

					{/* Escalations */}
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<div>
								<Label id="escalations-label" className="text-sm font-medium">
									{t("settings.telegram.features.escalations", "Escalations")}
								</Label>
								<p id="escalations-desc" className="text-sm text-muted-foreground">
									{t(
										"settings.telegram.features.escalationsDesc",
										"Escalate unanswered approvals to the next manager",
									)}
								</p>
							</div>
							<form.Field name="enableEscalations">
								{(field) => (
									<Switch
										checked={field.state.value}
										onCheckedChange={field.handleChange}
										disabled={loading}
										aria-labelledby="escalations-label"
										aria-describedby="escalations-desc"
									/>
								)}
							</form.Field>
						</div>

						<form.Subscribe selector={(state) => state.values.enableEscalations}>
							{(escalationsEnabled) =>
								escalationsEnabled && (
									<div className="rounded-lg border bg-muted/30 p-3">
										<form.Field name="escalationTimeoutHours">
											{(field) => (
												<div className="flex items-center gap-3">
													<Label htmlFor="escalationTimeout" className="shrink-0 text-xs">
														{t("settings.telegram.features.escalationTimeout", "Timeout")}
													</Label>
													<Input
														id="escalationTimeout"
														type="number"
														min={1}
														max={168}
														value={field.state.value}
														onChange={(e) => field.handleChange(Number(e.target.value))}
														disabled={loading}
														className="h-8 w-20"
													/>
													<span className="text-xs text-muted-foreground">
														{t("settings.telegram.features.hours", "hours")}
													</span>
												</div>
											)}
										</form.Field>
									</div>
								)
							}
						</form.Subscribe>
					</div>

					{/* Save Button */}
					<div className="flex justify-end pt-2">
						<Button type="submit" disabled={loading || !isDirty}>
							{loading && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
							{t("common.saveChanges", "Save Changes")}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

// ============================================
// ACCOUNT LINKING CARD
// ============================================

function AccountLinkingCard({
	userLink,
	config,
	organizationId,
	userId,
}: {
	userLink: TelegramUserLink | null;
	config: TelegramConfig | null;
	organizationId: string;
	userId: string;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [linkCode, setLinkCode] = useState<{ code: string; expiresAt: string } | null>(null);
	const [copied, setCopied] = useState(false);

	const generateCodeMutation = useMutation({
		mutationFn: () => generateTelegramLinkCode(userId, organizationId),
		onSuccess: (result) => {
			if (result.success) {
				setLinkCode(result.data);
			} else {
				toast.error(result.error);
			}
		},
		onError: () => {
			toast.error(t("settings.telegram.linkError", "Failed to generate link code"));
		},
	});

	const unlinkMutation = useMutation({
		mutationFn: () => unlinkTelegramAccount(userId, organizationId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.telegram.unlinked", "Telegram account unlinked"));
				setLinkCode(null);
				queryClient.invalidateQueries({
					queryKey: queryKeys.telegram.link(userId, organizationId),
				});
			} else {
				toast.error(result.error);
			}
		},
		onError: () => {
			toast.error(t("settings.telegram.unlinkError", "Failed to unlink Telegram account"));
		},
	});

	const handleCopy = useCallback(async () => {
		if (!linkCode) return;
		await navigator.clipboard.writeText(linkCode.code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [linkCode]);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconBrandTelegram className="h-5 w-5" aria-hidden="true" />
					{t("settings.telegram.linking.title", "Telegram Account")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.telegram.linking.description",
						"Link your Telegram account to receive personal notifications.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{userLink ? (
					<div className="flex items-center justify-between rounded-lg border p-4">
						<div className="flex min-w-0 items-center gap-3">
							<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
								<IconBrandTelegram className="h-5 w-5 text-blue-500" aria-hidden="true" />
							</div>
							<div className="min-w-0">
								<span className="block truncate font-medium">
									{userLink.telegramUsername
										? `@${userLink.telegramUsername}`
										: userLink.telegramDisplayName || t("settings.telegram.linked", "Linked")}
								</span>
								<p className="text-sm text-muted-foreground">
									{t("settings.telegram.linking.linkedStatus", "Your Telegram account is linked")}
								</p>
							</div>
						</div>
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="outline" size="sm" disabled={unlinkMutation.isPending}>
									{unlinkMutation.isPending ? (
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
									) : (
										<IconUnlink className="mr-2 h-4 w-4" aria-hidden="true" />
									)}
									{t("settings.telegram.unlink", "Unlink")}
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										{t("settings.telegram.unlinkConfirm.title", "Unlink Telegram Account?")}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{t(
											"settings.telegram.unlinkConfirm.description",
											"You will stop receiving Telegram notifications. You can link again later.",
										)}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
									<AlertDialogAction onClick={() => unlinkMutation.mutate()}>
										{t("settings.telegram.unlink", "Unlink")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</div>
				) : (
					<div className="space-y-4">
						{linkCode ? (
							<div className="space-y-3">
								<div className="flex items-center gap-2">
									<div className="flex-1 rounded-lg border bg-muted/50 px-4 py-3 text-center font-mono text-2xl tracking-widest">
										{linkCode.code}
									</div>
									<Button
										variant="outline"
										size="icon"
										onClick={handleCopy}
										aria-label={t("common.copy", "Copy")}
									>
										{copied ? (
											<IconCheck className="h-4 w-4 text-emerald-500" />
										) : (
											<IconCopy className="h-4 w-4" />
										)}
									</Button>
								</div>
								<div className="space-y-1 text-sm text-muted-foreground">
									<p>
										{t(
											"settings.telegram.linking.instructions",
											"Send this command to the bot on Telegram:",
										)}
									</p>
									<code className="block rounded bg-muted px-2 py-1 font-mono text-xs">
										/link {linkCode.code}
									</code>
									{config?.botUsername && (
										<p>
											{t("settings.telegram.linking.botLink", "Bot: @{botUsername}", {
												botUsername: config.botUsername,
											})}
										</p>
									)}
								</div>
							</div>
						) : (
							<Button
								onClick={() => generateCodeMutation.mutate()}
								disabled={generateCodeMutation.isPending}
								variant="outline"
							>
								{generateCodeMutation.isPending ? (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
								) : (
									<IconBrandTelegram className="mr-2 h-4 w-4" aria-hidden="true" />
								)}
								{t("settings.telegram.linking.generateCode", "Generate Link Code")}
							</Button>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
