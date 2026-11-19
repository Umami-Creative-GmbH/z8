"use client";

import { IconHome } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { AppErrorState } from "@/components/errors/app-error-state";
import { Button } from "@/components/ui/button";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import { Link, usePathname } from "@/navigation";

export default function SettingsError({
	error,
	retry,
}: {
	error: Error & { digest?: string };
	retry: () => void;
}) {
	const { t } = useTranslate();
	const pathname = usePathname();
	useEffect(() => {
		console.error("Settings error:", error);
	}, [error]);
	return (
		<AppErrorState
			variant="error"
			// The shell renders the route title as a paragraph on pages that own their h1.
			headingLevel={appPageOwnsHeading(pathname) ? 1 : 2}
			titleKey="settings.error.title"
			titleDefault="Something went wrong"
			descriptionKey="settings.error.description"
			descriptionDefault="An error occurred while loading the settings page. This might be a temporary issue."
			digest={error.digest}
			onRetry={retry}
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
