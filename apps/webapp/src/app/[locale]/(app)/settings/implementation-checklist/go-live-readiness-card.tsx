"use client";

import {
	IconAlertTriangle,
	IconCircleCheck,
	IconCloudOff,
	IconLoader2,
	IconRefresh,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import type { GoLiveReadiness } from "@/lib/implementation-checklist/go-live/types";
import { cn } from "@/lib/utils";
import { useRouter } from "@/navigation";

export interface GoLiveReadinessView {
	readiness: GoLiveReadiness;
	checkedAt: string;
}

/** Overall go-live readiness: ready, not ready with the affected count, or unavailable with a retry. */
export function GoLiveReadinessCard({ goLive }: { goLive: GoLiveReadinessView }) {
	const { t } = useTranslate();
	const router = useRouter();
	const displayContext = useDisplayContext();
	const [isRetrying, startRetry] = useTransition();
	const { readiness } = goLive;
	const Icon =
		readiness.status === "ready"
			? IconCircleCheck
			: readiness.status === "not-ready"
				? IconAlertTriangle
				: IconCloudOff;

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2 className="font-semibold text-base">
						{t("settings.implementationChecklist.goLive.title", "Go-live readiness")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"settings.implementationChecklist.goLive.groupDescription",
						"Worked out from the mandatory go-live checks for everyone in the go-live group each time you open this page.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<p
						className={cn(
							"flex items-center gap-2 font-semibold",
							readiness.status === "ready" && "text-primary",
							readiness.status === "not-ready" && "text-destructive",
						)}
					>
						<Icon aria-hidden="true" className="size-5 shrink-0" />
						{readiness.status === "ready"
							? t("settings.implementationChecklist.goLive.readiness.ready", "Ready to go live")
							: null}
						{readiness.status === "not-ready"
							? t(
									"settings.implementationChecklist.goLive.readiness.notReady",
									"Not ready: {count, plural, one {# employee needs} other {# employees need}} attention",
									{ count: readiness.affectedMemberCount },
								)
							: null}
						{readiness.status === "unavailable"
							? t(
									"settings.implementationChecklist.goLive.readiness.unavailable",
									"Unavailable: a check could not be completed, so nothing counts as passed.",
								)
							: null}
					</p>
					{readiness.status === "unavailable" ? (
						<Button
							disabled={isRetrying}
							onClick={() => startRetry(() => router.refresh())}
							size="sm"
							type="button"
							variant="outline"
						>
							{isRetrying ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : (
								<IconRefresh aria-hidden="true" className="size-4" />
							)}
							{t("settings.implementationChecklist.goLive.retry", "Retry checks")}
						</Button>
					) : null}
				</div>
				<p className="text-muted-foreground text-sm">
					{t("settings.implementationChecklist.goLive.checkedAt", "Checked {time}", {
						time: formatInstant(parseInstant(goLive.checkedAt), displayContext, "dateTimeMedium"),
					})}
				</p>
				{readiness.status !== "unavailable" && readiness.warnings.length ? (
					<p className="text-muted-foreground text-sm">
						{t(
							"settings.implementationChecklist.goLive.warnings",
							"{count, plural, one {# advisory warning} other {# advisory warnings}} below. They don't block going live.",
							{ count: readiness.warnings.length },
						)}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
