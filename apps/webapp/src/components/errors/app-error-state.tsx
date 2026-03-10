"use client";

import {
	IconAlertTriangle,
	IconArrowLeft,
	IconHome,
	IconRefresh,
	IconSettings,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Link, useRouter } from "@/navigation";

type AppErrorStateProps = {
	variant: "not-found" | "error";
	titleKey: string;
	titleDefault: string;
	descriptionKey: string;
	descriptionDefault: string;
	digest?: string;
	onRetry?: () => void;
};

export function AppErrorState({
	variant,
	titleKey,
	titleDefault,
	descriptionKey,
	descriptionDefault,
	digest,
	onRetry,
}: AppErrorStateProps) {
	const { t } = useTranslate();
	const router = useRouter();

	return (
		<div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 sm:px-6">
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-[radial-gradient(circle_at_top,oklch(0.93_0.05_265/.55),transparent_45%)]"
			/>
			<div
				aria-hidden="true"
				className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,transparent,oklch(0.96_0.01_260/.65))]"
			/>

			<Card className="relative w-full max-w-2xl border-border/70 bg-card/95 shadow-xl backdrop-blur-sm">
				<CardHeader className="space-y-4 text-center">
					<div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
						<IconAlertTriangle aria-hidden="true" className="size-8" />
					</div>
					<p className="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
						{variant === "not-found" ? "404" : t("common.error", "Error")}
					</p>
					<CardTitle className="text-balance text-3xl sm:text-4xl">
						{t(titleKey, titleDefault)}
					</CardTitle>
					<CardDescription className="mx-auto max-w-xl text-base leading-7">
						{t(descriptionKey, descriptionDefault)}
					</CardDescription>
				</CardHeader>

				<CardContent className="space-y-6">
					<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
						{variant === "error" && onRetry ? (
							<Button onClick={onRetry}>
								<IconRefresh aria-hidden="true" />
								{t("common.retry", "Retry")}
							</Button>
						) : null}

						<Button asChild>
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

						<Button onClick={() => router.back()} variant="ghost">
							<IconArrowLeft aria-hidden="true" />
							{t("common.back", "Back")}
						</Button>
					</div>

					{digest ? (
						<div className="rounded-xl border border-border/70 bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
							{t("errors.unexpected.digest", "Reference: {digest}", { digest })}
						</div>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
