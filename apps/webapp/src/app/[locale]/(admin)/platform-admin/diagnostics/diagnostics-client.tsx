"use client";

import { IconAlertTriangle, IconCheck, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DiagnosticsItem, DiagnosticsStatus, PlatformDiagnosticsSnapshot } from "@/lib/platform-diagnostics";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { refreshPlatformDiagnosticsAction } from "./actions";

const statusLabels: Record<DiagnosticsStatus, string> = {
	healthy: "Healthy",
	warning: "Warning",
	error: "Error",
	disabled: "Disabled",
};

const statusStyles: Record<DiagnosticsStatus, string> = {
	healthy: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
	warning: "border-amber-500/40 text-amber-700 dark:text-amber-400",
	error: "border-red-500/40 text-red-700 dark:text-red-400",
	disabled: "border-muted-foreground/30 text-muted-foreground",
};

function StatusIcon({ status }: { status: DiagnosticsStatus }) {
	if (status === "healthy") {
		return <IconCheck className="size-3" aria-hidden="true" />;
	}

	if (status === "error") {
		return <IconX className="size-3" aria-hidden="true" />;
	}

	return <IconAlertTriangle className="size-3" aria-hidden="true" />;
}

function StatusBadge({ status, showLabel = true }: { status: DiagnosticsStatus; showLabel?: boolean }) {
	return (
		<Badge variant="outline" className={cn("capitalize", statusStyles[status])}>
			<StatusIcon status={status} />
			{showLabel ? statusLabels[status] : <span className="sr-only">{statusLabels[status]}</span>}
		</Badge>
	);
}

function DiagnosticsItemRow({ item }: { item: DiagnosticsItem }) {
	return (
		<div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0 space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<h3 className="text-sm font-medium">{item.title}</h3>
					<StatusBadge status={item.status} showLabel={false} />
				</div>
				{item.description ? <p className="break-words text-sm text-muted-foreground">{item.description}</p> : null}
				{item.actionHref && item.actionLabel ? (
					<Link href={item.actionHref} className="text-sm font-medium text-primary hover:underline">
						{item.actionLabel}
					</Link>
				) : null}
			</div>
			<div className="break-words font-mono text-sm text-muted-foreground sm:text-right">{item.value}</div>
		</div>
	);
}

function DiagnosticsSection({ title, description, items }: { title: string; description: string; items: DiagnosticsItem[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{items.map((item) => (
					<DiagnosticsItemRow key={item.title} item={item} />
				))}
			</CardContent>
		</Card>
	);
}

export function DiagnosticsClient({ initialSnapshot }: { initialSnapshot: PlatformDiagnosticsSnapshot }) {
	const [snapshot, setSnapshot] = useState<PlatformDiagnosticsSnapshot>(() => initialSnapshot);
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	function refreshDiagnostics() {
		setError(null);
		startTransition(async () => {
			const result = await refreshPlatformDiagnosticsAction();

			if (result.success) {
				setSnapshot(result.data);
				return;
			}

			setError(result.error);
		});
	}

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-2">
						<div className="flex flex-wrap items-center gap-3">
							<CardTitle>Deployment Diagnostics</CardTitle>
							<StatusBadge status={snapshot.overallStatus} />
						</div>
						<CardDescription>
							Safe platform configuration and app-level service health. Last refreshed {snapshot.fetchedAt}.
						</CardDescription>
						<p className="sr-only" role="status" aria-live="polite">
							Diagnostics status {statusLabels[snapshot.overallStatus]}. Last refreshed {snapshot.fetchedAt}.
						</p>
					</div>
					<Button onClick={refreshDiagnostics} disabled={isPending} aria-label="Refresh diagnostics">
						{isPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						)}
						Refresh diagnostics
					</Button>
				</CardHeader>
				{error ? (
					<CardContent>
						<div
							className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400"
							role="alert"
							aria-live="polite"
						>
							{error}
						</div>
					</CardContent>
				) : null}
			</Card>

			<div className="grid gap-6 xl:grid-cols-2">
				<DiagnosticsSection
					title="Platform Configuration"
					description="Safe deployment configuration states. Secret values are never shown."
					items={snapshot.configuration}
				/>
				<DiagnosticsSection
					title="Service Health"
					description="App-only checks for infrastructure dependencies used by the webapp."
					items={snapshot.health}
				/>
			</div>

			{snapshot.recommendedActions.length > 0 ? (
				<Card className="border-amber-500/30 bg-amber-500/5">
					<CardHeader>
						<CardTitle>Recommended Actions</CardTitle>
						<CardDescription>Resolve these items to return diagnostics to a healthy state.</CardDescription>
					</CardHeader>
					<CardContent>
						<ul className="space-y-2 text-sm">
							{snapshot.recommendedActions.map((action) => (
								<li key={action} className="flex gap-2">
									<IconAlertTriangle
										className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
										aria-hidden="true"
									/>
									<span>{action}</span>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}
