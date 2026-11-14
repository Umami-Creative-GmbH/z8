"use client";

import { IconHome } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { AppErrorState } from "@/components/errors/app-error-state";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";

export default function SettingsError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const { t } = useTranslate();
	useEffect(() => {
		console.error("Settings error:", error);
	}, [error]);
	return (
		<AppErrorState
			variant="error"
			headingLevel={2}
			titleKey="settings.error.title"
			titleDefault="Something went wrong"
			descriptionKey="settings.error.description"
			descriptionDefault="An error occurred while loading the settings page. This might be a temporary issue."
			digest={error.digest}
			onRetry={reset}
			actions={
				<Button asChild variant="outline">
					<Link href="/settings">
						<IconHome aria-hidden="true" />
						{t("settings.error.actions.backToSettings", "Back to Settings")}
					</Link>
				</Button>
			}
		/>
	);
}
