"use client";

import { useEffect } from "react";
import { AppErrorState } from "@/components/errors/app-error-state";

export default function AdminError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Admin error:", error);
	}, [error]);
	return (
		<AppErrorState
			variant="error"
			recovery="admin"
			titleKey="errors.unexpected.title"
			titleDefault="Something went wrong"
			descriptionKey="errors.unexpected.description"
			descriptionDefault="We couldn't load this page right now. Please try again or return to a safe place in the app."
			digest={error.digest}
			onRetry={reset}
		/>
	);
}
