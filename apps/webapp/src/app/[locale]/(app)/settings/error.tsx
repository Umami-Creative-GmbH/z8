"use client";

import { IconAlertTriangle, IconHome, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
		// Log the error to console in development
		console.error("Settings error:", error);
	}, [error]);

	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
						<IconAlertTriangle aria-hidden="true" className="size-6 text-destructive" />
					</div>
					<CardTitle>{t("settings.error.title", "Something went wrong")}</CardTitle>
					<CardDescription>
						{t(
							"settings.error.description",
							"An error occurred while loading the settings page. This might be a temporary issue.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{error.message && (
						<div className="rounded-lg bg-muted p-3">
							<p className="text-sm font-mono text-muted-foreground">{error.message}</p>
							{error.digest && (
								<p className="mt-1 text-xs text-muted-foreground">
									{t("settings.error.errorId", "Error ID: {{digest}}", { digest: error.digest })}
								</p>
							)}
						</div>
					)}

					<div className="flex flex-col gap-2">
						<Button onClick={reset} className="w-full">
							<IconRefresh aria-hidden="true" className="mr-2 size-4" />
							{t("settings.error.actions.tryAgain", "Try Again")}
						</Button>
						<Button variant="outline" asChild className="w-full">
							<Link href="/settings">
								<IconHome aria-hidden="true" className="mr-2 size-4" />
								{t("settings.error.actions.backToSettings", "Back to Settings")}
							</Link>
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
