"use client";

import { TeamsPrepareTestPanel } from "@/components/settings/teams-prepare-test-panel";
import type { TeamsCandidateSetupView } from "@/lib/chat-installations/teams-app-package";
import {
	getTeamsCandidateSetup,
	prepareTeamsCandidate,
	saveTeamsCandidateCredentials,
	sendTeamsCandidateProactiveTest,
} from "./teams-setup-actions";

export interface TeamsPrepareTestSectionProps {
	initialSetup: TeamsCandidateSetupView | null;
}

export function TeamsPrepareTestSection({ initialSetup }: TeamsPrepareTestSectionProps) {
	return (
		<TeamsPrepareTestPanel
			initialSetup={initialSetup}
			prepareAction={() => prepareTeamsCandidate()}
			refreshAction={() => getTeamsCandidateSetup()}
			saveCredentialsAction={(input) => saveTeamsCandidateCredentials(input)}
			sendProactiveTestAction={(input) => sendTeamsCandidateProactiveTest(input)}
		/>
	);
}
