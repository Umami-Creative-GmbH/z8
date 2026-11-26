"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	type GeneratedMemberLinkCode,
	generateMemberTelegramLinkCode,
	getMemberChatLinksAction,
	unlinkMemberChatAccount,
} from "@/app/[locale]/(app)/settings/notifications/chat-link-actions";
import type { ChatInstallationProvider } from "@/db/schema/chat-installations";
import { useSession } from "@/lib/auth-client";
import type { MemberChatLinksSnapshot } from "@/lib/chat-installations/member-links";
import { queryKeys } from "@/lib/query/keys";

const EMPTY_SNAPSHOT: MemberChatLinksSnapshot = {
	organizationId: null,
	hasOrganizationContext: false,
	channels: [],
};

export function useMemberChatLinks() {
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const userId = session?.user?.id ?? null;
	const activeOrganizationId = session?.session?.activeOrganizationId ?? null;
	const chatLinksQueryKey = queryKeys.notifications.chatLinks(userId, activeOrganizationId);
	const [generatedTelegramCode, setGeneratedTelegramCode] =
		useState<GeneratedMemberLinkCode | null>(null);
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
				throw new Error(result.error);
			}
			return result.data;
		},
	});

	const generateTelegramCodeMutation = useMutation({
		mutationFn: async () => {
			const result = await generateMemberTelegramLinkCode();
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		onSuccess: (generated) => {
			setGeneratedTelegramCode(generated);
		},
	});

	const unlinkMutation = useMutation({
		mutationFn: async (input: { provider: ChatInstallationProvider; installationId?: string }) => {
			setUnlinkingProvider(input.provider);
			const result = await unlinkMemberChatAccount(input);
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		onSuccess: (_data, variables) => {
			if (variables.provider === "telegram") {
				setGeneratedTelegramCode(null);
			}
			queryClient.invalidateQueries({ queryKey: chatLinksQueryKey });
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
		generatedTelegramCode,
		clearGeneratedTelegramCode: () => setGeneratedTelegramCode(null),
		generateTelegramCodeAsync: generateTelegramCodeMutation.mutateAsync,
		isGeneratingTelegramCode: generateTelegramCodeMutation.isPending,
		unlinkAccountAsync: unlinkMutation.mutateAsync,
		unlinkingProvider,
	};
}
