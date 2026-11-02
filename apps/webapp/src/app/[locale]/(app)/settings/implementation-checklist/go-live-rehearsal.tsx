"use client";

import {
	IconAlertTriangle,
	IconCircleCheck,
	IconCloudOff,
	IconLoader2,
	IconPlayerPlay,
	IconRefresh,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { createContext, type ReactNode, useContext, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatInstant, formatPlainDate } from "@/lib/datetime/temporal-format";
import type {
	GoLiveRehearsal,
	GoLiveRehearsalActionResult,
	GoLiveRehearsalCandidate,
	GoLiveRehearsalKind,
	GoLiveRehearsalRoute,
	GoLiveRehearsalStage,
} from "@/lib/implementation-checklist/go-live/rehearsal-types";
import {
	type GoLiveFixLink,
	type GoLiveMember,
	type GoLiveMessage,
	goLiveMemberKey,
} from "@/lib/implementation-checklist/go-live/types";
import { Link } from "@/navigation";
import { rehearseGoLiveMemberAction } from "./go-live-rehearsal-actions";

type Translate = ReturnType<typeof useTranslate>["t"];

function message(t: Translate, text: GoLiveMessage) {
	return t(text.key, text.fallback, text.params);
}

interface GoLiveRehearsalControls {
	candidates: readonly GoLiveRehearsalCandidate[];
	open(memberKey: string): void;
}

const GoLiveRehearsalContext = createContext<GoLiveRehearsalControls | null>(null);

type RehearsalState =
	| { memberKey: string; result: null }
	| { memberKey: string; result: GoLiveRehearsalActionResult };

/**
 * Holds the go-live rehearsal (#1517): any part of the checklist can open it for a checked
 * member, and it shows in a side sheet. Running it writes nothing; it only reads.
 */
export function GoLiveRehearsalProvider({
	candidates,
	children,
}: {
	candidates: readonly GoLiveRehearsalCandidate[];
	children: ReactNode;
}) {
	const { t } = useTranslate();
	const [state, setState] = useState<RehearsalState | null>(null);
	const [isRunning, startRun] = useTransition();

	function open(memberKey: string) {
		setState({ memberKey, result: null });
		startRun(async () => {
			const result = await rehearseGoLiveMemberAction(memberKey);
			setState((current) => (current?.memberKey === memberKey ? { memberKey, result } : current));
		});
	}

	const candidate = state ? candidates.find((entry) => entry.key === state.memberKey) : undefined;

	return (
		<GoLiveRehearsalContext.Provider value={{ candidates, open }}>
			{children}
			<Sheet open={state !== null} onOpenChange={(next) => (next ? undefined : setState(null))}>
				<SheetContent className="w-full overflow-y-auto sm:max-w-xl">
					<SheetHeader>
						<SheetTitle>
							{t("settings.implementationChecklist.rehearsal.title", "Go-live rehearsal")}
						</SheetTitle>
						<SheetDescription>
							{t(
								"settings.implementationChecklist.rehearsal.sheetDescription",
								"What Z8 would do for {name} today. Nothing is saved or sent.",
								{ name: candidate?.displayName ?? "" },
							)}
						</SheetDescription>
					</SheetHeader>
					<div className="px-4 pb-6">
						{state === null ? null : isRunning || state.result === null ? (
							<p className="flex items-center gap-2 text-muted-foreground text-sm">
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
								{t("settings.implementationChecklist.rehearsal.running", "Working it out…")}
							</p>
						) : state.result.success ? (
							<GoLiveRehearsalView rehearsal={state.result.data} />
						) : (
							<RehearsalFailure error={state.result.error} onRetry={() => open(state.memberKey)} />
						)}
					</div>
				</SheetContent>
			</Sheet>
		</GoLiveRehearsalContext.Provider>
	);
}

function RehearsalFailure({
	error,
	onRetry,
}: {
	error: Extract<GoLiveRehearsalActionResult, { success: false }>["error"];
	onRetry: () => void;
}) {
	const { t } = useTranslate();
	if (error === "member_not_checked") {
		return (
			<p className="text-muted-foreground text-sm">
				{t(
					"settings.implementationChecklist.rehearsal.errors.memberNotChecked",
					"This person isn't in the go-live group any more, so there is nothing to rehearse. Reload the page to see the current group.",
				)}
			</p>
		);
	}
	return (
		<div className="space-y-3">
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<IconCloudOff aria-hidden="true" className="size-4 shrink-0" />
				{t(
					"settings.implementationChecklist.rehearsal.errors.unavailable",
					"The rehearsal could not be completed.",
				)}
			</p>
			<Button onClick={onRetry} size="sm" type="button" variant="outline">
				<IconRefresh aria-hidden="true" className="size-4" />
				{t("settings.implementationChecklist.rehearsal.retry", "Try again")}
			</Button>
		</div>
	);
}

/** The rehearsal entry point on the First workflows item: pick a checked member and run it. */
export function GoLiveRehearsalPicker() {
	const { t } = useTranslate();
	const controls = useContext(GoLiveRehearsalContext);
	const [memberKey, setMemberKey] = useState("");
	if (!controls) return null;

	return (
		<section className="space-y-3 rounded-md border p-3">
			<div className="space-y-1">
				<h3 className="font-medium text-sm">
					{t("settings.implementationChecklist.rehearsal.title", "Go-live rehearsal")}
				</h3>
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.implementationChecklist.rehearsal.description",
						"See what Z8 would do for one person in the go-live group: their work policy, who decides their requests and their payroll prerequisites. Nothing is saved or sent.",
					)}
				</p>
			</div>
			{controls.candidates.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.implementationChecklist.rehearsal.nobody",
						"Nobody is in the go-live group yet.",
					)}
				</p>
			) : (
				<div className="flex flex-col gap-2 sm:flex-row">
					<SearchableSelect
						aria-label={t("settings.implementationChecklist.rehearsal.person", "Person")}
						emptyText={t(
							"settings.implementationChecklist.rehearsal.noMatch",
							"Nobody in the go-live group matches.",
						)}
						onValueChange={setMemberKey}
						options={controls.candidates.map((candidate) => ({
							code: candidate.key,
							name: candidate.displayName,
						}))}
						placeholder={t(
							"settings.implementationChecklist.rehearsal.choosePerson",
							"Choose a person",
						)}
						searchPlaceholder={t(
							"settings.implementationChecklist.rehearsal.searchPerson",
							"Search the go-live group",
						)}
						value={memberKey}
					/>
					<Button
						disabled={!memberKey}
						onClick={() => controls.open(memberKey)}
						size="sm"
						type="button"
					>
						<IconPlayerPlay aria-hidden="true" className="size-4" />
						{t("settings.implementationChecklist.rehearsal.run", "Rehearse")}
					</Button>
				</div>
			)}
		</section>
	);
}

