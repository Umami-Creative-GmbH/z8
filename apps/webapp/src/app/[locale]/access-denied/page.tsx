"use client";

import { IconLock, IconLogout } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { use } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "@/navigation";

const appTypeLabels: Record<string, string> = {
	webapp: "web application",
	desktop: "desktop application",
	mobile: "mobile application",
};

export default function AccessDeniedPage({
	searchParams,
}: {
	searchParams: Promise<{ app?: string }>;
}) {
	const params = use(searchParams);
	const { t } = useTranslate();
	const router = useRouter();
	const appType = params.app || "application";
	const appLabel = appTypeLabels[appType] || appType;

	async function handleSignOut() {
		await authClient.signOut();
		router.push("/sign-in");
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10">
						<IconLock className="size-8 text-destructive" aria-hidden="true" />
					</div>
					<CardTitle className="text-xl">{t("accessDenied.title", "Access Restricted")}</CardTitle>
					<CardDescription>
						{t(
							"accessDenied.description",
							"Your account does not have permission to access the {{appLabel}}.",
							{ appLabel },
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-center text-sm text-muted-foreground">
						{t(
							"accessDenied.contactAdmin",
							"Please contact your organization administrator to request access.",
						)}
					</p>
					<Button variant="outline" className="w-full" onClick={handleSignOut}>
						<IconLogout className="mr-2 size-4" aria-hidden="true" />
						{t("accessDenied.signOut", "Sign Out")}
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
