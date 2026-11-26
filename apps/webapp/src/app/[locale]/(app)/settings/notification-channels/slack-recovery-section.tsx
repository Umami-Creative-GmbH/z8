"use client";

import { ChatInstallationRecoveryPanel } from "@/components/settings/chat-installation-recovery-panel";
import type { ChatInstallationRecoveryState } from "@/lib/chat-installations/recovery-lifecycle";
import {
	confirmSlackInstallationRestore,
	getSlackRecoveryState,
	prepareSlackInstallationRestore,
	revokeSlackInstallation,
	rotateSlackInstallationCredentials,
	verifySlackInstallationRestore,
} from "./recovery-actions";

export interface SlackRecoverySectionProps {
	initialState: ChatInstallationRecoveryState | null;
}

export function SlackRecoverySection({ initialState }: SlackRecoverySectionProps) {
	return (
		<ChatInstallationRecoveryPanel
			channelName="Slack"
			initialState={initialState}
			refreshStateAction={() => getSlackRecoveryState()}
			rotateCredentialsAction={(input) => rotateSlackInstallationCredentials(input)}
			revokeInstallationAction={(input) => revokeSlackInstallation(input)}
			prepareRestoreAction={(input) => prepareSlackInstallationRestore(input)}
			verifyRestoreAction={(input) => verifySlackInstallationRestore(input)}
			confirmRestoreAction={(input) => confirmSlackInstallationRestore(input)}
		/>
	);
}