/** Opens the rehearsal for a member listed in a failure group; nothing outside a provider. */
export function GoLiveRehearsalButton({ member }: { member: GoLiveMember }) {
	const { t } = useTranslate();
	const controls = useContext(GoLiveRehearsalContext);
	const memberKey = goLiveMemberKey(member);
	if (!controls?.candidates.some((candidate) => candidate.key === memberKey)) return null;

	return (
		<Button
			aria-label={t(
				"settings.implementationChecklist.rehearsal.runFor",
				"Rehearse go-live for {name}",
				{ name: member.displayName },
			)}
			className="h-auto px-1.5 py-0.5 text-xs"
			onClick={() => controls.open(memberKey)}
			size="sm"
			type="button"
			variant="ghost"
		>
			{t("settings.implementationChecklist.rehearsal.run", "Rehearse")}
		</Button>
	);
}

/** The trace itself: work policy, approvals per kind and payroll prerequisites. */
export function GoLiveRehearsalView({ rehearsal }: { rehearsal: GoLiveRehearsal }) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();

	return (
		<div className="space-y-6">
			<p className="text-muted-foreground text-xs">
				{t("settings.implementationChecklist.rehearsal.workedOut", "Worked out {time}", {
					time: formatInstant(
						parseInstant(rehearsal.asOf.instant),
						displayContext,
						"dateTimeMedium",
					),
				})}
			</p>
			<WorkPolicySection rehearsal={rehearsal} />
			<ApprovalsSection rehearsal={rehearsal} />
			<PayrollSection rehearsal={rehearsal} />
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-3">
			<h3 className="font-semibold text-sm">{title}</h3>
			{children}
		</section>
	);
}

function FixLink({ fix }: { fix: GoLiveFixLink | null }) {
	const { t } = useTranslate();
	if (!fix) return null;
	return (
		<Button asChild size="sm" variant="outline">
			<Link href={fix.href}>{message(t, fix.label)}</Link>
		</Button>
	);
}

