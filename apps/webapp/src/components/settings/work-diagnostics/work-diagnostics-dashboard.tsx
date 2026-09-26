import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { AppendAssuranceReport } from "@/lib/time-tracking/append-assurance";
import type {
	AdoptionProvenance,
	HistoricalWorkDiagnostics,
	WorkFinding,
	WorkFindingKind,
	WorkFindingShape,
	WorkFindingTreatment,
} from "@/lib/time-tracking/historical-work-diagnostics";
import { Link } from "@/navigation";

type TranslateFn = (
	key: string,
	defaultValue?: string,
	params?: Record<string, string | number>,
) => string;

export interface WorkDiagnosticsView {
	report: HistoricalWorkDiagnostics;
	appendAssurance: { employeeId: string; report: AppendAssuranceReport }[];
	employeeLabels: Record<string, string>;
	period: { startDate: string; endDate: string };
	selectedEmployeeId: string | null;
	hrefFor: (change: { employeeId?: string | null; month?: "previous" | "next" }) => string;
}

export function WorkDiagnosticsDashboard({
	t,
	data,
}: {
	t: TranslateFn;
	data: WorkDiagnosticsView;
}) {
	const { report, employeeLabels } = data;
	const complete = report.completeness.status === "complete";
	const employeeLabel = (employeeId: string) => employeeLabels[employeeId] ?? employeeId;
	const heldAppendScopes = data.appendAssurance.filter(
		({ report: assurance }) => assurance.assurance.scope === "none",
	);
	// An authorized continuation (#323) is continuity from its anchor, never verified history.
	const continuedAppendScopes = data.appendAssurance.filter(
		({ report: assurance }) => assurance.assurance.scope === "post_anchor",
	);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-3 text-sm">
				<Link className={actionLinkClassName} href={data.hrefFor({ month: "previous" })}>
					{t("settings.workDiagnostics.previousMonth", "Previous month")}
				</Link>
				<Link className={actionLinkClassName} href={data.hrefFor({ month: "next" })}>
					{t("settings.workDiagnostics.nextMonth", "Next month")}
				</Link>
				{data.selectedEmployeeId ? (
					<Link className={actionLinkClassName} href={data.hrefFor({ employeeId: null })}>
						{t("settings.workDiagnostics.allEmployees", "Show all employees")}
					</Link>
				) : null}
			</div>

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<SummaryCard
					title={t("settings.workDiagnostics.summary.status", "Completeness")}
					value={
						<Badge variant={complete ? "secondary" : "destructive"}>
							{complete
								? t("settings.workDiagnostics.status.complete", "Complete")
								: t("settings.workDiagnostics.status.incomplete", "Incomplete")}
						</Badge>
					}
					description={widenedDescription(report.completeness.widenedTo, complete, t)}
				/>
				<SummaryCard
					title={t("settings.workDiagnostics.summary.scope", "Scope")}
					value={`${data.period.startDate} – ${data.period.endDate}`}
					description={
						data.selectedEmployeeId
							? employeeLabel(data.selectedEmployeeId)
							: t(
									"settings.workDiagnostics.summary.scopeAll",
									"All employees. Dates cover every time zone's calendar days.",
								)
					}
				/>
				<SummaryCard
					title={t("settings.workDiagnostics.summary.blocking", "Blocking findings")}
					value={String(report.completeness.blockingFindingIds.length)}
					description={t(
						"settings.workDiagnostics.summary.blockingDescription",
						"Missing or conflicting evidence that makes relevant work uncertain.",
					)}
				/>
				<SummaryCard
					title={t("settings.workDiagnostics.summary.affected", "Affected employees")}
					value={String(report.completeness.affectedEmployeeIds.length)}
					description={t(
						"settings.workDiagnostics.summary.affectedDescription",
						"Employees whose work in this scope cannot be established.",
					)}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t("settings.workDiagnostics.findings.title", "Findings")}</CardTitle>
					<CardDescription>
						{t(
							"settings.workDiagnostics.findings.description",
							"Every finding is read-only evidence. Only the historical gap repair below fills missing values, from evidence and with separate authorization; changing established work needs a separately authorized review.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{report.findings.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.workDiagnostics.findings.empty",
								"No missing, conflicting or suspected historical work in this scope.",
							)}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.workDiagnostics.findings.finding", "Finding")}</TableHead>
									<TableHead>
										{t("settings.workDiagnostics.findings.treatment", "Treatment")}
									</TableHead>
									<TableHead>
										{t("settings.workDiagnostics.findings.provenance", "Provenance")}
									</TableHead>
									<TableHead>
										{t("settings.workDiagnostics.findings.employees", "Employees")}
									</TableHead>
									<TableHead>
										{t("settings.workDiagnostics.findings.evidence", "Evidence")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{report.findings.map((finding) => (
									<FindingRow
										key={finding.id}
										t={t}
										finding={finding}
										employeeLabel={employeeLabel}
										hrefFor={data.hrefFor}
									/>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>
						{t("settings.workDiagnostics.append.title", "Time entry chain assurance")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.workDiagnostics.append.description",
							"A separate claim from completeness: lineage and continuity of stored time entries. It does not decide payroll readiness.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-sm">
						{t(
							"settings.workDiagnostics.append.counts",
							"{verified} of {total} employees have lineage verified from stored evidence.",
							{
								verified:
									data.appendAssurance.length -
									heldAppendScopes.length -
									continuedAppendScopes.length,
								total: data.appendAssurance.length,
							},
						)}
					</p>
					{continuedAppendScopes.length > 0 ? (
						<p className="text-sm">
							{t(
								"settings.workDiagnostics.append.continued",
								"Employees continuing from an approved anchor: {count}. History before each anchor is not verified.",
								{ count: continuedAppendScopes.length },
							)}
						</p>
					) : null}
					{[...heldAppendScopes, ...continuedAppendScopes].map(({ employeeId, report: assurance }) => (
						<AppendAssuranceDetail
							key={employeeId}
							t={t}
							label={employeeLabel(employeeId)}
							assurance={assurance}
						/>
					))}
				</CardContent>
			</Card>
		</div>
	);
}

function FindingRow({
	t,
	finding,
	employeeLabel,
	hrefFor,
}: {
	t: TranslateFn;
	finding: WorkFinding;
	employeeLabel: (employeeId: string) => string;
	hrefFor: WorkDiagnosticsView["hrefFor"];
}) {
	return (
		<TableRow>
			<TableCell className="align-top">
				<div className="font-medium">{findingKindLabel(finding.kind, t)}</div>
				<div className="mt-1 flex flex-wrap gap-1">
					<Badge variant="outline">{shapeLabel(finding.shape, t)}</Badge>
					{finding.blocking ? (
						<Badge variant="destructive">
							{t("settings.workDiagnostics.blocking", "Blocks completeness")}
						</Badge>
					) : null}
				</div>
			</TableCell>
			<TableCell className="align-top">{treatmentLabel(finding.treatment, t)}</TableCell>
			<TableCell className="align-top">
				<ProvenanceText t={t} provenance={finding.provenance} />
			</TableCell>
			<TableCell className="align-top">
				{finding.employeeIds.length === 0
					? t("settings.workDiagnostics.ownerUnknown", "Owner not established")
					: finding.employeeIds.map((employeeId) => (
							<div key={employeeId}>
								<Link className={actionLinkClassName} href={hrefFor({ employeeId })}>
									{employeeLabel(employeeId)}
								</Link>
							</div>
						))}
			</TableCell>
			<TableCell className="align-top">
				<EvidenceList
					items={[
						[
							t("settings.workDiagnostics.evidence.workPeriods", "Work periods"),
							finding.workPeriodIds,
						],
						[
							t("settings.workDiagnostics.evidence.timeRecords", "Time records"),
							finding.timeRecordIds,
						],
						[t("settings.workDiagnostics.evidence.entries", "Time entries"), finding.entryIds],
						...Object.entries(finding.details).map(([key, value]): [string, unknown] => [
							key,
							value,
						]),
					]}
				/>
			</TableCell>
		</TableRow>
	);
}

function AppendAssuranceDetail({
	t,
	label,
	assurance,
}: {
	t: TranslateFn;
	label: string;
	assurance: AppendAssuranceReport;
}) {
	const issues = assurance.lineage.status === "review_required" ? assurance.lineage.issues : [];
	const interruptions =
		assurance.continuity.status === "interrupted" ? assurance.continuity.reasons : [];
	return (
		<section className="rounded-md border p-3 text-sm">
			<div className="flex flex-wrap items-center gap-2 font-medium">
				{label}
				<Badge variant="outline">{assurance.lineage.status}</Badge>
				<Badge variant="outline">{assurance.continuity.status}</Badge>
				<Badge variant="outline">{assurance.assurance.scope}</Badge>
			</div>
			{issues.length > 0 ? (
				<div className="mt-2">
					<div className="text-muted-foreground">
						{t("settings.workDiagnostics.append.issues", "Lineage issues and candidates")}
					</div>
					{issues.map((issue) => (
						<CodedItem key={JSON.stringify(issue)} value={issue} />
					))}
				</div>
			) : null}
			{interruptions.length > 0 ? (
				<div className="mt-2">
					<div className="text-muted-foreground">
						{t("settings.workDiagnostics.append.interruptions", "Continuity interruptions")}
					</div>
					{interruptions.map((reason) => (
						<CodedItem key={JSON.stringify(reason)} value={reason} />
					))}
				</div>
			) : null}
			<div className="mt-2 text-muted-foreground">
				{t("settings.workDiagnostics.append.limitations", "Limitations")}:{" "}
				<code>
					{assurance.assurance.limitations.map((limitation) => limitation.code).join(", ")}
				</code>
			</div>
		</section>
	);
}

function CodedItem({ value }: { value: { kind: string } & Record<string, unknown> }) {
	const { kind, ...fields } = value;
	return (
		<div className="mt-1">
			<code>{kind}</code>
			<EvidenceList items={Object.entries(fields)} />
		</div>
	);
}

function EvidenceList({ items }: { items: [string, unknown][] }) {
	const present = items.filter(
		([, value]) =>
			value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0),
	);
	if (present.length === 0) return null;
	return (
		<dl className="space-y-0.5 text-xs">
			{present.map(([key, value]) => (
				<div key={key} className="flex flex-wrap gap-1">
					<dt className="text-muted-foreground">{key}:</dt>
					<dd className="break-all font-mono">
						{Array.isArray(value) ? value.map(String).join(", ") : String(value)}
					</dd>
				</div>
			))}
		</dl>
	);
}

function ProvenanceText({ t, provenance }: { t: TranslateFn; provenance: AdoptionProvenance }) {
	switch (provenance.state) {
		case "pre_adoption":
			return <>{t("settings.workDiagnostics.provenance.preAdoption", "Pre-adoption history")}</>;
		case "fresh_backdated":
			return (
				<>
					{t("settings.workDiagnostics.provenance.freshBackdated", "Fresh backdated write")}
					<div className="text-xs text-muted-foreground">{provenance.writer}</div>
				</>
			);
		case "post_adoption":
			return (
				<>
					{t("settings.workDiagnostics.provenance.postAdoption", "Post-adoption write")}
					<div className="text-xs text-muted-foreground">{provenance.writer}</div>
				</>
			);
		case "ambiguous":
			return (
				<>
					{t("settings.workDiagnostics.provenance.ambiguous", "Ambiguous provenance")}
					<div className="text-xs text-muted-foreground">{provenance.reason}</div>
				</>
			);
	}
}

function SummaryCard({
	title,
	value,
	description,
}: {
	title: string;
	value: ReactNode;
	description: string;
}) {
	return (
		<Card>
			<CardHeader>
				<CardDescription>{title}</CardDescription>
				<CardTitle className="text-xl">{value}</CardTitle>
			</CardHeader>
			<CardContent className="text-sm text-muted-foreground">{description}</CardContent>
		</Card>
	);
}

function widenedDescription(
	widenedTo: HistoricalWorkDiagnostics["completeness"]["widenedTo"],
	complete: boolean,
	t: TranslateFn,
) {
	if (complete) {
		return t(
			"settings.workDiagnostics.status.completeDescription",
			"No relevant missing or conflicting evidence, including pending, rejected and open work.",
		);
	}
	switch (widenedTo) {
		case "organization":
			return t(
				"settings.workDiagnostics.status.widenedOrganization",
				"Ownership could not be established, so the whole organization is uncertain.",
			);
		case "employees":
			return t(
				"settings.workDiagnostics.status.widenedEmployees",
				"Dates could not be established, so affected employees are uncertain for every period.",
			);
		case "requested":
			return t(
				"settings.workDiagnostics.status.incompleteDescription",
				"Unaffected data is usable for review, but this scope is not complete.",
			);
	}
}

function shapeLabel(shape: WorkFindingShape, t: TranslateFn) {
	const labels: Record<WorkFindingShape, string> = {
		missing: t("settings.workDiagnostics.shape.missing", "Missing"),
		conflicting: t("settings.workDiagnostics.shape.conflicting", "Conflicting"),
		suspected_defect: t("settings.workDiagnostics.shape.suspectedDefect", "Suspected defect"),
		disclosure: t("settings.workDiagnostics.shape.disclosure", "Disclosure"),
	};
	return labels[shape];
}

function treatmentLabel(treatment: WorkFindingTreatment, t: TranslateFn) {
	const labels: Record<WorkFindingTreatment, string> = {
		historical_gap: t("settings.workDiagnostics.treatment.historicalGap", "Historical gap"),
		review_required: t("settings.workDiagnostics.treatment.reviewRequired", "Review required"),
		integrity_incident: t(
			"settings.workDiagnostics.treatment.integrityIncident",
			"Integrity incident",
		),
		investigation_required: t(
			"settings.workDiagnostics.treatment.investigationRequired",
			"Investigation required",
		),
		disclosed: t("settings.workDiagnostics.treatment.disclosed", "Disclosed limitation"),
	};
	return labels[treatment];
}

function findingKindLabel(kind: WorkFindingKind, t: TranslateFn) {
	const labels: Record<WorkFindingKind, string> = {
		ownership_conflict: t("settings.workDiagnostics.kind.ownershipConflict", "Ownership conflict"),
		work_outside_organization_employees: t(
			"settings.workDiagnostics.kind.workOutsideOrganizationEmployees",
			"Work owned outside the organization's employees",
		),
		canonical_missing: t("settings.workDiagnostics.kind.canonicalMissing", "Time record missing"),
		canonical_link_missing: t(
			"settings.workDiagnostics.kind.canonicalLinkMissing",
			"Time record link missing",
		),
		canonical_link_unresolved: t(
			"settings.workDiagnostics.kind.canonicalLinkUnresolved",
			"Linked time record not found",
		),
		canonical_link_shared: t(
			"settings.workDiagnostics.kind.canonicalLinkShared",
			"Several work periods link one time record",
		),
		canonical_detail_missing: t(
			"settings.workDiagnostics.kind.canonicalDetailMissing",
			"Time record work detail missing",
		),
		relinked_canonical_residue: t(
			"settings.workDiagnostics.kind.relinkedCanonicalResidue",
			"Time record left behind by relinking",
		),
		endpoint_missing: t("settings.workDiagnostics.kind.endpointMissing", "End time missing"),
		endpoint_conflict: t(
			"settings.workDiagnostics.kind.endpointConflict",
			"Start or end times disagree",
		),
		open_state_conflict: t(
			"settings.workDiagnostics.kind.openStateConflict",
			"Open and closed state disagree",
		),
		multiple_active_work: t(
			"settings.workDiagnostics.kind.multipleActiveWork",
			"More than one active work period",
		),
		endpoint_entry_unresolved: t(
			"settings.workDiagnostics.kind.endpointEntryUnresolved",
			"Clock entry not found",
		),
		endpoint_entry_superseded: t(
			"settings.workDiagnostics.kind.endpointEntrySuperseded",
			"Work period points to a replaced clock entry",
		),
		endpoint_entry_missing: t(
			"settings.workDiagnostics.kind.endpointEntryMissing",
			"Clock-out entry missing",
		),
		capture_inferred: t(
			"settings.workDiagnostics.kind.captureInferred",
			"Time zone capture inferred after the event",
		),
		duration_missing: t("settings.workDiagnostics.kind.durationMissing", "Stored duration missing"),
		duration_conflict: t(
			"settings.workDiagnostics.kind.durationConflict",
			"Stored durations disagree",
		),
		negative_duration: t("settings.workDiagnostics.kind.negativeDuration", "Negative duration"),
		reversed_interval: t("settings.workDiagnostics.kind.reversedInterval", "End before start"),
		empty_interval: t("settings.workDiagnostics.kind.emptyInterval", "Start equals end"),
		stored_elapsed_discrepancy: t(
			"settings.workDiagnostics.kind.storedElapsedDiscrepancy",
			"Stored minutes differ from elapsed time",
		),
		deleted_work_payable: t(
			"settings.workDiagnostics.kind.deletedWorkPayable",
			"Deleted work still has a payable time record",
		),
		metadata_missing: t(
			"settings.workDiagnostics.kind.metadataMissing",
			"Assignment missing on time record",
		),
		metadata_conflict: t("settings.workDiagnostics.kind.metadataConflict", "Assignments disagree"),
		metadata_canonical_only: t(
			"settings.workDiagnostics.kind.metadataCanonicalOnly",
			"Assignment only on time record",
		),
		approval_state_conflict: t(
			"settings.workDiagnostics.kind.approvalStateConflict",
			"Approval states disagree",
		),
		approval_relationship_missing: t(
			"settings.workDiagnostics.kind.approvalRelationshipMissing",
			"Pending work without an approval request",
		),
		overlapping_work: t("settings.workDiagnostics.kind.overlappingWork", "Overlapping work"),
		manual_evidence_unreadable: t(
			"settings.workDiagnostics.kind.manualEvidenceUnreadable",
			"Manual submission evidence unreadable",
		),
		manual_zone_unrecorded: t(
			"settings.workDiagnostics.kind.manualZoneUnrecorded",
			"Manual entry time zone not recorded",
		),
		manual_interpretation_ambiguous: t(
			"settings.workDiagnostics.kind.manualInterpretationAmbiguous",
			"Manual entry time skipped or repeated by a clock change",
		),
		manual_interpretation_mismatch: t(
			"settings.workDiagnostics.kind.manualInterpretationMismatch",
			"Manual entry saved at different times than submitted",
		),
		manual_trimmed: t(
			"settings.workDiagnostics.kind.manualTrimmed",
			"Manual entry shortened on save",
		),
		manual_holiday_check_dates_differ: t(
			"settings.workDiagnostics.kind.manualHolidayCheckDatesDiffer",
			"Holiday check used different dates than the work",
		),
	};
	return labels[kind];
}

const actionLinkClassName =
	"font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
