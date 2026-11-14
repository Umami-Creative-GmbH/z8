"use client";

import { useEffect } from "react";
import { AppErrorState } from "@/components/errors/app-error-state";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import { usePathname } from "@/navigation";

export default function WorkspaceError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const pathname = usePathname();
	useEffect(() => {
		console.error("Workspace error:", error);
	}, [error]);
	return (
		<AppErrorState
			variant="error"
			recovery="workspace"
			headingLevel={appPageOwnsHeading(pathname) ? 1 : 2}
			titleKey="errors.unexpected.title"
			titleDefault="Something went wrong"
			descriptionKey="errors.unexpected.description"
			descriptionDefault="We couldn't load this page right now. Please try again or return to a safe place in the app."
			digest={error.digest}
			onRetry={reset}
		/>
	);
}
