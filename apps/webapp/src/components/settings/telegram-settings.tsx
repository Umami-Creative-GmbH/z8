"use client";

import {
	IconBrandTelegram,
	IconCheck,
	IconClock,
	IconCopy,
	IconLoader2,
	IconPlugConnected,
	IconPlugConnectedX,
	IconRefresh,
	IconUnlink,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
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
	ConfirmActionDialog,
	describeFailure,
	useConfirmedAction,
} from "@/components/settings/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimeInput } from "@/components/ui/time-input";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
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
			const result = await getTelegramConfig();
			return result.success ? result.data : null;
		},
		initialData: initialConfig,
		enabled: isAdmin,
	});

	// Fetch user link status
	const { data: userLink } = useQuery({
		queryKey: queryKeys.telegram.link(userId, organizationId),
		queryFn: async () => {
			const result = await getUserTelegramLink();
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
		mutationFn: () => setupTelegramBot({ botToken }),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.telegram.connected", "Telegram bot connected successfully"));
				setBotToken("");
				queryClient.invalidateQueries({ queryKey: queryKeys.telegram.config(organizationId) });
			} else {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.telegram.connectError",
						"Failed to connect Telegram bot",
					]),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.telegram.connectError", "Failed to connect Telegram bot"));
		},
	});

	const disconnectMutation = useMutation({
		mutationFn: async () => {
			const result = await disconnectTelegramBot();
			if (!result.success) {
				throw new Error(
					actionErrorMessage(t, result, {}, [
						"settings.telegram.disconnectError",
						"Failed to disconnect Telegram bot",
					]),
				);
			}
		},
		onSuccess: () => {
			toast.success(t("settings.telegram.disconnected", "Telegram bot disconnected"));
			queryClient.invalidateQueries({ queryKey: queryKeys.telegram.config(organizationId) });
		},
		// A failure is shown inside the confirmation dialog, which stays open for a retry.
	});
	const disconnection = useConfirmedAction<"bot">();

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconBrandTelegram className="size-5" aria-hidden="true" />
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
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
						<div className="flex min-w-0 items-center gap-3">
							<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
								<IconBrandTelegram className="size-5 text-primary" aria-hidden="true" />
							</div>
							<div className="min-w-0">
								<div className="flex min-w-0 items-center gap-2">
									<span
										className="truncate font-medium"
										title={`@${config.botUsername || config.botDisplayName}`}
									>
										@{config.botUsername || config.botDisplayName}
									</span>
									<Badge className="shrink-0">
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
						<Button
							variant="destructive"
							size="sm"
							disabled={disconnection.isPending}
							onClick={() => disconnection.request("bot")}
						>
							{disconnection.isPending ? (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconPlugConnectedX className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("settings.telegram.disconnect", "Disconnect")}
						</Button>
						<ConfirmActionDialog
							open={disconnection.open}
							onOpenChange={disconnection.onOpenChange}
							title={t("settings.telegram.disconnectConfirm.title", "Disconnect Telegram Bot?")}
							description={
								<>
									<span className="mb-2 block font-medium text-foreground break-words">
										@{config.botUsername || config.botDisplayName}
									</span>
									{t(
										"settings.telegram.disconnectConfirm.description",
										"This will disable all Telegram notifications and commands for your organization. Employee account links will be preserved.",
									)}
								</>
							}
							confirmLabel={t("settings.telegram.disconnect", "Disconnect")}
							isPending={disconnection.isPending}
							error={disconnection.error}
							onConfirm={() =>
								void disconnection.confirm(
									() => disconnectMutation.mutateAsync(),
									(failure) =>
										describeFailure(
											failure,
											t("settings.telegram.disconnectError", "Failed to disconnect Telegram bot"),
										),
								)
							}
						/>
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
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconPlugConnected className="mr-2 size-4" aria-hidden="true" />
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
			const result = await updateTelegramSettings(value).catch(() => null);
			if (!result) {
				toast.error(t("settings.telegram.saveError", "Telegram settings could not be saved. Try again."));
				return;
			}
			if (result.success) {
				toast.success(t("settings.telegram.saved", "Telegram settings saved"));
				queryClient.invalidateQueries({ queryKey: queryKeys.telegram.config(organizationId) });
			} else {
				toast.error(actionErrorMessage(t, result));
			}
		},
	});

	const isDirty = useStore(form.store, (state) => state.isDirty);
	// The form clears `isSubmitting` when `onSubmit` settles, a thrown action included.
	const loading = useStore(form.store, (state) => state.isSubmitting);

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
					<div className="flex min-w-0 items-center justify-between gap-4">
						<div className="min-w-0 space-y-1">
							<Label
								id="approvals-label"
								htmlFor="telegram-enable-approvals"
								className="text-sm font-medium"
							>
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
									id="telegram-enable-approvals"
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading}
									aria-labelledby="approvals-label"
									aria-describedby="approvals-desc"
									className="shrink-0"
								/>
							)}
						</form.Field>
					</div>

					<div className="h-px bg-border" />

					{/* Commands */}
					<div className="flex min-w-0 items-center justify-between gap-4">
						<div className="min-w-0 space-y-1">
							<Label
								id="commands-label"
								htmlFor="telegram-enable-commands"
								className="text-sm font-medium"
							>
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
									id="telegram-enable-commands"
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading}
									aria-labelledby="commands-label"
									aria-describedby="commands-desc"
									className="shrink-0"
								/>
							)}
						</form.Field>
					</div>

					<div className="h-px bg-border" />

					{/* Daily Digest */}
					<div className="space-y-3">
						<div className="flex min-w-0 items-center justify-between gap-4">
							<div className="min-w-0 space-y-1">
								<Label
									id="digest-label"
									htmlFor="telegram-enable-digest"
									className="text-sm font-medium"
								>
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
										id="telegram-enable-digest"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
										disabled={loading}
										aria-labelledby="digest-label"
										aria-describedby="digest-desc"
										className="shrink-0"
									/>
								)}
							</form.Field>
						</div>

						<form.Subscribe<boolean> selector={(state) => state.values.enableDailyDigest}>
							{(digestEnabled: typeof form.state.values.enableDailyDigest) =>
								digestEnabled && (
									<div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
										<form.Field name="digestTime">
											{(field) => (
												<div className="space-y-1">
													<Label htmlFor="digestTime" className="text-xs">
														{t("settings.telegram.features.digestTime", "Time")}
													</Label>
													<TimeInput
														id="digestTime"
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
													<TimezonePicker
														id="digestTimezone"
														value={field.state.value}
														onChange={field.handleChange}
														disabled={loading}
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
						<div className="flex min-w-0 items-center justify-between gap-4">
							<div className="min-w-0 space-y-1">
								<Label
									id="escalations-label"
									htmlFor="telegram-enable-escalations"
									className="text-sm font-medium"
								>
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
										id="telegram-enable-escalations"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
										disabled={loading}
										aria-labelledby="escalations-label"
										aria-describedby="escalations-desc"
										className="shrink-0"
									/>
								)}
							</form.Field>
						</div>

						<form.Subscribe<boolean> selector={(state) => state.values.enableEscalations}>
							{(escalationsEnabled: typeof form.state.values.enableEscalations) =>
								escalationsEnabled && (
									<div className="rounded-lg border bg-muted/30 p-3">
										<form.Field
											name="escalationTimeoutHours"
											validators={{
												onChange: ({ value }) =>
													Number.isInteger(value) && value >= 1 && value <= 168
														? undefined
														: t(
																"settings.notifications.timeoutInvalid",
																"Enter a whole number of hours from 1 to 168.",
															),
											}}
										>
											{(field) => {
												const hasError = field.state.meta.errors.length > 0;
												return (
													<div className="space-y-2">
														<div className="flex items-center gap-3">
															<Label htmlFor="escalationTimeout" className="shrink-0 text-xs">
																{t("settings.telegram.features.escalationTimeout", "Timeout")}
															</Label>
															<Input
																id="escalationTimeout"
																type="number"
																inputMode="numeric"
																min={1}
																max={168}
																step={1}
																value={Number.isNaN(field.state.value) ? "" : field.state.value}
																onChange={(e) => field.handleChange(e.target.valueAsNumber)}
																onBlur={field.handleBlur}
																disabled={loading}
																aria-invalid={hasError}
																aria-describedby={
																	hasError ? "escalationTimeout-error" : undefined
																}
																className="h-8 w-20 tabular-nums"
															/>
															<span className="text-xs text-muted-foreground">
																{t("settings.telegram.features.hours", "hours")}
															</span>
														</div>
														{hasError ? (
															<p
																id="escalationTimeout-error"
																className="text-sm text-destructive"
																role="alert"
															>
																{field.state.meta.errors.join(" ")}
															</p>
														) : null}
													</div>
												);
											}}
										</form.Field>
									</div>
								)
							}
						</form.Subscribe>
					</div>

					{/* Save Button */}
					<div className="flex justify-end pt-2">
						<Button type="submit" disabled={loading || !isDirty}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
							{t("common.saveChanges", "Save Changes")}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

// ============================================
// LINK CODE EXPIRY
// ============================================

const LINK_CODE_EXPIRY_TICK_MS = 30_000;

/** Whole minutes until the link code expires, rounded up; 0 once it has expired. */
export function linkCodeMinutesRemaining(
	expiresAt: string,
	now: Temporal.Instant,
): number {
	const remaining = Temporal.Instant.from(expiresAt)
		.since(now)
		.total({ unit: "minutes" });
	return remaining > 0 ? Math.ceil(remaining) : 0;
}

export function TelegramLinkCodeExpiry({
	expiresAt,
	isRegenerating,
	onRegenerate,
	children,
}: {
	expiresAt: string;
	isRegenerating: boolean;
	onRegenerate: () => void;
	/** The code and its instructions, shown only while the code is valid. */
	children: ReactNode;
}) {
	const { t } = useTranslate();
	const [now, setNow] = useState(() => Temporal.Now.instant());
	const minutes = linkCodeMinutesRemaining(expiresAt, now);
	const expired = minutes === 0;

	useEffect(() => {
		if (expired) return;
		const timer = setInterval(
			() => setNow(Temporal.Now.instant()),
			LINK_CODE_EXPIRY_TICK_MS,
		);
		return () => clearInterval(timer);
	}, [expired]);

	if (expired) {
		return (
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
				<p className="text-sm" role="status">
					{t(
						"settings.telegram.linking.codeExpired",
						"Expired — generate a new code",
					)}
				</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onRegenerate}
					disabled={isRegenerating}
				>
					{isRegenerating ? (
						<IconLoader2
							className="mr-2 size-4 motion-safe:animate-spin"
							aria-hidden="true"
						/>
					) : (
						<IconRefresh className="mr-2 size-4" aria-hidden="true" />
					)}
					{t("settings.telegram.linking.regenerateCode", "Generate new code")}
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{children}
			<p className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
				<IconClock className="size-4 shrink-0" aria-hidden="true" />
				{t(
					"settings.telegram.linking.expiresIn",
					"Expires in {minutes, plural, one {# minute} other {# minutes}}",
					{ minutes },
				)}
			</p>
		</div>
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
		mutationFn: () => generateTelegramLinkCode(),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.telegram.link(userId, organizationId),
				});
				setLinkCode(result.data);
			} else {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.telegram.linkError",
						"Failed to generate link code",
					]),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.telegram.linkError", "Failed to generate link code"));
		},
	});

	const unlinkMutation = useMutation({
		mutationFn: async () => {
			const result = await unlinkTelegramAccount();
			if (!result.success) {
				throw new Error(
					actionErrorMessage(t, result, {}, [
						"settings.telegram.unlinkError",
						"Failed to unlink Telegram account",
					]),
				);
			}
		},
		onSuccess: () => {
			toast.success(t("settings.telegram.unlinked", "Telegram account unlinked"));
			setLinkCode(null);
			queryClient.invalidateQueries({
				queryKey: queryKeys.telegram.link(userId, organizationId),
			});
		},
		// A failure is shown inside the confirmation dialog, which stays open for a retry.
	});
	const unlinking = useConfirmedAction<"account">();

	const handleCopy = async () => {
		if (!linkCode) return;
		try {
			await navigator.clipboard.writeText(linkCode.code);
		} catch {
			toast.error(
				t(
					"settings.telegram.linking.copyFailed",
					"The link code could not be copied. Select it and copy it manually.",
				),
			);
			return;
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconBrandTelegram className="size-5" aria-hidden="true" />
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
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
						<div className="flex min-w-0 items-center gap-3">
							<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
								<IconBrandTelegram className="size-5 text-primary" aria-hidden="true" />
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
						<Button
							variant="outline"
							size="sm"
							disabled={unlinking.isPending}
							onClick={() => unlinking.request("account")}
						>
							{unlinking.isPending ? (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconUnlink className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("settings.telegram.unlink", "Unlink")}
						</Button>
						<ConfirmActionDialog
							open={unlinking.open}
							onOpenChange={unlinking.onOpenChange}
							variant="default"
							title={t("settings.telegram.unlinkConfirm.title", "Unlink Telegram Account?")}
							description={t(
								"settings.telegram.unlinkConfirm.description",
								"You will stop receiving Telegram notifications. You can link again later.",
							)}
							confirmLabel={t("settings.telegram.unlink", "Unlink")}
							isPending={unlinking.isPending}
							error={unlinking.error}
							onConfirm={() =>
								void unlinking.confirm(
									() => unlinkMutation.mutateAsync(),
									(failure) =>
										describeFailure(
											failure,
											t("settings.telegram.unlinkError", "Failed to unlink Telegram account"),
										),
								)
							}
						/>
					</div>
				) : (
					<div className="space-y-4">
						{linkCode ? (
							<TelegramLinkCodeExpiry
								key={linkCode.code}
								expiresAt={linkCode.expiresAt}
								isRegenerating={generateCodeMutation.isPending}
								onRegenerate={() => generateCodeMutation.mutate()}
							>
								<div className="flex items-center gap-2">
									<div className="flex-1 rounded-lg border bg-muted/50 px-4 py-3 text-center font-mono text-2xl tracking-widest">
										{linkCode.code}
									</div>
									<Button
										variant="outline"
										size="icon"
										onClick={handleCopy}
										aria-label={
											copied
												? t("settings.telegram.linking.codeCopied", "Link code copied")
												: t("settings.telegram.linking.copyCode", "Copy link code")
										}
									>
										{copied ? (
											<IconCheck className="size-4 text-primary" aria-hidden="true" />
										) : (
											<IconCopy className="size-4" aria-hidden="true" />
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
							</TelegramLinkCodeExpiry>
						) : (
							<Button
								onClick={() => generateCodeMutation.mutate()}
								disabled={generateCodeMutation.isPending}
								variant="outline"
							>
								{generateCodeMutation.isPending ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
								) : (
									<IconBrandTelegram className="mr-2 size-4" aria-hidden="true" />
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
