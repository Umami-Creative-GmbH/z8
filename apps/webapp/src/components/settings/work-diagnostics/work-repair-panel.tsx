"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type {
	GapHoldReason,
	GapRepairFill,
	HistoricalGapRepairPlan,
	RepairOriginalActor,
} from "@/lib/time-tracking/historical-gap-repair";
import { useRouter } from "@/navigation";

type Translate = ReturnType<typeof useTranslate>["t"];

export interface WorkRepairPanelProps {
	plan: HistoricalGapRepairPlan;
	/** Whether the organization has separately authorized repair. */
	authorized: boolean;
	period: { startDate: string; endDate: string };
	selectedEmployeeId: string | null;
	employeeLabels: Record<string, string>;
}

type RepairOutcome = {
	employeeId: string;
	status: "applied" | "already_applied" | "stale";
	receipts?: { workPeriodId: string }[];
};

type SubmitState =
	| { kind: "idle" }
	| { kind: "done"; outcomes: RepairOutcome[] }
	| { kind: "error"; message: string };

function fillLabel(kind: GapRepairFill["kind"], t: Translate): string {
	switch (kind) {
		case "canonical_record":
			return t("settings.workDiagnostics.repair.fill.canonicalRecord", "Create time record");
		case "canonical_link":
			return t("settings.workDiagnostics.repair.fill.canonicalLink", "Link time record");
		case "canonical_detail":
			return t("settings.workDiagnostics.repair.fill.canonicalDetail", "Restore work detail");
		case "canonical_completion":
			return t("settings.workDiagnostics.repair.fill.canonicalCompletion", "Complete time record");
		case "canonical_duration":
			return t("settings.workDiagnostics.repair.fill.canonicalDuration", "Copy minutes to record");
		case "period_completion":
			return t("settings.workDiagnostics.repair.fill.periodCompletion", "Complete work period");
		case "period_duration":
			return t("settings.workDiagnostics.repair.fill.periodDuration", "Copy minutes to period");
		case "canonical_metadata":
			return t("settings.workDiagnostics.repair.fill.canonicalMetadata", "Restore metadata");
	}
}

function holdLabel(reason: GapHoldReason, t: Translate): string {
	switch (reason) {
		case "conflicting_evidence":
			return t(
				"settings.workDiagnostics.repair.hold.conflictingEvidence",
				"Other evidence on this work conflicts; needs review",
			);
		case "no_restorable_evidence":
			return t(
				"settings.workDiagnostics.repair.hold.noRestorableEvidence",
				"No evidence establishes the missing value",
			);
		case "original_rule_unknown":
			return t(
				"settings.workDiagnostics.repair.hold.originalRuleUnknown",
				"No representation holds the minutes; the original rounding is unknown",
			);
		case "original_actor_unrepresentable":
			return t(
				"settings.workDiagnostics.repair.hold.originalActorUnrepresentable",
				"No entry names who completed the work",
			);
		case "active_work":
			return t("settings.workDiagnostics.repair.hold.activeWork", "Work is still active");
		case "reference_outside_organization":
			return t(
				"settings.workDiagnostics.repair.hold.referenceOutsideOrganization",
				"A referenced project or category is not this organization's",
			);
	}
}

function actorLabel(actor: RepairOriginalActor, t: Translate): string {
	return actor.kind === "human"
		? t("settings.workDiagnostics.repair.actor.completingEntry", "Author of the clock-out entry")
		: t("settings.workDiagnostics.repair.actor.unknown", "Unknown (historical)");
}

