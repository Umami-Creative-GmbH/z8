"use client";

import { SlackSwitchReviewPanel } from "@/components/settings/slack-switch-review-panel";
import type { ChatSwitchImpactPreview } from "@/lib/chat-installations/switch-lifecycle";
import {
	confirmSlackInstallationSwitch,
	getSlackSwitchImpactPreview,
} from "./slack-switch-actions";

export interface SlackSwitchReviewSectionProps {
	initialPreview: ChatSwitchImpactPreview | null;
}

export function SlackSwitchReviewSection({ initialPreview }: SlackSwitchReviewSectionProps) {
	return (
		<SlackSwitchReviewPanel
			initialPreview={initialPreview}
			refreshPreviewAction={() => getSlackSwitchImpactPreview()}
			confirmSwitchAction={(input) => confirmSlackInstallationSwitch(input)}
		/>
	);
}
