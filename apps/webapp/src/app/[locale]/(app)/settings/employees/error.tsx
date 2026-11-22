"use client";

import { IconHome } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { AppErrorState } from "@/components/errors/app-error-state";
import { Button } from "@/components/ui/button";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import { Link, usePathname } from "@/navigation";

export default function EmployeesError({
	error,
	retry,
	reset,
}: {
	error?: Error & { digest?: string };
	retry?: () => void;
	reset?: () => void;
}) {
	const { t } = useTranslate();
	const pathname = usePathname();
	useEffect(() => {
		if (error) {
			console.error("Employees settings error:", error);
		}
	}, [error]);
	return (
		<AppErrorState
			variant="error"
			headingLevel={appPageOwnsHeading(pathname) ? 1 : 2}
			titleKey="settings.employees.directory.loadFailed"
			titleDefault="Employee directory could not be loaded"
			descriptionKey="settings.error.description"
			descriptionDefault="An error occurred while loading the settings page. This might be a temporary issue."
			digest={error?.digest}
			onRetry={retry ?? reset}
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
