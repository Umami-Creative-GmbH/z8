"use client";

import { AppErrorState } from "@/components/errors/app-error-state";
import { AllLocationsLink } from "./all-locations-link";

export default function LocationPresenceNotFound() {
	return (
		<AppErrorState
			variant="not-found"
			recovery="workspace"
			titleKey="team.presence.locationUnavailable"
			titleDefault="Location unavailable"
			descriptionKey="team.presence.locationUnavailableDescription"
			descriptionDefault="This location isn't available in your current organization. Choose an active location to view presence."
			actions={<AllLocationsLink />}
		/>
	);
}
