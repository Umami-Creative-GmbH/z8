"use client";

import { ChatInstallationInventoryCard } from "@/components/settings/chat-installation-inventory-card";
import type {
	ChatInstallationProvider,
	ChatProviderInventory,
} from "@/lib/chat-installations/types";
import { getProviderChatInstallationInventory } from "./actions";

export interface ChatInstallationInventoryPanelProps {
	provider: ChatInstallationProvider;
	channelName: string;
	initialInventory: ChatProviderInventory | null;
	initialLoadFailed?: boolean;
}

export function ChatInstallationInventoryPanel({
	provider,
	channelName,
	initialInventory,
	initialLoadFailed = false,
}: ChatInstallationInventoryPanelProps) {
	return (
		<ChatInstallationInventoryCard
			provider={provider}
			channelName={channelName}
			initialInventory={initialInventory}
			initialLoadFailed={initialLoadFailed}
			retryAction={() => getProviderChatInstallationInventory({ provider })}
		/>
	);
}
