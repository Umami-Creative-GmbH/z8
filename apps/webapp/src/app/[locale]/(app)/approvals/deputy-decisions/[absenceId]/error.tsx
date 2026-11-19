"use client";

import { AppErrorState } from "@/components/errors/app-error-state";

export default function DeputyDecisionsError({
	error,
	retry,
}: {
	error: Error & { digest?: string };
	retry: () => void;
}) {
	return (
		<AppErrorState
			variant="error"
			recovery="workspace"
			titleKey="errors.unexpected.title"
			titleDefault="Something went wrong"
			descriptionKey="errors.unexpected.description"
			descriptionDefault="We couldn't load this page right now. Please try again or return to a safe place in the app."
			digest={error.digest}
			onRetry={retry}
		/>
	);
}