function Facts({ rows }: { rows: { id: string; label: string; value: ReactNode }[] }) {
	return (
		<dl className="divide-y rounded-md border">
			{rows.map((row) => (
				<div
					className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
					key={row.id}
				>
					<dt className="font-medium text-sm">{row.label}</dt>
					<dd className="text-sm sm:text-right">{row.value}</dd>
				</div>
			))}
		</dl>
	);
}

/** A reference Monday, so weekday names come out in the viewer's language. */
const REFERENCE_MONDAY = "2024-01-01";
const WEEKDAY_OFFSET = {
	monday: 0,
	tuesday: 1,
	wednesday: 2,
	thursday: 3,
	friday: 4,
	saturday: 5,
	sunday: 6,
} as const;

function WorkPolicySection({ rehearsal }: { rehearsal: GoLiveRehearsal }) {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();
	const policy = rehearsal.workPolicy;
	const title = t("settings.implementationChecklist.rehearsal.workPolicy.title", "Work policy");

	if (policy.status === "none") {
		return (
			<Section title={title}>
				<p className="flex items-start gap-2 text-sm">
					<IconAlertTriangle
						aria-hidden="true"
						className="mt-0.5 size-4 shrink-0 text-destructive"
					/>
					{t(
						"settings.implementationChecklist.rehearsal.workPolicy.none",
						"No effective work policy today: none is assigned to them, their team or the organization.",
					)}
				</p>
				<FixLink fix={policy.fix} />
			</Section>
		);
	}

	const notSet = t(
		"settings.implementationChecklist.rehearsal.workPolicy.noSchedule",
		"No schedule",
	);
	const { schedule } = policy;
	return (
		<Section title={title}>
			<Facts
				rows={[
					{
						id: "name",
						label: t("settings.implementationChecklist.rehearsal.workPolicy.name", "Policy"),
						value: policy.policyName,
					},
					{
						id: "assigned",
						label: t(
							"settings.implementationChecklist.rehearsal.workPolicy.assignedVia",
							"Assigned",
						),
						value: t(
							"settings.implementationChecklist.rehearsal.workPolicy.assignedAt",
							"{level, select, employee {To them} team {To team {team}} other {To the organization}}",
							{ level: policy.assignmentType, team: policy.assignedVia },
						),
					},
					{
						id: "hours",
						label: t("settings.implementationChecklist.rehearsal.workPolicy.hours", "Hours"),
						value:
							schedule && schedule.hours !== null
								? t(
										"settings.implementationChecklist.rehearsal.workPolicy.hoursPerCycle",
										"{hours, number} hours per {cycle, select, daily {day} weekly {week} biweekly {two weeks} monthly {month} other {year}}",
										{ hours: schedule.hours, cycle: schedule.cycle },
									)
								: notSet,
					},
					{
						id: "days",
						label: t(
							"settings.implementationChecklist.rehearsal.workPolicy.workingDays",
							"Working days",
						),
						value:
							schedule === null
								? notSet
								: schedule.workingDays.length === 0
									? t(
											"settings.implementationChecklist.rehearsal.workPolicy.noWorkingDays",
											"No working days",
										)
									: schedule.workingDays
											.map((day) =>
												formatPlainDate(
													parsePlainDate(REFERENCE_MONDAY).add({ days: WEEKDAY_OFFSET[day] }),
													locale,
													"weekdayShort",
												),
											)
											.join(", "),
					},
				]}
			/>
		</Section>
	);
}

function ApprovalsSection({ rehearsal }: { rehearsal: GoLiveRehearsal }) {
	const { t } = useTranslate();
	return (
		<Section title={t("settings.implementationChecklist.rehearsal.approvals.title", "Approvals")}>
			<div className="space-y-3">
				{rehearsal.approvals.kinds.map((kind) => (
					<KindTrace key={kind.kind} kind={kind} />
				))}
			</div>
			{rehearsal.approvals.offKinds.length ? (
				<ul className="space-y-1 text-muted-foreground text-sm">
					{rehearsal.approvals.offKinds.map((kind) => (
						<li key={kind}>
							{kind === "period_submission"
								? t(
										"settings.implementationChecklist.goLive.approver.periodSubmissionsOff",
										"Period submissions are off, so they aren't checked.",
									)
								: t(
										"settings.implementationChecklist.goLive.approver.shiftsOff",
										"Shifts are off, so shift requests aren't checked.",
									)}
						</li>
					))}
				</ul>
			) : null}
		</Section>
	);
}