export function WorkRepairPanel({
	plan,
	authorized,
	period,
	selectedEmployeeId,
	employeeLabels,
}: WorkRepairPanelProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [state, setState] = useState<SubmitState>({ kind: "idle" });
	const units = plan.employees.flatMap((employee) => employee.units);
	const employeeLabel = (employeeId: string) => employeeLabels[employeeId] ?? employeeId;

	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			try {
				const response = await fetch("/api/time-entries/diagnostics/repair", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						action: "apply",
						startDate: period.startDate,
						endDate: period.endDate,
						employeeId: selectedEmployeeId,
						expected: plan.employees.map(({ employeeId, fingerprint }) => ({
							employeeId,
							fingerprint,
						})),
						reason: value.reason.trim(),
					}),
				});
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					setState({
						kind: "error",
						message:
							body?.code === "repair_not_authorized"
								? t(
										"settings.workDiagnostics.repair.notAuthorized",
										"Repair has not been authorized for this organization.",
									)
								: t("settings.workDiagnostics.repair.failed", "The repair could not be applied."),
					});
					return;
				}
				setState({ kind: "done", outcomes: body.outcomes });
				router.refresh();
			} catch {
				setState({
					kind: "error",
					message: t("settings.workDiagnostics.repair.failed", "The repair could not be applied."),
				});
			}
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					{t("settings.workDiagnostics.repair.title", "Historical gap repair")}
					<Badge variant={authorized ? "secondary" : "outline"}>
						{authorized
							? t("settings.workDiagnostics.repair.authorized", "Authorized")
							: t("settings.workDiagnostics.repair.inactive", "Not authorized")}
					</Badge>
				</CardTitle>
				<CardDescription>
					{t(
						"settings.workDiagnostics.repair.description",
						"Fills only values that other evidence of the same work establishes uniquely. Identity, stored minutes, metadata, deletions and approval history are kept. Conflicts and gaps without evidence stay held for review.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{units.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.workDiagnostics.repair.empty",
							"No historical gap in this scope can be repaired from evidence.",
						)}
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.workDiagnostics.repair.employee", "Employee")}</TableHead>
								<TableHead>{t("settings.workDiagnostics.repair.work", "Work period")}</TableHead>
								<TableHead>{t("settings.workDiagnostics.repair.fills", "Repairs")}</TableHead>
								<TableHead>
									{t("settings.workDiagnostics.repair.originalActor", "Original actor")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{units.map((unit) => (
								<TableRow key={unit.workPeriodId}>
									<TableCell>{employeeLabel(unit.employeeId)}</TableCell>
									<TableCell className="font-mono text-xs">{unit.workPeriodId}</TableCell>
									<TableCell>
										<div className="flex flex-wrap gap-1">
											{unit.fills.map((fill) => (
												<Badge key={`${fill.kind}:${fill.findingId}`} variant="outline">
													{fillLabel(fill.kind, t)}
												</Badge>
											))}
										</div>
									</TableCell>
									<TableCell>{actorLabel(unit.originalActor, t)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}

				{plan.held.length > 0 ? (
					<div className="space-y-2">
						<h3 className="text-sm font-medium">
							{t("settings.workDiagnostics.repair.heldTitle", "Held for review")}
						</h3>
						<ul className="space-y-1 text-sm">
							{plan.held.map((gap) => (
								<li key={gap.findingId} className="flex flex-wrap gap-2">
									<span className="font-mono text-xs">{gap.kind}</span>
									<span className="text-muted-foreground">{holdLabel(gap.reason, t)}</span>
								</li>
							))}
						</ul>
					</div>
				) : null}

				{units.length > 0 ? (
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							form.handleSubmit();
						}}
					>
						{!authorized ? (
							<p className="text-sm text-muted-foreground">
								{t(
									"settings.workDiagnostics.repair.inactiveDescription",
									"Repair needs separate authorization for this organization. The plan stays readable.",
								)}
							</p>
						) : null}
						<form.Field
							name="reason"
							validators={{
								onSubmit: ({ value }) =>
									value.trim()
										? undefined
										: t(
												"settings.workDiagnostics.repair.reasonRequired",
												"Enter the reason for this repair.",
											),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="work-repair-reason">
										{t("settings.workDiagnostics.repair.reason", "Reason")}
									</Label>
									<Textarea
										id="work-repair-reason"
										name="reason"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										maxLength={1000}
										rows={3}
										disabled={!authorized}
										aria-invalid={field.state.meta.errors.length > 0}
									/>
									{field.state.meta.errors.length > 0 ? (
										<p className="text-sm text-destructive" role="alert">
											{field.state.meta.errors.join(" ")}
										</p>
									) : null}
								</div>
							)}
						</form.Field>
						<form.Subscribe selector={(formState) => formState.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={!authorized || isSubmitting}>
									{isSubmitting ? (
										<IconLoader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden />
									) : null}
									{t("settings.workDiagnostics.repair.apply", "Repair {count} work periods", {
										count: units.length,
									})}
								</Button>
							)}
						</form.Subscribe>
					</form>
				) : null}

				{state.kind === "error" ? (
					<p className="text-sm text-destructive" role="alert">
						{state.message}
					</p>
				) : null}
				{state.kind === "done" ? (
					<ul className="space-y-1 text-sm" aria-live="polite">
						{state.outcomes.map((outcome) => (
							<li key={outcome.employeeId}>
								{employeeLabel(outcome.employeeId)}:{" "}
								{outcome.status === "stale"
									? t(
											"settings.workDiagnostics.repair.stale",
											"Evidence changed since this plan was read. Nothing was written; review the refreshed plan.",
										)
									: outcome.status === "already_applied"
										? t("settings.workDiagnostics.repair.alreadyApplied", "Already repaired.")
										: t("settings.workDiagnostics.repair.applied", "{count} work periods repaired.", {
												count: outcome.receipts?.length ?? 0,
											})}
							</li>
						))}
					</ul>
				) : null}
			</CardContent>
		</Card>
	);
}
