"use client";

import { AppErrorState } from "@/components/errors/app-error-state";
import { AllLocationsLink } from "./all-locations-link";

export default function LocationPresenceError({
	retry,
}: {
	error: Error & { digest?: string };
	retry: () => void;
}) {
	return (
		<AppErrorState
			variant="error"
			recovery="workspace"
			titleKey="team.presence.unavailable"
			titleDefault="Presence unavailable"
			descriptionKey="team.presence.loadFailed"
			descriptionDefault="We couldn't load this location's presence. Retry or choose a location again."
			onRetry={retry}
			actions={<AllLocationsLink />}
		/>
	);
}