function KindTrace({ kind }: { kind: GoLiveRehearsalKind }) {
	const { t } = useTranslate();
	return (
		<div className="space-y-2 rounded-md border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h4 className="font-medium text-sm">{message(t, kind.label)}</h4>
				<KindBadge status={kind.status} />
			</div>
			{kind.reason ? (
				<p className="text-muted-foreground text-sm">{message(t, kind.reason)}</p>
			) : null}
			<FixLink fix={kind.fix} />
			{kind.status === "routed"
				? kind.variants.map((variant) => (
						// Several variants each have their own label; a lone one has none.
						<div className="space-y-1" key={variant.label ? JSON.stringify(variant.label) : "only"}>
							{variant.label ? (
								<p className="font-medium text-muted-foreground text-xs">
									{message(t, variant.label)}
								</p>
							) : null}
							{variant.route ? <RouteTrace route={variant.route} /> : null}
							{variant.reason ? (
								<p className="text-muted-foreground text-sm">{message(t, variant.reason)}</p>
							) : null}
						</div>
					))
				: null}
		</div>
	);
}

function KindBadge({ status }: { status: GoLiveRehearsalKind["status"] }) {
	const { t } = useTranslate();
	if (status === "skipped") {
		return (
			<Badge variant="secondary">
				{t(
					"settings.implementationChecklist.rehearsal.approvals.noApprovalNeeded",
					"No approval needed",
				)}
			</Badge>
		);
	}
	if (status === "unroutable") {
		return (
			<Badge variant="destructive">
				{t(
					"settings.implementationChecklist.rehearsal.approvals.unroutable.badge",
					"Can't be routed",
				)}
			</Badge>
		);
	}
	return (
		<Badge variant="outline">
			{t("settings.implementationChecklist.rehearsal.approvals.routed", "Needs approval")}
		</Badge>
	);
}

function RouteTrace({ route }: { route: GoLiveRehearsalRoute }) {
	const { t } = useTranslate();
	return (
		<div className="space-y-1">
			<p className="text-muted-foreground text-xs">
				{route.policyName
					? t(
							"settings.implementationChecklist.rehearsal.approvals.viaPolicy",
							"Approval policy {policy}",
							{ policy: route.policyName },
						)
					: route.path === "shift_deciders"
						? t(
								"settings.implementationChecklist.rehearsal.approvals.shiftDeciders",
								"Any manager or admin",
							)
						: t(
								"settings.implementationChecklist.rehearsal.approvals.defaultApprover",
								"No approval policy applies: their manager decides",
							)}
			</p>
			<ol className="space-y-1">
				{route.stages.map((stage) => (
					<StageTrace key={stage.sequence} stage={stage} />
				))}
			</ol>
		</div>
	);
}

function StageTrace({ stage }: { stage: GoLiveRehearsalStage }) {
	const { t } = useTranslate();
	const notes: string[] = [];
	if (stage.activates === "after_earlier_stages") {
		notes.push(
			t(
				"settings.implementationChecklist.rehearsal.stage.later",
				"Starts once the stages before it decide.",
			),
		);
	}
	if (stage.standsInFor) {
		notes.push(
			stage.resolution === "unresolvable"
				? t(
						"settings.implementationChecklist.rehearsal.stage.departedNobody",
						"{name} has left and nobody stands in.",
						{ name: stage.standsInFor.displayName },
					)
				: t(
						"settings.implementationChecklist.rehearsal.stage.standsIn",
						"Stands in for {name}, who has left.",
						{ name: stage.standsInFor.displayName },
					),
		);
	}
	if (stage.viaFallback) {
		notes.push(
			t(
				"settings.implementationChecklist.rehearsal.stage.viaFallback",
				"Nobody matches the stage's own rule, so its fallback ({fallback, select, default_manager {their manager} organization_admin {organization admins} other {fallback}}) decides.",
				{ fallback: stage.fallbackBehavior ?? "other" },
			),
		);
	}

	return (
		<li className="flex gap-2 text-sm">
			{stage.resolution === "unresolvable" ? (
				<IconAlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
			) : (
				<IconCircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
			)}
			<div className="min-w-0 space-y-0.5">
				<p>
					<span className="font-medium">
						{stage.label
							? t(
									"settings.implementationChecklist.rehearsal.stage.labelled",
									"Stage {sequence}: {label}",
									{ sequence: stage.sequence, label: stage.label },
								)
							: t("settings.implementationChecklist.rehearsal.stage.numbered", "Stage {sequence}", {
									sequence: stage.sequence,
								})}
					</span>{" "}
					{stage.resolution === "requester_auto_approve"
						? t(
								"settings.implementationChecklist.rehearsal.stage.ownApprover",
								"They are their own approver here, so this stage completes at once.",
							)
						: stage.resolution === "unresolvable"
							? t(
									"settings.implementationChecklist.rehearsal.stage.nobody",
									"Nobody would be found to decide it.",
								)
							: stage.approvers.map((person) => person.displayName).join(", ")}
				</p>
				{notes.map((note) => (
					<p className="text-muted-foreground text-xs" key={note}>
						{note}
					</p>
				))}
			</div>
		</li>
	);
}

