"use client";

import { SlackPrepareTestPanel } from "@/components/settings/slack-prepare-test-panel";
import type { SlackCandidateSetupView } from "@/lib/chat-installations/slack-setup";
import {
	getSlackCandidateSetup,
	prepareSlackCandidate,
	saveAndVerifySlackCandidateCredentials,
	sendSlackCandidatePrivateTest,
} from "./slack-setup-actions";

export interface SlackPrepareTestSectionProps {
	initialSetup: SlackCandidateSetupView | null;
}

export function SlackPrepareTestSection({ initialSetup }: SlackPrepareTestSectionProps) {
	return (
		<SlackPrepareTestPanel
			initialSetup={initialSetup}
			prepareAction={() => prepareSlackCandidate()}
			refreshAction={() => getSlackCandidateSetup()}
			saveCredentialsAction={(input) => saveAndVerifySlackCandidateCredentials(input)}
			sendPrivateTestAction={(input) => sendSlackCandidatePrivateTest(input)}
		/>
	);
}
