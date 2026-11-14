"use client";

import {
	IconAlertTriangle,
	IconArrowLeft,
	IconHome,
	IconRefresh,
	IconSettings,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
} from "@/components/ui/card";
import { pageSafeAreaPaddingClassName } from "@/components/ui/safe-area";
import { Link, useRouter } from "@/navigation";

type AppErrorStateProps = {
	variant: "not-found" | "error";
	titleKey: string;
	titleDefault: string;
	descriptionKey: string;
	descriptionDefault: string;
	digest?: string;
	onRetry?: () => void;
	/** The admitting shell chooses recovery; public failures never assume a session. */
	recovery?: "entry" | "workspace" | "admin";
	headingLevel?: 1 | 2;
	actions?: ReactNode;
};

export function AppErrorState({
	variant,
	titleKey,
	titleDefault,
	descriptionKey,
	descriptionDefault,
	digest,
	onRetry,
	recovery = "entry",
	headingLevel = 1,
	actions,
}: AppErrorStateProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const Heading = headingLevel === 1 ? "h1" : "h2";

	return (
		<div
			className={`flex min-h-full flex-1 items-center justify-center bg-background px-4 sm:px-6 ${pageSafeAreaPaddingClassName}`}
		>
			<Card className="my-6 w-full max-w-2xl shadow-none">
				<CardHeader className="space-y-3">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconAlertTriangle aria-hidden="true" className="size-5 shrink-0" />
						{variant === "not-found" ? "404" : t("common.error", "Error")}
					</div>
					<Heading className="text-balance text-2xl font-semibold tracking-tight">
						{t(titleKey, titleDefault)}
					</Heading>
					<CardDescription className="text-pretty text-sm leading-relaxed">
						{t(descriptionKey, descriptionDefault)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-wrap gap-2">
						{variant === "error" && onRetry ? (
							<Button onClick={onRetry}>
								<IconRefresh aria-hidden="true" />
								{t("common.retry", "Retry")}
							</Button>
						) : null}
						{actions ??
							(recovery === "workspace" ? (
								<>
									<Button asChild variant="outline">
										<Link href="/">
											<IconHome aria-hidden="true" />
											{t("common.goToDashboard", "Go to Dashboard")}
										</Link>
									</Button>
									<Button asChild variant="outline">
										<Link href="/settings">
											<IconSettings aria-hidden="true" />
											{t("nav.settings", "Settings")}
										</Link>
									</Button>
								</>
							) : recovery === "admin" ? (
								<Button asChild variant="outline">
									<Link href="/platform-admin">
										<IconHome aria-hidden="true" />
										{t("admin:admin.layout.title", "Admin Console")}
									</Link>
								</Button>
							) : (
								<Button asChild variant="outline">
									<Link href="/sign-in">{t("auth.sign-in", "Sign in")}</Link>
								</Button>
							))}
						<Button onClick={() => router.back()} variant="ghost">
							<IconArrowLeft aria-hidden="true" />
							{t("common.back", "Back")}
						</Button>
					</div>
					{digest ? (
						<p className="break-words rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
							{t("errors.unexpected.digest", "Reference: {digest}", { digest })}
						</p>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
