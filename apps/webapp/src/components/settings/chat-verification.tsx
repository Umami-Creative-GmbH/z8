import {
	IconAlertTriangle,
	IconArrowsExchange,
	IconCheck,
	IconClockExclamation,
	IconLoader2,
	IconRefresh,
} from "@tabler/icons-react";
import type { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const stepMessages = {
	slack: {
		passed: ["settings.slack.orgOwned.status.passed", "Passed"],
		failed: ["settings.slack.orgOwned.status.failed", "Action needed"],
		expired: ["settings.slack.orgOwned.status.expired", "Expired"],
		pending: ["settings.slack.orgOwned.status.pending", "Pending"],
		stepExpiredAt: [
			"settings.slack.orgOwned.stepExpiredAt",
			"Previously verified at {timestamp}. Proof has expired and must be refreshed.",
		],
		stepVerifiedAt: ["settings.slack.orgOwned.stepVerifiedAt", "Verified: {timestamp}"],
		stepFailureCode: [
			"settings.slack.orgOwned.stepFailureCode",
			"Last verification check failed ({code}). Fix the step and retry.",
		],
	},
	teams: {
		passed: ["settings.teamsPrepare.status.passed", "Passed"],
		failed: ["settings.teamsPrepare.status.failed", "Action needed"],
		expired: ["settings.teamsPrepare.status.expired", "Expired"],
		pending: ["settings.teamsPrepare.status.pending", "Pending"],
		stepExpiredAt: [
			"settings.teamsPrepare.stepExpiredAt",
			"Previously verified at {timestamp}. Proof has expired and must be refreshed.",
		],
		stepVerifiedAt: ["settings.teamsPrepare.stepVerifiedAt", "Verified: {timestamp}"],
		stepFailureCode: [
			"settings.teamsPrepare.stepFailureCode",
			"Last verification check failed ({code}). Fix the step and retry.",
		],
	},
} as const;

function translateStep(
	t: ReturnType<typeof useTranslate>["t"],
	[key, fallback]: readonly [string, string],
	params?: Record<string, string>,
) {
	return t(key, fallback, params);
}

interface VerificationStep {
	status: "passed" | "failed" | "expired" | "pending";
	verifiedAt: string | null;
	detail: string | null;
	failureCode: string | null;
}
function StepStatusBadge({
	status,
	provider,
	t,
}: {
	status: VerificationStep["status"];
	provider: "slack" | "teams";
	t: ReturnType<typeof useTranslate>["t"];
}) {
	switch (status) {
		case "passed":
			return (
				<Badge variant="default" className="w-fit shrink-0 gap-1">
					<IconCheck className="size-3.5" aria-hidden="true" />
					{translateStep(t, stepMessages[provider].passed)}
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="destructive" className="w-fit shrink-0 gap-1">
					<IconAlertTriangle className="size-3.5" aria-hidden="true" />
					{translateStep(t, stepMessages[provider].failed)}
				</Badge>
			);
		case "expired":
			return (
				<Badge variant="outline" className="w-fit shrink-0 gap-1 border-warning/60 text-warning">
					<IconClockExclamation className="size-3.5" aria-hidden="true" />
					{translateStep(t, stepMessages[provider].expired)}
				</Badge>
			);
		case "pending":
			return (
				<Badge variant="secondary" className="w-fit shrink-0">
					{translateStep(t, stepMessages[provider].pending)}
				</Badge>
			);
	}
}

export function VerificationStepRow({
	title,
	description,
	step,
	provider,
	action,
	t,
}: {
	title: string;
	description: string;
	step: VerificationStep;
	action?: React.ReactNode;
	provider: "slack" | "teams";
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<li className="min-w-0 space-y-2 rounded-lg border bg-background p-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0 space-y-0.5">
					<p className="break-words text-sm font-medium">{title}</p>
					<p className="break-words text-xs text-muted-foreground">{description}</p>
				</div>
				<StepStatusBadge provider={provider} status={step.status} t={t} />
			</div>
			{step.verifiedAt ? (
				<p className="break-words text-xs text-muted-foreground">
					{step.status === "expired"
						? translateStep(t, stepMessages[provider].stepExpiredAt, { timestamp: step.verifiedAt })
						: translateStep(t, stepMessages[provider].stepVerifiedAt, {
								timestamp: step.verifiedAt,
							})}
					{step.detail ? ` · ${step.detail}` : ""}
				</p>
			) : null}
			{step.status === "failed" && step.failureCode ? (
				<p role="alert" className="break-words text-xs text-destructive">
					{translateStep(t, stepMessages[provider].stepFailureCode, { code: step.failureCode })}
				</p>
			) : null}
			{action ? <div className="pt-1">{action}</div> : null}
		</li>
	);
}

export function VerificationHeading({
	headingId,
	title,
	description,
	refreshLabel,
	pending,
	onRefresh,
}: {
	headingId: string;
	title: string;
	description: string;
	refreshLabel: string;
	pending: boolean;
	onRefresh: () => void;
}) {
	return (
		<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0 space-y-1">
				<h3 id={headingId} className="text-sm font-semibold">
					{title}
				</h3>
				<p className="text-xs text-muted-foreground">{description}</p>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-fit shrink-0"
				disabled={pending}
				onClick={onRefresh}
			>
				{pending ? (
					<IconLoader2 className="mr-1.5 size-4 motion-safe:animate-spin" aria-hidden="true" />
				) : (
					<IconRefresh className="mr-1.5 size-4" aria-hidden="true" />
				)}
				{refreshLabel}
			</Button>
		</div>
	);
}
export function SwitchReviewHeader({
	title,
	description,
	enabled,
	gateLabel,
	refreshLabel,
	pending,
	onRefresh,
}: {
	title: string;
	description: string;
	enabled: boolean;
	gateLabel: string;
	refreshLabel: string;
	pending: boolean;
	onRefresh: () => void;
}) {
	return (
		<CardHeader>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0 space-y-1">
					<CardTitle className="flex items-center gap-2 text-base">
						<IconArrowsExchange className="size-4 shrink-0" aria-hidden="true" />
						{title}
					</CardTitle>
					<CardDescription>{description}</CardDescription>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={enabled ? "default" : "secondary"} className="w-fit shrink-0">
						{gateLabel}
					</Badge>
					<Button type="button" variant="outline" size="sm" disabled={pending} onClick={onRefresh}>
						{pending ? (
							<IconLoader2 className="mr-1.5 size-4 motion-safe:animate-spin" aria-hidden="true" />
						) : (
							<IconRefresh className="mr-1.5 size-4" aria-hidden="true" />
						)}
						{refreshLabel}
					</Button>
				</div>
			</div>
		</CardHeader>
	);
}
