"use client";

import { IconAlertTriangle, IconHome, IconRefresh } from "@tabler/icons-react";
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
	useEffect(() => {
		// Log the error to console in development
		console.error("Settings error:", error);
	}, [error]);

	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
						<IconAlertTriangle className="size-6 text-destructive" />
					</div>
					<CardTitle>Something went wrong</CardTitle>
					<CardDescription>
						An error occurred while loading the settings page. This might be a temporary issue.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{error.message && (
						<div className="rounded-lg bg-muted p-3">
							<p className="text-sm font-mono text-muted-foreground">{error.message}</p>
							{error.digest && (
								<p className="mt-1 text-xs text-muted-foreground">Error ID: {error.digest}</p>
							)}
						</div>
					)}

					<div className="flex flex-col gap-2">
						<Button onClick={reset} className="w-full">
							<IconRefresh className="mr-2 size-4" />
							Try Again
						</Button>
						<Button variant="outline" asChild className="w-full">
							<Link href="/settings">
								<IconHome className="mr-2 size-4" />
								Back to Settings
							</Link>
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
