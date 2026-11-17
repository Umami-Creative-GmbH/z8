"use client";
import { AppErrorState } from "@/components/errors/app-error-state";

export default function DeveloperAccessError({ retry }: { retry: () => void }) {
	return (
		<AppErrorState
			variant="error"
			titleKey="settings.apiKeys.unavailableTitle"
			titleDefault="Developer Access unavailable"
			descriptionKey="settings.apiKeys.unavailableDescription"
			descriptionDefault="Your settings could not be loaded. Retry to refresh this page."
			onRetry={retry}
			recovery="workspace"
		/>
	);
}