function PayrollSection({ rehearsal }: { rehearsal: GoLiveRehearsal }) {
	const { t } = useTranslate();
	const title = t("settings.implementationChecklist.rehearsal.payroll.title", "Payroll");
	const { payroll } = rehearsal;
	if (!payroll) {
		return (
			<Section title={title}>
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.implementationChecklist.rehearsal.payroll.notExported",
						"The organization has no active payroll export target, so there are no payroll prerequisites.",
					)}
				</p>
			</Section>
		);
	}

	const { prerequisites } = payroll;
	const invited = t(
		"settings.implementationChecklist.rehearsal.payroll.notYetInvited",
		"Not yet: they're still invited",
	);
	const identifier = prerequisites.personnelIdentifier;
	const needsEmployeesFix =
		prerequisites.employmentTerms === "missing" || identifier.status === "shared";
	return (
		<Section title={title}>
			<Facts
				rows={[
					{
						id: "identifier",
						label: t(
							"settings.implementationChecklist.rehearsal.payroll.personnelIdentifier",
							"Personnel number",
						),
						value:
							identifier.status === "unique" ? (
								t("settings.implementationChecklist.rehearsal.payroll.unique", "Unique")
							) : identifier.status === "shared" ? (
								<Problem>
									{t(
										"settings.implementationChecklist.goLive.payrollSetup.sharedPersonnelIdentifierDetail",
										"{identifier}, shared with {others}",
										{ identifier: identifier.identifier, others: identifier.sharedWith.join(", ") },
									)}
								</Problem>
							) : identifier.status === "unavailable" ? (
								t(
									"settings.implementationChecklist.rehearsal.payroll.unavailable",
									"Couldn't be checked",
								)
							) : (
								invited
							),
					},
					{
						id: "terms",
						label: t(
							"settings.implementationChecklist.rehearsal.payroll.employmentTerms",
							"Employment terms",
						),
						value:
							prerequisites.employmentTerms === "confirmed" ? (
								t(
									"settings.implementationChecklist.rehearsal.payroll.termsConfirmed",
									"Confirmed for today",
								)
							) : prerequisites.employmentTerms === "missing" ? (
								<Problem advisory>
									{t(
										"settings.implementationChecklist.rehearsal.payroll.termsMissing",
										"No confirmed terms covering today",
									)}
								</Problem>
							) : (
								invited
							),
					},
					{
						id: "mapping",
						label: t(
							"settings.implementationChecklist.rehearsal.payroll.exportTargetMapping",
							"Export target mapping",
						),
						value:
							prerequisites.wageTypeMappings === "present" ? (
								t(
									"settings.implementationChecklist.rehearsal.payroll.mappingsPresent",
									"{count, plural, one {# export target} other {# export targets}}, wage types mapped",
									{ count: prerequisites.exportTargetCount },
								)
							) : (
								<Problem>
									{t(
										"settings.implementationChecklist.rehearsal.payroll.mappingsMissing",
										"No active wage-type mappings",
									)}
								</Problem>
							),
					},
				]}
			/>
			<div className="flex flex-wrap gap-2">
				{prerequisites.wageTypeMappings === "missing" ? (
					<FixLink fix={payroll.payrollExportFix} />
				) : null}
				{needsEmployeesFix ? <FixLink fix={payroll.employeesFix} /> : null}
			</div>
		</Section>
	);
}

function Problem({ children, advisory = false }: { children: ReactNode; advisory?: boolean }) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<IconAlertTriangle
				aria-hidden="true"
				className={
					advisory ? "size-4 shrink-0 text-muted-foreground" : "size-4 shrink-0 text-destructive"
				}
			/>
			{children}
		</span>
	);
}
