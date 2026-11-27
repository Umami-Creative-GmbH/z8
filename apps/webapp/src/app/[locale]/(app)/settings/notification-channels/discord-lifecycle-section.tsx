"use client";

import { DiscordLifecyclePanel } from "@/components/settings/discord-lifecycle-panel";
import {
	confirmDiscordInstallationRestore,
	confirmDiscordInstallationSwitch,
	type DiscordLifecycleState,
	getDiscordLifecycleState,
	prepareDiscordCandidate,
	prepareDiscordInstallationRestore,
	retryDiscordCandidateCommands,
	revokeDiscordInstallationAction,
	rotateDiscordInstallationCredentialsAction,
	saveAndVerifyDiscordCandidateCredentials,
	sendDiscordCandidatePrivateTest,
} from "./discord-lifecycle-actions";

export interface DiscordLifecycleSectionProps {
	initialState: DiscordLifecycleState | null;
}

export function DiscordLifecycleSection({ initialState }: DiscordLifecycleSectionProps) {
	return (
		<DiscordLifecyclePanel
			initialState={initialState}
			refreshAction={() => getDiscordLifecycleState()}
			prepareAction={() => prepareDiscordCandidate()}
			saveCredentialsAction={(input) => saveAndVerifyDiscordCandidateCredentials(input)}
			retryCommandsAction={(input) => retryDiscordCandidateCommands(input)}
			sendPrivateTestAction={(input) => sendDiscordCandidatePrivateTest(input)}
			confirmSwitchAction={(input) => confirmDiscordInstallationSwitch(input)}
			rotateCredentialsAction={(input) => rotateDiscordInstallationCredentialsAction(input)}
			revokeInstallationAction={(input) => revokeDiscordInstallationAction(input)}
			prepareRestoreAction={(input) => prepareDiscordInstallationRestore(input)}
			confirmRestoreAction={(input) => confirmDiscordInstallationRestore(input)}
		/>
	);
}
