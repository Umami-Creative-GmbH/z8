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
import type {
	ChatLinkProofPurpose,
	GeneratedMemberLinkCode,
} from "@/app/[locale]/(app)/settings/notifications/chat-link-actions";
import { linkCodeMinutesRemaining } from "@/components/settings/telegram-link-code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatInstallationProvider } from "@/db/schema/chat-installations";
import { chatLinkCodeKey } from "@/hooks/use-member-chat-links";
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
	generatedCodes: Record<string, GeneratedMemberLinkCode>;
	generatingCodeKey: string | null;
	onGenerateLinkCode: (input: {
		provider: ChatInstallationProvider;
		purpose: ChatLinkProofPurpose;
		installationId?: string;
	}) => void;
	recheckingDiscordInstallationId?: string | null;
	onRecheckDiscordDm?: (installationId: string) => void;
	unlinkingProvider: ChatInstallationProvider | null;
	onUnlink: (provider: ChatInstallationProvider, installationId?: string) => void;
}

function formatLinkCommand(
	provider: ChatInstallationProvider,
	purpose: ChatLinkProofPurpose,
	code: string,
): string {
	switch (provider) {
		case "telegram":
			return `/link ${code}`;
		case "slack":
			return purpose === "candidate_enrollment" ? `enroll ${code}` : `/z8 link ${code}`;
		case "teams":
			return `link ${code}`;
		case "discord":
			return `/link code:${code}`;
	}
}

