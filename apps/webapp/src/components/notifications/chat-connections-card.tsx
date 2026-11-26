"use client";

import {
	IconAlertTriangle,
	IconBrandDiscord,
	IconBrandSlack,
	IconBrandTeams,
	IconBrandTelegram,
	IconCheck,
	IconClock,
	IconCopy,
	IconExclamationCircle,
	IconExternalLink,
	IconLoader2,
	IconPlugConnected,
	IconRefresh,
	IconUnlink,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import type { GeneratedMemberLinkCode } from "@/app/[locale]/(app)/settings/notifications/chat-link-actions";
import { linkCodeMinutesRemaining } from "@/components/settings/telegram-link-code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatInstallationProvider } from "@/db/schema/chat-installations";
import type {
	MemberChatChannelLinkView,
	MemberChatLinkRecoveryHint,
	MemberChatLinkStatus,
} from "@/lib/chat-installations/member-links";

const PROVIDER_META: Record<
	ChatInstallationProvider,
	{
		icon: typeof IconBrandTelegram;
		labelKey: string;
		labelFallback: string;
	}
> = {
	telegram: {
		icon: IconBrandTelegram,
		labelKey: "common:notifications.preferences.channels.telegram.label",
		labelFallback: "Telegram",
	},
	slack: {
		icon: IconBrandSlack,
		labelKey: "common:notifications.preferences.channels.slack.label",
		labelFallback: "Slack",
	},
	teams: {
		icon: IconBrandTeams,
		labelKey: "common:notifications.preferences.channels.teams.label",
		labelFallback: "Microsoft Teams",
	},
	discord: {
		icon: IconBrandDiscord,
		labelKey: "common:notifications.preferences.channels.discord.label",
		labelFallback: "Discord",
	},
};

export interface ChatConnectionsCardProps {
	hasOrganizationContext: boolean;
	channels: MemberChatChannelLinkView[];
	isLoading: boolean;
	error: Error | null;
	isRetrying: boolean;
	onRetry: () => void;
	generatedTelegramCode: GeneratedMemberLinkCode | null;
	isGeneratingTelegramCode: boolean;
	onGenerateTelegramCode: () => void;
	generatedTelegramCandidateCode?: GeneratedMemberLinkCode | null;
	isGeneratingTelegramCandidateCode?: boolean;
	onGenerateTelegramCandidateCode?: (installationId: string) => void;
	unlinkingProvider: ChatInstallationProvider | null;
	onUnlink: (provider: ChatInstallationProvider, installationId?: string) => void;
}

function TelegramCodeExpiry({ expiresAt }: { expiresAt: string }) {
	const { t } = useTranslate();
	const [minutesRemaining, setMinutesRemaining] = useState(() =>
		linkCodeMinutesRemaining(expiresAt, Temporal.Now.instant()),
	);

	useEffect(() => {
		const update = () => {
			setMinutesRemaining(linkCodeMinutesRemaining(expiresAt, Temporal.Now.instant()));
		};
		update();
		const interval = setInterval(update, 30_000);
		return () => clearInterval(interval);
	}, [expiresAt]);

	if (minutesRemaining <= 0) {
		return (
			<span className="flex items-center gap-1 text-xs text-destructive">
				<IconClock className="size-3.5 shrink-0" aria-hidden="true" />
				{t("settings.notifications.chatLinks.codeExpired", "Code expired. Generate a new code.")}
			</span>
		);
	}

	return (
		<span className="flex items-center gap-1 text-xs text-muted-foreground">
			<IconClock className="size-3.5 shrink-0" aria-hidden="true" />
			{t("settings.notifications.chatLinks.expiresInMinutes", "Expires in {minutes} min", {
				minutes: String(minutesRemaining),
			})}
		</span>
	);
}

export function ChatConnectionsCard({
	hasOrganizationContext,
	channels,
	isLoading,
	error,
	isRetrying,
	onRetry,
	generatedTelegramCode,
	isGeneratingTelegramCode,
	onGenerateTelegramCode,
	generatedTelegramCandidateCode = null,
	isGeneratingTelegramCandidateCode = false,
	onGenerateTelegramCandidateCode,
	unlinkingProvider,
	onUnlink,
}: ChatConnectionsCardProps) {
	const { t } = useTranslate();
	const [copied, setCopied] = useState(false);

	if (!hasOrganizationContext) {
		return null;
	}

	if (isLoading) {
		return (
			<Card>
				<CardHeader className="pb-3">
					<Skeleton className="h-5 w-40" />
					<Skeleton className="h-4 w-64" />
				</CardHeader>
				<CardContent>
					<Skeleton className="h-16 w-full" />
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Card className="border-destructive/40">
				<CardHeader className="pb-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<IconPlugConnected
								className="size-5 shrink-0 text-muted-foreground"
								aria-hidden="true"
							/>
							<CardTitle className="text-base">
								{t("settings.notifications.chatLinks.title", "Chat connections")}
							</CardTitle>
						</div>
						<Badge variant="destructive">
							<IconExclamationCircle className="size-3.5" aria-hidden="true" />
							{t("settings.notifications.chatLinks.status.couldNotVerify", "Couldn't verify")}
						</Badge>
					</div>
					<CardDescription>
						{t(
							"settings.notifications.chatLinks.description",
							"Manage how your account is linked to your organization's chat channels.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col items-start gap-3">
					<p className="text-sm text-muted-foreground" role="alert">
						{t(
							"settings.notifications.chatLinks.loadFailed",
							"We couldn't verify your chat connections right now. Your notification preferences below remain available.",
						)}
					</p>
					<Button variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
						<IconRefresh
							className={isRetrying ? "mr-1.5 size-4 motion-safe:animate-spin" : "mr-1.5 size-4"}
							aria-hidden="true"
						/>
						{t("common.retry", "Retry")}
					</Button>
				</CardContent>
			</Card>
		);
	}

	const visibleChannels = channels.filter(
		(channel) =>
			channel.available &&
			(channel.status !== "unavailable" || Boolean(channel.candidateEnrollment)),
	);

	if (visibleChannels.length === 0) {
		return null;
	}

	const renderStatusBadge = (status: MemberChatLinkStatus) => {
		switch (status) {
			case "connected":
				return (
					<Badge variant="secondary">
						<IconCheck className="size-3.5" aria-hidden="true" />
						{t("settings.notifications.chatLinks.status.connected", "Connected")}
					</Badge>
				);
			case "action_needed":
				return (
					<Badge variant="outline">
						<IconAlertTriangle className="size-3.5" aria-hidden="true" />
						{t("settings.notifications.chatLinks.status.actionNeeded", "Action needed")}
					</Badge>
				);
			case "could_not_verify":
				return (
					<Badge variant="destructive">
						<IconExclamationCircle className="size-3.5" aria-hidden="true" />
						{t("settings.notifications.chatLinks.status.couldNotVerify", "Couldn't verify")}
					</Badge>
				);
			default:
				return null;
		}
	};

	const renderHint = (provider: ChatInstallationProvider, hint: MemberChatLinkRecoveryHint) => {
		if (!hint) return null;
		switch (hint) {
			case "link_required":
				return provider === "telegram"
					? t(
							"settings.notifications.chatLinks.hints.telegramLinkRequired",
							"Generate a short-lived link code and send it to your organization's Telegram bot.",
						)
					: t(
							"settings.notifications.chatLinks.hints.linkRequired",
							"Link your account in this chat app to receive notifications and use commands.",
						);
			case "start_bot_private_chat":
				return t(
					"settings.notifications.chatLinks.hints.startPrivateChat",
					"Open a direct message with the bot so Z8 can deliver private notifications.",
				);
			case "installation_remediation":
				return t(
					"settings.notifications.chatLinks.hints.remediation",
					"Your organization's connection needs attention from an administrator before status can be verified.",
				);
			case "verification_error":
				return t(
					"settings.notifications.chatLinks.hints.verificationError",
					"Connection status could not be verified. Try checking again.",
				);
		}
	};

	const handleCopyCommand = async (command: string) => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			toast.success(
				t("settings.notifications.chatLinks.copiedCommand", "Link command copied to clipboard"),
			);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error(t("settings.notifications.chatLinks.copyFailed", "Couldn't copy link command"));
		}
	};

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center gap-2">
					<IconPlugConnected className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<CardTitle className="text-base">
						{t("settings.notifications.chatLinks.title", "Chat connections")}
					</CardTitle>
				</div>
				<CardDescription>
					{t(
						"settings.notifications.chatLinks.description",
						"Manage how your account is linked to your organization's chat channels.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3" aria-live="polite">
				{visibleChannels.map((channel) => {
					const meta = PROVIDER_META[channel.provider];
					const ProviderIcon = meta.icon;
					const providerLabel = t(meta.labelKey, meta.labelFallback);
					const linkedIdentity = channel.externalUsername
						? channel.provider === "telegram" && !channel.externalUsername.startsWith("@")
							? `@${channel.externalUsername}`
							: channel.externalUsername
						: channel.externalDisplayName;
					const hintText = renderHint(channel.provider, channel.recoveryHint);
					const isUnlinking = unlinkingProvider === channel.provider;
					const showTelegramCode =
						channel.provider === "telegram" &&
						channel.status !== "connected" &&
						generatedTelegramCode !== null;
					const telegramCommand = generatedTelegramCode
						? `/link ${generatedTelegramCode.code}`
						: null;
					const telegramBotUsername = generatedTelegramCode?.botUsername ?? channel.botUsername;

					return (
						<div key={channel.provider} className="space-y-3 rounded-lg border bg-muted/30 p-3">
							<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
								<div className="min-w-0 space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<ProviderIcon className="size-4 shrink-0" aria-hidden="true" />
										<span className="text-sm font-medium">{providerLabel}</span>
										{renderStatusBadge(channel.status)}
									</div>
									{channel.installationLabel && (
										<p className="truncate text-xs text-muted-foreground">
											{channel.installationLabel}
										</p>
									)}
									{channel.status === "connected" && linkedIdentity && (
										<p className="break-all text-xs text-foreground">
											{t("settings.notifications.chatLinks.linkedAs", "Linked as {identity}", {
												identity: linkedIdentity,
											})}
										</p>
									)}
									{hintText && <p className="text-xs text-muted-foreground">{hintText}</p>}
								</div>

								<div className="flex shrink-0 flex-wrap items-center gap-2">
									{channel.canUnlink && (
										<Button
											variant="outline"
											size="sm"
											disabled={isUnlinking}
											onClick={() =>
												onUnlink(channel.provider, channel.installationId ?? undefined)
											}
											aria-label={t(
												"settings.notifications.chatLinks.unlinkAria",
												"Unlink {provider}",
												{ provider: providerLabel },
											)}
										>
											{isUnlinking ? (
												<IconLoader2
													className="mr-1.5 size-4 motion-safe:animate-spin"
													aria-hidden="true"
												/>
											) : (
												<IconUnlink className="mr-1.5 size-4" aria-hidden="true" />
											)}
											{t("settings.notifications.chatLinks.unlink", "Unlink")}
										</Button>
									)}

									{channel.provider === "telegram" &&
										channel.canGenerateLinkCode &&
										channel.status !== "connected" && (
											<Button
												size="sm"
												disabled={isGeneratingTelegramCode}
												onClick={onGenerateTelegramCode}
											>
												{isGeneratingTelegramCode && (
													<IconLoader2
														className="mr-1.5 size-4 motion-safe:animate-spin"
														aria-hidden="true"
													/>
												)}
												{t("settings.notifications.chatLinks.generateCode", "Generate link code")}
											</Button>
										)}

									{channel.status === "could_not_verify" && (
										<Button variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
											<IconRefresh
												className={
													isRetrying ? "mr-1.5 size-4 motion-safe:animate-spin" : "mr-1.5 size-4"
												}
												aria-hidden="true"
											/>
											{t("common.retry", "Retry")}
										</Button>
									)}
								</div>
							</div>

							{showTelegramCode && generatedTelegramCode && telegramCommand && (
								<div className="space-y-2.5 rounded-md border bg-background p-3">
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.notifications.chatLinks.telegramInstructions",
											"Send this one-time command in a private chat with your organization's Telegram bot:",
										)}
									</p>
									<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
										<code className="break-all rounded bg-muted px-2.5 py-1.5 font-mono text-sm font-medium">
											{telegramCommand}
										</code>
										<div className="flex flex-wrap items-center gap-2">
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => void handleCopyCommand(telegramCommand)}
											>
												{copied ? (
													<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
												) : (
													<IconCopy className="mr-1.5 size-4" aria-hidden="true" />
												)}
												{t("settings.notifications.chatLinks.copyCommand", "Copy")}
											</Button>
											{telegramBotUsername && (
												<Button variant="outline" size="sm" asChild>
													<a
														href={`https://t.me/${telegramBotUsername.replace(/^@/, "")}`}
														target="_blank"
														rel="noopener noreferrer"
													>
														<IconExternalLink className="mr-1.5 size-4" aria-hidden="true" />
														{t(
															"settings.notifications.chatLinks.openTelegramBot",
															"Open @{botUsername}",
															{
																botUsername: telegramBotUsername.replace(/^@/, ""),
															},
														)}
													</a>
												</Button>
											)}
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={onRetry}
												disabled={isRetrying}
											>
												<IconRefresh
													className={
														isRetrying ? "mr-1.5 size-4 motion-safe:animate-spin" : "mr-1.5 size-4"
													}
													aria-hidden="true"
												/>
												{t("settings.notifications.chatLinks.checkStatus", "Check status")}
											</Button>
										</div>
									</div>
									<TelegramCodeExpiry expiresAt={generatedTelegramCode.expiresAt} />
								</div>
							)}

							{channel.provider === "telegram" && channel.candidateEnrollment && (
								<div className="space-y-2.5 rounded-md border border-dashed bg-background p-3">
									<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
										<div className="min-w-0 space-y-1">
											<div className="flex flex-wrap items-center gap-2">
												<span className="text-xs font-medium">
													{t(
														"settings.notifications.chatLinks.replacementTelegramTitle",
														"Replacement Telegram bot staged",
													)}
												</span>
												<Badge
													variant={
														channel.candidateEnrollment.status === "enrolled"
															? "secondary"
															: "outline"
													}
												>
													{channel.candidateEnrollment.status === "enrolled"
														? t("settings.notifications.chatLinks.replacementEnrolled", "Enrolled")
														: t(
																"settings.notifications.chatLinks.status.actionNeeded",
																"Action needed",
															)}
												</Badge>
											</div>
											{channel.candidateEnrollment.installationLabel && (
												<p className="truncate text-xs text-muted-foreground">
													{channel.candidateEnrollment.installationLabel}
												</p>
											)}
											<p className="text-xs text-muted-foreground">
												{channel.candidateEnrollment.status === "enrolled"
													? t(
															"settings.notifications.chatLinks.replacementTelegramEnrolledHint",
															"You are enrolled for the replacement bot. Your current live Telegram link stays active until your admin completes the switch.",
														)
													: t(
															"settings.notifications.chatLinks.replacementTelegramHint",
															"Start and link the replacement Telegram bot ahead of the switch. Your current Telegram notifications stay uninterrupted until the switch.",
														)}
											</p>
										</div>

										{channel.candidateEnrollment.canGenerateLinkCode &&
											channel.candidateEnrollment.status !== "enrolled" &&
											onGenerateTelegramCandidateCode && (
												<Button
													type="button"
													variant="outline"
													size="sm"
													disabled={isGeneratingTelegramCandidateCode}
													onClick={() =>
														onGenerateTelegramCandidateCode(
															channel.candidateEnrollment!.installationId,
														)
													}
												>
													{isGeneratingTelegramCandidateCode && (
														<IconLoader2
															className="mr-1.5 size-4 motion-safe:animate-spin"
															aria-hidden="true"
														/>
													)}
													{t(
														"settings.notifications.chatLinks.generateReplacementCode",
														"Link replacement bot",
													)}
												</Button>
											)}
									</div>

									{generatedTelegramCandidateCode &&
										generatedTelegramCandidateCode.installationId ===
											channel.candidateEnrollment.installationId &&
										channel.candidateEnrollment.status !== "enrolled" && (
											<div className="space-y-2 rounded-md border bg-muted/40 p-2.5">
												<p className="text-xs text-muted-foreground">
													{t(
														"settings.notifications.chatLinks.replacementTelegramInstructions",
														"Open the replacement bot in Telegram and send this one-time command:",
													)}
												</p>
												<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
													<code className="break-all rounded bg-background px-2.5 py-1.5 font-mono text-sm font-medium">
														{`/link ${generatedTelegramCandidateCode.code}`}
													</code>
													<div className="flex flex-wrap items-center gap-2">
														<Button
															type="button"
															variant="outline"
															size="sm"
															onClick={() =>
																void handleCopyCommand(
																	`/link ${generatedTelegramCandidateCode.code}`,
																)
															}
														>
															{copied ? (
																<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
															) : (
																<IconCopy className="mr-1.5 size-4" aria-hidden="true" />
															)}
															{t("settings.notifications.chatLinks.copyCommand", "Copy")}
														</Button>
														{(generatedTelegramCandidateCode.botUsername ??
															channel.candidateEnrollment.botUsername) && (
															<Button variant="outline" size="sm" asChild>
																<a
																	href={`https://t.me/${(
																		generatedTelegramCandidateCode.botUsername ??
																		channel.candidateEnrollment.botUsername ??
																		""
																	).replace(/^@/, "")}`}
																	target="_blank"
																	rel="noopener noreferrer"
																>
																	<IconExternalLink className="mr-1.5 size-4" aria-hidden="true" />
																	{t(
																		"settings.notifications.chatLinks.openTelegramBot",
																		"Open @{botUsername}",
																		{
																			botUsername: (
																				generatedTelegramCandidateCode.botUsername ??
																				channel.candidateEnrollment.botUsername ??
																				""
																			).replace(/^@/, ""),
																		},
																	)}
																</a>
															</Button>
														)}
														<Button
															type="button"
															variant="ghost"
															size="sm"
															onClick={onRetry}
															disabled={isRetrying}
														>
															<IconRefresh
																className={
																	isRetrying
																		? "mr-1.5 size-4 motion-safe:animate-spin"
																		: "mr-1.5 size-4"
																}
																aria-hidden="true"
															/>
															{t("settings.notifications.chatLinks.checkStatus", "Check status")}
														</Button>
													</div>
												</div>
												<TelegramCodeExpiry expiresAt={generatedTelegramCandidateCode.expiresAt} />
											</div>
										)}
								</div>
							)}
						</div>
					);
				})}
			</CardContent>
		</Card>
	);
}
