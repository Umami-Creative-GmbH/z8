"use client";

import { TeamsSwitchReviewPanel } from "@/components/settings/teams-switch-review-panel";
import type { TeamsSwitchImpactPreview } from "@/lib/chat-installations/teams-switch";
import {
	confirmTeamsRestore,
	confirmTeamsSwitch,
	getTeamsSwitchImpactPreview,
	prepareTeamsRestore,
	revokeTeamsTenant,
	rotateTeamsCredentials,
	verifyTeamsRestore,
} from "./teams-switch-actions";

export interface TeamsSwitchReviewSectionProps {
	initialPreview: TeamsSwitchImpactPreview | null;
}

export function TeamsSwitchReviewSection({ initialPreview }: TeamsSwitchReviewSectionProps) {
	return (
		<TeamsSwitchReviewPanel
			initialPreview={initialPreview}
			refreshPreviewAction={() => getTeamsSwitchImpactPreview()}
			confirmSwitchAction={(input) => confirmTeamsSwitch(input)}
			revokeTenantAction={(input) => revokeTeamsTenant(input)}
			rotateCredentialsAction={(input) => rotateTeamsCredentials(input)}
			prepareRestoreAction={(input) => prepareTeamsRestore(input)}
			verifyRestoreAction={(input) => verifyTeamsRestore(input)}
			confirmRestoreAction={(input) => confirmTeamsRestore(input)}
		/>
	);
}