function LinkCodeExpiry({ expiresAt }: { expiresAt: string }) {
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

const renderStatusBadge = (
	t: ReturnType<typeof useTranslate>["t"],
	status: MemberChatLinkStatus,
) => {
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

const renderHint = (
	t: ReturnType<typeof useTranslate>["t"],
	provider: ChatInstallationProvider,
	hint: MemberChatLinkRecoveryHint,
) => {
	if (!hint) return null;
	switch (hint) {
		case "link_required":
			switch (provider) {
				case "telegram":
					return t(
						"settings.notifications.chatLinks.hints.telegramLinkRequired",
						"Generate a short-lived link code and send it to your organization's Telegram bot.",
					);
				case "slack":
					return t(
						"settings.notifications.chatLinks.hints.slackLinkRequired",
						"Generate a short-lived link code and run it in Slack to connect your account.",
					);
				case "teams":
					return t(
						"settings.notifications.chatLinks.hints.teamsLinkRequired",
						"Generate a short-lived link code and send it in a 1:1 chat with your organization's Teams app.",
					);
				case "discord":
					return t(
						"settings.notifications.chatLinks.hints.discordLinkRequired",
						"Generate a short-lived link code and run `/link` with your organization's Discord bot.",
					);
			}
			break;
		case "start_bot_private_chat":
			return t(
				"settings.notifications.chatLinks.hints.startPrivateChat",
				"Open a direct message with the bot so Z8 can deliver private notifications.",
			);
		case "discord_share_server_with_bot":
			return t(
				"settings.notifications.chatLinks.hints.discordShareServer",
				"Z8 could not open a Discord DM because you do not share a server with this bot. Join a shared server with the bot, enable Direct Messages for that server, and click Verify DM delivery.",
			);
		case "discord_enable_server_dms":
			return t(
				"settings.notifications.chatLinks.hints.discordEnableDms",
				"Discord privacy settings blocked direct messages from this bot (error 50007). Open your Discord server Privacy Settings, enable Direct Messages, ensure the bot is not blocked, and click Verify DM delivery.",
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

const renderCodeInstructions = (
	t: ReturnType<typeof useTranslate>["t"],
	provider: ChatInstallationProvider,
	purpose: ChatLinkProofPurpose,
) => {
	if (purpose === "candidate_enrollment") {
		switch (provider) {
			case "telegram":
				return t(
					"settings.notifications.chatLinks.replacementTelegramInstructions",
					"Open the replacement bot in Telegram and send this one-time command:",
				);
			case "slack":
				return t(
					"settings.notifications.chatLinks.replacementSlackInstructions",
					"Send this one-time message in a direct message to your organization's replacement Slack app:",
				);
			case "teams":
				return t(
					"settings.notifications.chatLinks.replacementTeamsInstructions",
					"Send this one-time message in a 1:1 chat with your organization's replacement Teams app:",
				);
			case "discord":
				return t(
					"settings.notifications.chatLinks.replacementDiscordInstructions",
					"Run this one-time slash command with your organization's replacement Discord bot (Z8 will then verify DM delivery):",
				);
		}
	}

	switch (provider) {
		case "telegram":
			return t(
				"settings.notifications.chatLinks.telegramInstructions",
				"Send this one-time command in a private chat with your organization's Telegram bot:",
			);
		case "slack":
			return t(
				"settings.notifications.chatLinks.slackInstructions",
				"Run this one-time command in Slack (or DM `link <code>` to the bot):",
			);
		case "teams":
			return t(
				"settings.notifications.chatLinks.teamsInstructions",
				"Send this one-time message in a 1:1 chat with the Z8 app in Microsoft Teams:",
			);
		case "discord":
			return t(
				"settings.notifications.chatLinks.discordInstructions",
				"Run this one-time slash command with the Discord bot (Z8 will then verify direct message delivery):",
			);
	}
};

function LinkCodeBox(params: {
	provider: ChatInstallationProvider;
	purpose: ChatLinkProofPurpose;
	generated: GeneratedMemberLinkCode;
	fallbackBotUsername: string | null;
	copiedCommand: string | null;
	handleCopyCommand: (command: string) => Promise<void>;
	onRetry: () => void;
	isRetrying: boolean;
}) {
	const { t } = useTranslate();
	const { copiedCommand, handleCopyCommand, onRetry, isRetrying } = params;
	const command = formatLinkCommand(params.provider, params.purpose, params.generated.code);
	const telegramBotUsername =
		params.provider === "telegram"
			? (params.generated.botUsername ?? params.fallbackBotUsername)
			: null;
	const isCopied = copiedCommand === command;

	return (
		<div className="space-y-2.5 rounded-md border bg-background p-3">
			<p className="text-xs text-muted-foreground">
				{renderCodeInstructions(t, params.provider, params.purpose)}
			</p>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<code className="break-all rounded bg-muted px-2.5 py-1.5 font-mono text-sm font-medium">
					{command}
				</code>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void handleCopyCommand(command)}
					>
						{isCopied ? (
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
								{t("settings.notifications.chatLinks.openTelegramBot", "Open @{botUsername}", {
									botUsername: telegramBotUsername.replace(/^@/, ""),
								})}
							</a>
						</Button>
					)}
					<Button type="button" variant="ghost" size="sm" onClick={onRetry} disabled={isRetrying}>
						<IconRefresh
							className={isRetrying ? "mr-1.5 size-4 motion-safe:animate-spin" : "mr-1.5 size-4"}
							aria-hidden="true"
						/>
						{t("settings.notifications.chatLinks.checkStatus", "Check status")}
					</Button>
				</div>
			</div>
			<LinkCodeExpiry expiresAt={params.generated.expiresAt} />
		</div>
	);
}

type Enrollment = NonNullable<MemberChatChannelLinkView["candidateEnrollment"]>;

function CandidateEnrollmentHeading({
	candidate,
	providerLabel,
}: {
	candidate: Enrollment;
	providerLabel: string;
}) {
	const { t } = useTranslate();
	return (
		<div className="min-w-0 space-y-1">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-xs font-medium">
					{t(
						"settings.notifications.chatLinks.replacementChannelTitle",
						"Replacement {provider} connection staged",
						{ provider: providerLabel },
					)}
				</span>
				<Badge variant={candidate.status === "enrolled" ? "secondary" : "outline"}>
					{candidate.status === "enrolled"
						? t("settings.notifications.chatLinks.replacementEnrolled", "Enrolled")
						: t("settings.notifications.chatLinks.status.actionNeeded", "Action needed")}
				</Badge>
			</div>
			{candidate.installationLabel && (
				<p className="truncate text-xs text-muted-foreground">{candidate.installationLabel}</p>
			)}
			<p className="text-xs text-muted-foreground">
				{candidate.status === "enrolled"
					? t(
							"settings.notifications.chatLinks.replacementChannelEnrolledHint",
							"You are enrolled for the replacement connection. Your current live link stays active until your admin completes the switch.",
						)
					: t(
							"settings.notifications.chatLinks.replacementChannelHint",
							"Link the staged replacement ahead of the switch. Your current notifications stay uninterrupted until your admin switches.",
						)}
			</p>
		</div>
	);
}

function CandidateEnrollment({
	generatedCodes,
	generatingCodeKey,
	onGenerateLinkCode,
	onRecheckDiscordDm,
	recheckingDiscordInstallationId,
	isRetrying,
	onRetry,
	provider,
	providerLabel,
	candidate,
	copiedCommand,
	handleCopyCommand,
}: Pick<
	ChatConnectionsCardProps,
	| "generatedCodes"
	| "generatingCodeKey"
	| "onGenerateLinkCode"
	| "onRecheckDiscordDm"
	| "recheckingDiscordInstallationId"
	| "isRetrying"
	| "onRetry"
> & {
	provider: ChatInstallationProvider;
	providerLabel: string;
	candidate: Enrollment;
	copiedCommand: string | null;
	handleCopyCommand: (command: string) => Promise<void>;
}) {
	const { t } = useTranslate();
	const codeKey = chatLinkCodeKey(provider, "candidate_enrollment", candidate.installationId);
	const candidateCode = generatedCodes[codeKey];
	const isGeneratingCandidateCode = generatingCodeKey === codeKey;
	const isRecheckingCandidateDiscord = recheckingDiscordInstallationId === candidate.installationId;
	const candidateDiscordDmBlocked =
		provider === "discord" &&
		(candidate.recoveryHint === "discord_enable_server_dms" ||
			candidate.recoveryHint === "discord_share_server_with_bot");
	return (
		<div className="space-y-2.5 rounded-md border border-dashed bg-background p-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<CandidateEnrollmentHeading candidate={candidate} providerLabel={providerLabel} />

				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{candidate.canRecheckDm && candidateDiscordDmBlocked && onRecheckDiscordDm && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={isRecheckingCandidateDiscord}
							onClick={() => onRecheckDiscordDm(candidate.installationId)}
						>
							{isRecheckingCandidateDiscord ? (
								<IconLoader2
									className="mr-1.5 size-4 motion-safe:animate-spin"
									aria-hidden="true"
								/>
							) : (
								<IconRefresh className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{t("settings.notifications.chatLinks.verifyDmButton", "Verify DM delivery")}
						</Button>
					)}

					{candidate.canGenerateLinkCode && candidate.status !== "enrolled" && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={isGeneratingCandidateCode}
							onClick={() =>
								onGenerateLinkCode({
									provider,
									purpose: "candidate_enrollment",
									installationId: candidate.installationId,
								})
							}
						>
							{isGeneratingCandidateCode && (
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
			</div>

			{candidateDiscordDmBlocked && candidate.recoveryHint && (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs"
				>
					<IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
					<span>{renderHint(t, provider, candidate.recoveryHint)}</span>
				</div>
			)}

			{candidateCode &&
				candidateCode.installationId === candidate.installationId &&
				candidate.status !== "enrolled" && (
					<LinkCodeBox
						provider={provider}
						purpose="candidate_enrollment"
						generated={candidateCode}
						fallbackBotUsername={candidate.botUsername}
						copiedCommand={copiedCommand}
						handleCopyCommand={handleCopyCommand}
						onRetry={onRetry}
						isRetrying={isRetrying}
					/>
				)}
		</div>
	);
}

function ChatConnectionsLoadError({
	onRetry,
	isRetrying,
}: Pick<ChatConnectionsCardProps, "onRetry" | "isRetrying">) {
	const { t } = useTranslate();
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

export function ChatConnectionsCard({
	hasOrganizationContext,
	channels,
	isLoading,
	error,
	isRetrying,
	onRetry,
	generatedCodes,
	generatingCodeKey,
	onGenerateLinkCode,
	recheckingDiscordInstallationId = null,
	onRecheckDiscordDm,
	unlinkingProvider,
	onUnlink,
}: ChatConnectionsCardProps) {
	const { t } = useTranslate();
	const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

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

	if (error) return <ChatConnectionsLoadError onRetry={onRetry} isRetrying={isRetrying} />;

	const visibleChannels = channels.filter(
		(channel) =>
			channel.available &&
			(channel.status !== "unavailable" || Boolean(channel.candidateEnrollment)),
	);

	if (visibleChannels.length === 0) {
		return null;
	}

	const handleCopyCommand = async (command: string) => {
		try {
			await navigator.clipboard.writeText(command);
			setCopiedCommand(command);
			toast.success(
				t("settings.notifications.chatLinks.copiedCommand", "Link command copied to clipboard"),
			);
			setTimeout(() => {
				setCopiedCommand((current) => (current === command ? null : current));
			}, 2000);
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
					const hintText = renderHint(t, channel.provider, channel.recoveryHint);
					const isDiscordDmBlocked =
						channel.provider === "discord" &&
						(channel.recoveryHint === "discord_enable_server_dms" ||
							channel.recoveryHint === "discord_share_server_with_bot");
					const isUnlinking = unlinkingProvider === channel.provider;
					const liveCodeKey = chatLinkCodeKey(
						channel.provider,
						"member_link",
						channel.installationId,
					);
					const liveCode =
						generatedCodes[liveCodeKey] ??
						generatedCodes[chatLinkCodeKey(channel.provider, "member_link", null)] ??
						null;
					const isGeneratingLiveCode =
						generatingCodeKey === liveCodeKey ||
						generatingCodeKey === chatLinkCodeKey(channel.provider, "member_link", null);
					const showLiveCode = channel.status !== "connected" && liveCode !== null;
					const isRecheckingLiveDiscord =
						Boolean(channel.installationId) &&
						recheckingDiscordInstallationId === channel.installationId;

					return (
						<div key={channel.provider} className="space-y-3 rounded-lg border bg-muted/30 p-3">
							<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
								<div className="min-w-0 space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<ProviderIcon className="size-4 shrink-0" aria-hidden="true" />
										<span className="text-sm font-medium">{providerLabel}</span>
										{renderStatusBadge(t, channel.status)}
									</div>
									{channel.installationLabel && (
										<p className="truncate text-xs text-muted-foreground">
											{channel.installationLabel}
										</p>
									)}
									{linkedIdentity && (channel.status === "connected" || isDiscordDmBlocked) && (
										<p className="break-all text-xs text-foreground">
											{t("settings.notifications.chatLinks.linkedAs", "Linked as {identity}", {
												identity: linkedIdentity,
											})}
										</p>
									)}
									{hintText && !isDiscordDmBlocked && (
										<p className="text-xs text-muted-foreground">{hintText}</p>
									)}
								</div>

								<div className="flex shrink-0 flex-wrap items-center gap-2">
									{channel.provider === "discord" &&
										channel.canRecheckDm &&
										isDiscordDmBlocked &&
										channel.installationId &&
										onRecheckDiscordDm && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={isRecheckingLiveDiscord}
												onClick={() => onRecheckDiscordDm(channel.installationId!)}
											>
												{isRecheckingLiveDiscord ? (
													<IconLoader2
														className="mr-1.5 size-4 motion-safe:animate-spin"
														aria-hidden="true"
													/>
												) : (
													<IconRefresh className="mr-1.5 size-4" aria-hidden="true" />
												)}
												{t("settings.notifications.chatLinks.verifyDmButton", "Verify DM delivery")}
											</Button>
										)}

									{channel.canUnlink && (
										<Button
											type="button"
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

									{channel.canGenerateLinkCode && channel.status !== "connected" && (
										<Button
											type="button"
											size="sm"
											disabled={isGeneratingLiveCode}
											onClick={() =>
												onGenerateLinkCode({
													provider: channel.provider,
													purpose: "member_link",
													installationId: channel.installationId ?? undefined,
												})
											}
										>
											{isGeneratingLiveCode && (
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

							{isDiscordDmBlocked && hintText && (
								<div
									role="alert"
									className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs"
								>
									<IconAlertTriangle
										className="mt-0.5 size-4 shrink-0 text-warning"
										aria-hidden="true"
									/>
									<span>{hintText}</span>
								</div>
							)}

							{showLiveCode && liveCode && (
								<LinkCodeBox
									provider={channel.provider}
									purpose="member_link"
									generated={liveCode}
									fallbackBotUsername={channel.botUsername}
									copiedCommand={copiedCommand}
									handleCopyCommand={handleCopyCommand}
									onRetry={onRetry}
									isRetrying={isRetrying}
								/>
							)}

							{channel.candidateEnrollment && (
								<CandidateEnrollment
									provider={channel.provider}
									providerLabel={providerLabel}
									candidate={channel.candidateEnrollment}
									copiedCommand={copiedCommand}
									handleCopyCommand={handleCopyCommand}
									generatedCodes={generatedCodes}
									generatingCodeKey={generatingCodeKey}
									onGenerateLinkCode={onGenerateLinkCode}
									onRecheckDiscordDm={onRecheckDiscordDm}
									recheckingDiscordInstallationId={recheckingDiscordInstallationId}
									isRetrying={isRetrying}
									onRetry={onRetry}
								/>
							)}
						</div>
					);
				})}
			</CardContent>
		</Card>
	);
}
