"use client";

import {
	IconCircleCheck,
	IconCircleDashed,
	IconCloudOff,
	IconLoader2,
	IconRefresh,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import type {
	FirstWorkflowEvidence,
	FirstWorkflowEvidenceLine,
} from "@/lib/implementation-checklist/go-live/first-workflows";
import { useRouter } from "@/navigation";

interface FirstWorkflowsPanelProps {
	evidence: FirstWorkflowEvidence;
	/**
	 * Slot for the go-live rehearsal (#1517), shown under the evidence lines.
	 * The First workflows item is where the rehearsal lives.
	 */
	rehearsal?: ReactNode;
}

/** First-workflow evidence: three lines, each with when and who, or "not yet". */
export function FirstWorkflowsPanel({ evidence, rehearsal }: FirstWorkflowsPanelProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isRetrying, startRetry] = useTransition();
	const lines = [
		{
			id: "clock-in",
			label: t("settings.implementationChecklist.firstWorkflows.clockIn", "First clock-in"),
			line: evidence.clockIn,
		},
		{
			id: "decided-approval",
			label: t(
				"settings.implementationChecklist.firstWorkflows.decidedApproval",
				"First decided request",
			),
			line: evidence.decidedApproval,
		},
		{
			id: "payroll-export",
			label: t(
				"settings.implementationChecklist.firstWorkflows.payrollExport",
				"First successful payroll export",
			),
			line: evidence.payrollExport,
		},
	];
	const anyUnavailable = lines.some(({ line }) => line.state === "unavailable");

	return (
		<div className="space-y-4">
			<dl className="divide-y rounded-md border">
				{lines.map(({ id, label, line }) => (
					<div
						key={id}
						className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
					>
						<dt className="font-medium text-sm">{label}</dt>
						<dd className="text-sm">
							<EvidenceValue line={line} />
						</dd>
					</div>
				))}
			</dl>
			{anyUnavailable ? (
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
					{t("settings.implementationChecklist.firstWorkflows.retry", "Check again")}
				</Button>
			) : null}
			{rehearsal ? <div data-slot="go-live-rehearsal">{rehearsal}</div> : null}
		</div>
	);
}

function EvidenceValue({ line }: { line: FirstWorkflowEvidenceLine }) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();

	if (line.state === "unavailable") {
		return (
			<span className="flex items-center gap-2 text-muted-foreground">
				<IconCloudOff aria-hidden="true" className="size-4 shrink-0" />
				{t("settings.implementationChecklist.firstWorkflows.unavailable", "Couldn't be checked")}
			</span>
		);
	}

	if (line.state === "not-yet") {
		return (
			<span className="flex items-center gap-2 text-muted-foreground">
				<IconCircleDashed aria-hidden="true" className="size-4 shrink-0" />
				{t("settings.implementationChecklist.firstWorkflows.notYet", "Not yet")}
			</span>
		);
	}

	return (
		<span className="flex flex-wrap items-center gap-2">
			<IconCircleCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
			<span>
				{t("settings.implementationChecklist.firstWorkflows.seen", "{time} by {name}", {
					time: formatInstant(parseInstant(line.at), displayContext, "dateTimeMedium"),
					name: line.actor.displayName,
				})}
			</span>
			{line.actor.former ? (
				<Badge variant="outline">
					{t("settings.implementationChecklist.firstWorkflows.former", "Former employee")}
				</Badge>
			) : null}
		</span>
	);
}
