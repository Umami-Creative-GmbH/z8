"use client";

import {
	IconAlertTriangle,
	IconBrandDiscord,
	IconCheck,
	IconCopy,
	IconLoader2,
	IconRefresh,
	IconUnlink,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type GeneratedMemberDiscordLinkCode,
	generateMemberDiscordLinkCode,
	getMemberDiscordLinkStateAction,
	recheckMemberDiscordDmAction,
	unlinkMemberDiscordAccount,
} from "@/app/[locale]/(app)/settings/notifications/discord-link-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/auth-client";
import type {
	MemberDiscordLaneStatus,
	MemberDiscordLinkState,
} from "@/lib/chat-installations/discord-member-link";

export function DiscordMemberLinkCard() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const userId = session?.user?.id ?? null;
	const activeOrganizationId = session?.session?.activeOrganizationId ?? null;
	const queryKey = ["notifications", "discord-member-link", userId, activeOrganizationId] as const;

	const [generatedCode, setGeneratedCode] = useState<GeneratedMemberDiscordLinkCode | null>(null);
	const [copied, setCopied] = useState(false);

	const { data, isLoading, refetch, isRefetching } = useQuery({
		queryKey,
		enabled: Boolean(activeOrganizationId),
		queryFn: async (): Promise<MemberDiscordLinkState | null> => {
			const res = await getMemberDiscordLinkStateAction();
			if (!res.success) return null;
			return res.data;
		},
	});

	const generateMutation = useMutation({
		mutationFn: async (input: {
			purpose: "member_link" | "candidate_enrollment";
			installationId: string;
		}) => {
			const res = await generateMemberDiscordLinkCode(input);
			if (!res.success) {
				throw new Error(res.error);
			}
			return res.data;
		},
		onSuccess: (code) => {
			setGeneratedCode(code);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t(
							"settings.notifications.discordLink.generateFailed",
							"Failed to generate Discord link code.",
						),
			);
		},
	});

	const recheckDmMutation = useMutation({
		mutationFn: async (installationId: string) => {
			const res = await recheckMemberDiscordDmAction({ installationId });
			if (!res.success) {
				throw new Error(res.error);
			}
			return res.data;
		},
		onSuccess: (result) => {
			if (result.kind === "reachable") {
				toast.success(
					t(
						"settings.notifications.discordLink.dmVerified",
						"Discord direct message delivery is verified.",
					),
				);
			} else {
				toast.warning(result.message);
			}
			void queryClient.invalidateQueries({ queryKey });
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t(
							"settings.notifications.discordLink.dmRecheckFailed",
							"Could not verify Discord direct messages.",
						),
			);
		},
	});

	const unlinkMutation = useMutation({
		mutationFn: async (installationId: string) => {
			const res = await unlinkMemberDiscordAccount({ installationId });
			if (!res.success) {
				throw new Error(res.error);
			}
		},
		onSuccess: () => {
			setGeneratedCode(null);
			toast.success(t("settings.notifications.discordLink.unlinked", "Discord account unlinked."));
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	if (!activeOrganizationId || isLoading || !data || (!data.active && !data.candidate)) {
		return null;
	}

	const handleCopy = async (command: string) => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			toast.success(
				t("settings.notifications.discordLink.commandCopied", "Discord link command copied."),
			);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error(
				t("settings.notifications.discordLink.copyFailed", "Could not copy link command."),
			);
		}
	};

	const renderLane = (
		lane: MemberDiscordLaneStatus,
		purpose: "member_link" | "candidate_enrollment",
		heading: string,
	) => {
		const isCodeForLane =
			generatedCode !== null && generatedCode.installationId === lane.installationId;
		const command = isCodeForLane ? `/link code:${generatedCode.code}` : null;
		const isDmBlocked =
			lane.reachabilityStatus === "action_needed" || lane.reachabilityStatus === "unreachable";

		return (
			<div key={lane.installationId} className="space-y-3 rounded-lg border bg-muted/20 p-3">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-medium">{heading}</span>
							<Badge variant={lane.status === "connected" ? "secondary" : "outline"}>
								{lane.status === "connected" ? (
									<>
										<IconCheck className="mr-1 size-3.5" aria-hidden="true" />
										{t("settings.notifications.discordLink.connected", "Connected")}
									</>
								) : (
									<>
										<IconAlertTriangle className="mr-1 size-3.5" aria-hidden="true" />
										{t("settings.notifications.discordLink.actionNeeded", "Action needed")}
									</>
								)}
							</Badge>
						</div>
						{lane.installationLabel ? (
							<p className="truncate text-xs text-muted-foreground">{lane.installationLabel}</p>
						) : null}
						{lane.externalUsername ? (
							<p className="text-xs text-foreground">
								{t("settings.notifications.discordLink.linkedAs", "Linked as {username}", {
									username: lane.externalUsername,
								})}
							</p>
						) : null}
					</div>

					<div className="flex flex-wrap items-center gap-2">
						{lane.canRecheckDm && isDmBlocked ? (
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={recheckDmMutation.isPending}
								onClick={() => recheckDmMutation.mutate(lane.installationId)}
							>
								{recheckDmMutation.isPending ? (
									<IconLoader2
										className="mr-1.5 size-4 motion-safe:animate-spin"
										aria-hidden="true"
									/>
								) : (
									<IconRefresh className="mr-1.5 size-4" aria-hidden="true" />
								)}
								{t("settings.notifications.discordLink.verifyDmButton", "Verify DM delivery")}
							</Button>
						) : null}
						{lane.status !== "connected" ? (
							<Button
								type="button"
								size="sm"
								disabled={generateMutation.isPending}
								onClick={() =>
									generateMutation.mutate({
										purpose,
										installationId: lane.installationId,
									})
								}
							>
								{generateMutation.isPending ? (
									<IconLoader2
										className="mr-1.5 size-4 motion-safe:animate-spin"
										aria-hidden="true"
									/>
								) : null}
								{t("settings.notifications.discordLink.generateCode", "Generate link code")}
							</Button>
						) : null}
						{lane.canUnlink ? (
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={unlinkMutation.isPending}
								onClick={() => unlinkMutation.mutate(lane.installationId)}
							>
								<IconUnlink className="mr-1.5 size-4" aria-hidden="true" />
								{t("settings.notifications.discordLink.unlink", "Unlink")}
							</Button>
						) : null}
					</div>
				</div>

				{isDmBlocked ? (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs"
					>
						<IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
						<span>
							{lane.reachabilityReason === "discord_missing_access"
								? t(
										"settings.notifications.discordLink.recoveryShareServer",
										"Z8 could not open a Discord DM because you do not share a server with this bot. Join a shared server with the bot, enable Direct Messages for that server, and click Verify DM delivery.",
									)
								: t(
										"settings.notifications.discordLink.recoveryEnableDms",
										"Discord privacy settings blocked direct messages from this bot (error 50007). Open your Discord server Privacy Settings, enable Direct Messages, ensure the bot is not blocked, and click Verify DM delivery.",
									)}
						</span>
					</div>
				) : null}

				{command ? (
					<div className="space-y-2 rounded-md border bg-background p-3">
						<p className="text-xs text-muted-foreground">
							{t(
								"settings.notifications.discordLink.codeInstructions",
								"Run this one-time slash command with the Discord bot (Z8 will then verify direct message delivery):",
							)}
						</p>
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<code className="break-all rounded bg-muted px-2.5 py-1.5 font-mono text-xs font-medium">
								{command}
							</code>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => void handleCopy(command)}
								>
									{copied ? (
										<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
									) : (
										<IconCopy className="mr-1.5 size-4" aria-hidden="true" />
									)}
									{t("settings.notifications.discordLink.copy", "Copy")}
								</Button>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									disabled={isRefetching}
									onClick={() => void refetch()}
								>
									<IconRefresh
										className={
											isRefetching ? "mr-1.5 size-4 motion-safe:animate-spin" : "mr-1.5 size-4"
										}
										aria-hidden="true"
									/>
									{t("settings.notifications.discordLink.checkStatus", "Check status")}
								</Button>
							</div>
						</div>
					</div>
				) : null}
			</div>
		);
	};

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center gap-2">
					<IconBrandDiscord className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<CardTitle className="text-base">
						{t("settings.notifications.discordLink.title", "Discord direct message linking")}
					</CardTitle>
				</div>
				<CardDescription>
					{t(
						"settings.notifications.discordLink.description",
						"Link your Discord account and verify that Discord privacy controls allow direct messages from Z8.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3" aria-live="polite">
				{data.active
					? renderLane(
							data.active,
							"member_link",
							t("settings.notifications.discordLink.currentBot", "Current Discord bot"),
						)
					: null}
				{data.candidate
					? renderLane(
							data.candidate,
							"candidate_enrollment",
							t(
								"settings.notifications.discordLink.replacementBot",
								"Upcoming replacement Discord bot",
							),
						)
					: null}
			</CardContent>
		</Card>
	);
}
