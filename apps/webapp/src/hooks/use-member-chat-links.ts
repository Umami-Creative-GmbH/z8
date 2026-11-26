"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	type ChatLinkProofPurpose,
	type GeneratedMemberLinkCode,
	generateMemberChatLinkCode,
	getMemberChatLinksAction,
	unlinkMemberChatAccount,
} from "@/app/[locale]/(app)/settings/notifications/chat-link-actions";
import { recheckMemberDiscordDmAction } from "@/app/[locale]/(app)/settings/notifications/discord-link-actions";
import type { ChatInstallationProvider } from "@/db/schema/chat-installations";
import { useSession } from "@/lib/auth-client";
import type { MemberChatLinksSnapshot } from "@/lib/chat-installations/member-links";
import type { ServerActionResult } from "@/lib/effect/result";
import { queryKeys } from "@/lib/query/keys";

const EMPTY_SNAPSHOT: MemberChatLinksSnapshot = {
	organizationId: null,
	hasOrganizationContext: false,
	channels: [],
};

export function chatLinkCodeKey(
	provider: ChatInstallationProvider,
	purpose: ChatLinkProofPurpose,
	installationId?: string | null,
): string {
	return `${provider}:${purpose}:${installationId ?? "active"}`;
}

export function useMemberChatLinks() {
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const userId = session?.user?.id ?? null;
	const activeOrganizationId = session?.session?.activeOrganizationId ?? null;
	const chatLinksQueryKey = queryKeys.notifications.chatLinks(userId, activeOrganizationId);
	const [generatedCodes, setGeneratedCodes] = useState<Record<string, GeneratedMemberLinkCode>>({});
	const [generatingCodeKey, setGeneratingCodeKey] = useState<string | null>(null);
	const [recheckingDiscordInstallationId, setRecheckingDiscordInstallationId] = useState<
		string | null
	>(null);
	const [unlinkingProvider, setUnlinkingProvider] = useState<ChatInstallationProvider | null>(null);

	const { data, isLoading, error, refetch, isRefetching } = useQuery({
		queryKey: chatLinksQueryKey,
		enabled: Boolean(activeOrganizationId),
		queryFn: async (): Promise<MemberChatLinksSnapshot> => {
			const result = await getMemberChatLinksAction();
			if (!result.success) {
				if (result.code === "AuthorizationError") {
					return EMPTY_SNAPSHOT;
				}
				throw new Error(result.code ?? "CHAT_LINKS_UNAVAILABLE");
			}
			return result.data;
		},
	});

	const generateLinkCodeMutation = useMutation({
		mutationFn: async (input: {
			provider: ChatInstallationProvider;
			purpose?: ChatLinkProofPurpose;
			installationId?: string;
		}): Promise<ServerActionResult<GeneratedMemberLinkCode>> => {
			const purpose: ChatLinkProofPurpose = input.purpose ?? "member_link";
			const key = chatLinkCodeKey(input.provider, purpose, input.installationId);
			setGeneratingCodeKey(key);
			return generateMemberChatLinkCode({
				provider: input.provider,
				purpose,
				installationId: input.installationId,
			});
		},
		onSuccess: (result, variables) => {
			if (!result.success) return;
			const purpose: ChatLinkProofPurpose = variables.purpose ?? "member_link";
			const key = chatLinkCodeKey(
				variables.provider,
				purpose,
				variables.installationId ?? result.data.installationId,
			);
			const activeKey = chatLinkCodeKey(variables.provider, purpose, null);
			setGeneratedCodes((prev) => ({
				...prev,
				[key]: result.data,
				...(purpose === "member_link" ? { [activeKey]: result.data } : {}),
			}));
		},
		onSettled: () => {
			setGeneratingCodeKey(null);
		},
	});

	const recheckDiscordDmMutation = useMutation({
		mutationFn: async (installationId: string) => {
			setRecheckingDiscordInstallationId(installationId);
			return recheckMemberDiscordDmAction({ installationId });
		},
		onSuccess: (result) => {
			if (result.success) {
				void queryClient.invalidateQueries({ queryKey: chatLinksQueryKey });
			}
		},
		onSettled: () => {
			setRecheckingDiscordInstallationId(null);
		},
	});

	const unlinkMutation = useMutation({
		mutationFn: async (input: { provider: ChatInstallationProvider; installationId?: string }) => {
			setUnlinkingProvider(input.provider);
			return unlinkMemberChatAccount(input);
		},
		onSuccess: (result, variables) => {
			if (!result.success) return;
			setGeneratedCodes((prev) => {
				const next = { ...prev };
				for (const key of Object.keys(next)) {
					if (key.startsWith(`${variables.provider}:member_link:`)) {
						delete next[key];
					}
				}
				return next;
			});
			void queryClient.invalidateQueries({ queryKey: chatLinksQueryKey });
		},
		onSettled: () => {
			setUnlinkingProvider(null);
		},
	});

	const snapshot = activeOrganizationId ? (data ?? EMPTY_SNAPSHOT) : EMPTY_SNAPSHOT;

	return {
		hasOrganizationContext:
			Boolean(activeOrganizationId) && (Boolean(error) || snapshot.hasOrganizationContext),
		channels: snapshot.channels,
		isLoading: Boolean(activeOrganizationId) && isLoading,
		error: error instanceof Error ? error : error ? new Error(String(error)) : null,
		refetch,
		isRetrying: isRefetching,
		generatedCodes,
		generatingCodeKey,
		generateLinkCodeAsync: generateLinkCodeMutation.mutateAsync,
		recheckingDiscordInstallationId,
		recheckDiscordDmAsync: recheckDiscordDmMutation.mutateAsync,
		unlinkAccountAsync: unlinkMutation.mutateAsync,
		unlinkingProvider,
	};
}
