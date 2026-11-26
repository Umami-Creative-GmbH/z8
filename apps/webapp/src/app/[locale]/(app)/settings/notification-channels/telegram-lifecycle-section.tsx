"use client";

import { TelegramLifecyclePanel } from "@/components/settings/telegram-lifecycle-panel";
import {
	confirmTelegramInstallationSwitch,
	confirmTelegramRestore,
	getTelegramLifecycleState,
	prepareTelegramCandidate,
	prepareTelegramRestore,
	retryTelegramCandidateCommands,
	retryTelegramCandidateWebhook,
	revokeTelegramInstallation,
	rotateTelegramCredentials,
	saveTelegramCandidateCredentials,
	sendTelegramCandidatePrivateTest,
	type TelegramLifecycleState,
} from "./telegram-lifecycle-actions";

export function TelegramLifecycleSection({
	initialState,
}: {
	initialState: TelegramLifecycleState | null;
}) {
	return (
		<TelegramLifecyclePanel
			initialState={initialState}
			refreshAction={getTelegramLifecycleState}
			prepareAction={prepareTelegramCandidate}
			saveCredentialsAction={saveTelegramCandidateCredentials}
			retryWebhookAction={retryTelegramCandidateWebhook}
			retryCommandsAction={retryTelegramCandidateCommands}
			sendPrivateTestAction={sendTelegramCandidatePrivateTest}
			confirmSwitchAction={confirmTelegramInstallationSwitch}
			rotateCredentialsAction={rotateTelegramCredentials}
			revokeAction={revokeTelegramInstallation}
			prepareRestoreAction={prepareTelegramRestore}
			confirmRestoreAction={confirmTelegramRestore}
		/>
	);
}
