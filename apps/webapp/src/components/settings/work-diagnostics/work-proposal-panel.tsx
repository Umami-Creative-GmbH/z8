"use client";

import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import type { HistoricalWorkProposalStatus } from "@/db/schema/completed-work";
import type { AppendAssuranceReport } from "@/lib/time-tracking/append-assurance";
import type { AppendContinuationProposal } from "@/lib/time-tracking/append-continuation";
import {
	REPAIRABLE_FIELDS,
	type RepairChangeField,
	type RepairChangeTarget,
} from "@/lib/time-tracking/historical-repair-fields";
import type { HistoricalRepairProposal } from "@/lib/time-tracking/historical-repair-proposal";
import type { HistoricalWorkProposalView } from "@/lib/time-tracking/historical-work-proposals";
import { useRouter } from "@/navigation";

type Translate = ReturnType<typeof useTranslate>["t"];

const ENDPOINT = "/api/time-entries/diagnostics/proposals";
const SELECT_CLASS =
	"flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/** Work with findings an explicit repair could address. */
export interface RepairTarget {
	workPeriodId: string;
	employeeId: string;
	findingKinds: string[];
}

/** An employee whose history needs review before appends, with the entries nothing follows. */
export interface ContinuationTarget {
	employeeId: string;
	candidates: { entryId: string; hash: string }[];
}

export interface WorkProposalPanelProps {
	proposals: HistoricalWorkProposalView[];
	/** Whether the organization has separately authorized application. */
	authorized: boolean;
	employeeLabels: Record<string, string>;
	repairTargets: RepairTarget[];
	continuationTargets: ContinuationTarget[];
}

/**
 * Employees whose append history needs review and has no position yet, with each
 * entry no other entry follows (by stored ID, or by hash when no ID is stored).
 */
export function continuationTargetsOf(
	reports: readonly { employeeId: string; report: AppendAssuranceReport }[],
): ContinuationTarget[] {
	return reports.flatMap(({ employeeId, report }) => {
		if (report.lineage.status !== "review_required" || report.continuity.status !== "not_adopted") {
			return [];
		}
		const followed = (entry: AppendAssuranceReport["entries"][number]) =>
			report.entries.some(
				(other) =>
					other.entryId !== entry.entryId &&
					(other.stored.previousEntryId === entry.entryId ||
						(other.stored.previousEntryId === null &&
							other.stored.previousHash === entry.stored.hash)),
			);
		const candidates = report.entries
			.filter((entry) => !followed(entry))
			.map((entry) => ({ entryId: entry.entryId, hash: entry.stored.hash }));
		return candidates.length > 0 ? [{ employeeId, candidates }] : [];
	});
}

function fieldLabel(field: RepairChangeField, t: Translate): string {
	switch (field) {
		case "start_at":
			return t("settings.workDiagnostics.proposals.field.startAt", "Start (UTC instant)");
		case "end_at":
			return t("settings.workDiagnostics.proposals.field.endAt", "End (UTC instant)");
		case "duration_minutes":
			return t("settings.workDiagnostics.proposals.field.durationMinutes", "Stored minutes");
		case "work_category_id":
			return t("settings.workDiagnostics.proposals.field.workCategoryId", "Work category ID");
		case "work_location_type":
			return t("settings.workDiagnostics.proposals.field.workLocationType", "Work location");
		case "project_id":
			return t("settings.workDiagnostics.proposals.field.projectId", "Project ID");
	}
}

function targetLabel(target: RepairChangeTarget, t: Translate): string {
	return target === "time_record"
		? t("settings.workDiagnostics.proposals.target.timeRecord", "Time record")
		: t("settings.workDiagnostics.proposals.target.workPeriod", "Work period");
}

function statusLabel(status: HistoricalWorkProposalStatus, t: Translate): string {
	switch (status) {
		case "proposed":
			return t("settings.workDiagnostics.proposals.status.proposed", "Awaiting approval");
		case "approved":
			return t("settings.workDiagnostics.proposals.status.approved", "Approved");
		case "applied":
			return t("settings.workDiagnostics.proposals.status.applied", "Applied");
		case "stale":
			return t("settings.workDiagnostics.proposals.status.stale", "Stale");
		case "rejected":
			return t("settings.workDiagnostics.proposals.status.rejected", "Rejected");
	}
}

function refusalMessage(body: { code?: string; reasons?: string[] } | null, t: Translate) {
	if (body?.code === "proposal_refused") {
		return t(
			"settings.workDiagnostics.proposals.refused",
			"This proposal cannot be made from current evidence: {reasons}",
			{ reasons: (body.reasons ?? []).join(", ") },
		);
	}
	if (body?.code === "repair_not_authorized") {
		return t(
			"settings.workDiagnostics.proposals.notAuthorized",
			"Applying proposals has not been authorized for this organization.",
		);
	}
	if (body?.code === "append_not_adopted") {
		return t(
			"settings.workDiagnostics.proposals.appendNotAdopted",
			"Continuations apply only once this organization uses evidence-based append admission.",
		);
	}
	return t("settings.workDiagnostics.proposals.failed", "The request could not be completed.");
}

async function post(body: Record<string, unknown>) {
	const response = await fetch(ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return { ok: response.ok, body: await response.json().catch(() => null) };
}

export function WorkProposalPanel({
	proposals,
	authorized,
	employeeLabels,
	repairTargets,
	continuationTargets,
}: WorkProposalPanelProps) {
	const { t } = useTranslate();
	const employeeLabel = (employeeId: string) => employeeLabels[employeeId] ?? employeeId;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					{t("settings.workDiagnostics.proposals.title", "Repair and continuation proposals")}
					<Badge variant={authorized ? "secondary" : "outline"}>
						{authorized
							? t("settings.workDiagnostics.proposals.authorized", "Application authorized")
							: t("settings.workDiagnostics.proposals.inactive", "Application not authorized")}
					</Badge>
				</CardTitle>
				<CardDescription>
					{t(
						"settings.workDiagnostics.proposals.description",
						"Conflicts outside evidence-only repair, and histories that cannot be admitted automatically, need an explicit proposal. An administrator approves the exact proposal; applying it re-checks the evidence and stops if anything changed. A continuation only guarantees continuity after its anchor; earlier history stays unverified.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<RepairProposalForm targets={repairTargets} employeeLabel={employeeLabel} t={t} />
				<ContinuationProposalForm
					targets={continuationTargets}
					employeeLabel={employeeLabel}
					t={t}
				/>
				<section className="space-y-3" aria-labelledby="work-proposals-list">
					<h3 id="work-proposals-list" className="text-sm font-medium">
						{t("settings.workDiagnostics.proposals.listTitle", "Proposals")}
					</h3>
					{proposals.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("settings.workDiagnostics.proposals.empty", "No proposals yet.")}
						</p>
					) : (
						<ul className="space-y-3">
							{proposals.map((proposal) => (
								<ProposalItem
									key={proposal.id}
									proposal={proposal}
									authorized={authorized}
									employeeLabel={employeeLabel}
									t={t}
								/>
							))}
						</ul>
					)}
				</section>
			</CardContent>
		</Card>
	);
}

type ChangeRow = { target: RepairChangeTarget; field: RepairChangeField; after: string };

function RepairProposalForm({
	targets,
	employeeLabel,
	t,
}: {
	targets: RepairTarget[];
	employeeLabel: (employeeId: string) => string;
	t: Translate;
}) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			workPeriodId: targets[0]?.workPeriodId ?? "",
			changes: [{ target: "time_record", field: "duration_minutes", after: "" }] as ChangeRow[],
			evidenceNote: "",
			reason: "",
		},
		onSubmit: async ({ value, formApi }) => {
			setError(null);
			try {
				const { ok, body } = await post({
					action: "propose_repair",
					proposalId: crypto.randomUUID(),
					workPeriodId: value.workPeriodId,
					changes: value.changes.map((change) => ({
						target: change.target,
						field: change.field,
						after: change.field === "duration_minutes" ? Number(change.after) : change.after.trim(),
					})),
					evidenceNote: value.evidenceNote.trim(),
					reason: value.reason.trim(),
				});
				if (!ok) {
					setError(refusalMessage(body, t));
					return;
				}
				formApi.reset();
				router.refresh();
			} catch {
				setError(refusalMessage(null, t));
			}
		},
	});

	if (targets.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.workDiagnostics.proposals.noRepairTargets",
					"No work in this scope has findings an explicit repair could address.",
				)}
			</p>
		);
	}

	return (
		<form
			className="space-y-3"
			aria-labelledby="work-proposal-repair-title"
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<h3 id="work-proposal-repair-title" className="text-sm font-medium">
				{t("settings.workDiagnostics.proposals.repairTitle", "Propose a field repair")}
			</h3>
			<form.Field name="workPeriodId">
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor="work-proposal-period">
							{t("settings.workDiagnostics.proposals.work", "Work period")}
						</Label>
						<select
							id="work-proposal-period"
							className={SELECT_CLASS}
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
						>
							{targets.map((target) => (
								<option key={target.workPeriodId} value={target.workPeriodId}>
									{`${employeeLabel(target.employeeId)} · ${target.workPeriodId} · ${target.findingKinds.join(", ")}`}
								</option>
							))}
						</select>
					</div>
				)}
			</form.Field>
			<form.Field name="changes" mode="array">
				{(changesField) => (
					<fieldset className="space-y-2">
						<legend className="text-sm font-medium">
							{t("settings.workDiagnostics.proposals.changes", "Changes")}
						</legend>
						{changesField.state.value.map((change, index) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until submitted
								key={index}
								className="grid gap-2 sm:grid-cols-[10rem_12rem_1fr_auto] sm:items-end"
							>
								<form.Field name={`changes[${index}].target`}>
									{(field) => (
										<div className="space-y-1">
											<Label htmlFor={`work-proposal-target-${index}`}>
												{t("settings.workDiagnostics.proposals.representation", "Representation")}
											</Label>
											<select
												id={`work-proposal-target-${index}`}
												className={SELECT_CLASS}
												value={field.state.value}
												onChange={(event) => {
													const target = event.target.value as RepairChangeTarget;
													field.handleChange(target);
													const current = form.getFieldValue(`changes[${index}].field`);
													if (!REPAIRABLE_FIELDS[target].includes(current)) {
														form.setFieldValue(
															`changes[${index}].field`,
															REPAIRABLE_FIELDS[target][0],
														);
													}
												}}
											>
												{(["time_record", "work_period"] as const).map((target) => (
													<option key={target} value={target}>
														{targetLabel(target, t)}
													</option>
												))}
											</select>
										</div>
									)}
								</form.Field>
								<form.Subscribe selector={(state) => state.values.changes[index]?.target}>
									{(target) => (
										<form.Field name={`changes[${index}].field`}>
											{(field) => (
												<div className="space-y-1">
													<Label htmlFor={`work-proposal-field-${index}`}>
														{t("settings.workDiagnostics.proposals.fieldName", "Field")}
													</Label>
													<select
														id={`work-proposal-field-${index}`}
														className={SELECT_CLASS}
														value={field.state.value}
														onChange={(event) =>
															field.handleChange(event.target.value as RepairChangeField)
														}
													>
														{REPAIRABLE_FIELDS[target ?? change.target].map((option) => (
															<option key={option} value={option}>
																{fieldLabel(option, t)}
															</option>
														))}
													</select>
												</div>
											)}
										</form.Field>
									)}
								</form.Subscribe>
								<form.Field
									name={`changes[${index}].after`}
									validators={{
										onSubmit: ({ value }) => {
											if (!value.trim()) {
												return t(
													"settings.workDiagnostics.proposals.valueRequired",
													"Enter the new value.",
												);
											}
											const minutes =
												form.getFieldValue(`changes[${index}].field`) === "duration_minutes";
											return minutes && !/^\d+$/.test(value.trim())
												? t(
														"settings.workDiagnostics.proposals.minutesInvalid",
														"Enter whole minutes (0 or more).",
													)
												: undefined;
										},
									}}
								>
									{(field) => (
										<div className="space-y-1">
											<Label htmlFor={`work-proposal-after-${index}`}>
												{t("settings.workDiagnostics.proposals.after", "New value")}
											</Label>
											<Input
												id={`work-proposal-after-${index}`}
												value={field.state.value}
												inputMode={
													form.getFieldValue(`changes[${index}].field`) === "duration_minutes"
														? "numeric"
														: undefined
												}
												onChange={(event) => field.handleChange(event.target.value)}
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
								<Button
									type="button"
									variant="ghost"
									size="icon"
									disabled={changesField.state.value.length === 1}
									onClick={() => changesField.removeValue(index)}
									aria-label={t("settings.workDiagnostics.proposals.removeChange", "Remove change")}
								>
									<IconTrash className="size-4" aria-hidden />
								</Button>
							</div>
						))}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() =>
								changesField.pushValue({
									target: "work_period",
									field: "duration_minutes",
									after: "",
								})
							}
						>
							<IconPlus className="mr-1 size-4" aria-hidden />
							{t("settings.workDiagnostics.proposals.addChange", "Add change")}
						</Button>
					</fieldset>
				)}
			</form.Field>
			<RequiredText
				form={form}
				name="evidenceNote"
				id="work-proposal-evidence"
				label={t("settings.workDiagnostics.proposals.evidenceNote", "Evidence for the new values")}
				required={t(
					"settings.workDiagnostics.proposals.evidenceRequired",
					"Describe the evidence that establishes the new values.",
				)}
			/>
			<RequiredText
				form={form}
				name="reason"
				id="work-proposal-reason"
				label={t("settings.workDiagnostics.proposals.reason", "Reason")}
				required={t("settings.workDiagnostics.proposals.reasonRequired", "Enter the reason.")}
			/>
			<SubmitButton
				form={form}
				label={t("settings.workDiagnostics.proposals.propose", "Create proposal")}
			/>
			{error ? (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}
		</form>
	);
}

function ContinuationProposalForm({
	targets,
	employeeLabel,
	t,
}: {
	targets: ContinuationTarget[];
	employeeLabel: (employeeId: string) => string;
	t: Translate;
}) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const first = targets[0];
	const form = useForm({
		defaultValues: {
			employeeId: first?.employeeId ?? "",
			anchorEntryId: first?.candidates[0]?.entryId ?? "",
			reason: "",
		},
		onSubmit: async ({ value, formApi }) => {
			setError(null);
			const target = targets.find((candidate) => candidate.employeeId === value.employeeId);
			const anchor = target?.candidates.find(
				(candidate) => candidate.entryId === value.anchorEntryId,
			);
			if (!anchor) return;
			try {
				const { ok, body } = await post({
					action: "propose_continuation",
					proposalId: crypto.randomUUID(),
					employeeId: value.employeeId,
					anchorEntryId: anchor.entryId,
					anchorHash: anchor.hash,
					reason: value.reason.trim(),
				});
				if (!ok) {
					setError(refusalMessage(body, t));
					return;
				}
				formApi.reset();
				router.refresh();
			} catch {
				setError(refusalMessage(null, t));
			}
		},
	});

	if (targets.length === 0) return null;

	return (
		<form
			className="space-y-3"
			aria-labelledby="work-proposal-continuation-title"
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<h3 id="work-proposal-continuation-title" className="text-sm font-medium">
				{t(
					"settings.workDiagnostics.proposals.continuationTitle",
					"Propose an append continuation",
				)}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.workDiagnostics.proposals.continuationDescription",
					"Future entries continue from the chosen existing entry. Nothing is rechained or removed, and history before the anchor keeps its issues.",
				)}
			</p>
			<form.Field name="employeeId">
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor="work-proposal-employee">
							{t("settings.workDiagnostics.proposals.employee", "Employee")}
						</Label>
						<select
							id="work-proposal-employee"
							className={SELECT_CLASS}
							value={field.state.value}
							onChange={(event) => {
								field.handleChange(event.target.value);
								const target = targets.find(
									(candidate) => candidate.employeeId === event.target.value,
								);
								form.setFieldValue("anchorEntryId", target?.candidates[0]?.entryId ?? "");
							}}
						>
							{targets.map((target) => (
								<option key={target.employeeId} value={target.employeeId}>
									{employeeLabel(target.employeeId)}
								</option>
							))}
						</select>
					</div>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.values.employeeId}>
				{(employeeId) => (
					<form.Field name="anchorEntryId">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="work-proposal-anchor">
									{t("settings.workDiagnostics.proposals.anchor", "Anchor entry")}
								</Label>
								<select
									id="work-proposal-anchor"
									className={SELECT_CLASS}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
								>
									{(
										targets.find((target) => target.employeeId === employeeId)?.candidates ?? []
									).map((candidate) => (
										<option key={candidate.entryId} value={candidate.entryId}>
											{`${candidate.entryId} · ${candidate.hash.slice(0, 12)}`}
										</option>
									))}
								</select>
							</div>
						)}
					</form.Field>
				)}
			</form.Subscribe>
			<RequiredText
				form={form}
				name="reason"
				id="work-proposal-continuation-reason"
				label={t("settings.workDiagnostics.proposals.anchorReason", "Why this anchor is suitable")}
				required={t("settings.workDiagnostics.proposals.reasonRequired", "Enter the reason.")}
			/>
			<SubmitButton
				form={form}
				label={t(
					"settings.workDiagnostics.proposals.proposeContinuation",
					"Create continuation proposal",
				)}
			/>
			{error ? (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}
		</form>
	);
}

// biome-ignore lint/suspicious/noExplicitAny: shared by two differently shaped TanStack forms
type AnyForm = any;

function RequiredText({
	form,
	name,
	id,
	label,
	required,
}: {
	form: AnyForm;
	name: string;
	id: string;
	label: string;
	required: string;
}) {
	return (
		<form.Field
			name={name}
			validators={{
				onSubmit: ({ value }: { value: string }) => (value.trim() ? undefined : required),
			}}
		>
			{(field: AnyForm) => (
				<div className="space-y-2">
					<Label htmlFor={id}>{label}</Label>
					<Textarea
						id={id}
						value={field.state.value}
						onChange={(event) => field.handleChange(event.target.value)}
						maxLength={1000}
						rows={2}
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
	);
}

function SubmitButton({ form, label }: { form: AnyForm; label: string }) {
	return (
		<form.Subscribe selector={(state: { isSubmitting: boolean }) => state.isSubmitting}>
			{(isSubmitting: boolean) => (
				<Button type="submit" disabled={isSubmitting}>
					{isSubmitting ? (
						<IconLoader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden />
					) : null}
					{label}
				</Button>
			)}
		</form.Subscribe>
	);
}

function formatValue(value: string | number | null, t: Translate) {
	return value === null
		? t("settings.workDiagnostics.proposals.emptyValue", "(empty)")
		: String(value);
}

function ProposalItem({
	proposal,
	authorized,
	employeeLabel,
	t,
}: {
	proposal: HistoricalWorkProposalView;
	authorized: boolean;
	employeeLabel: (employeeId: string) => string;
	t: Translate;
}) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
	const [rejecting, setRejecting] = useState(false);
	const actor = (value: { id: string; name: string | null } | null) =>
		value?.name ?? value?.id ?? "";

	const act = async (body: Record<string, unknown>) => {
		setBusy(true);
		setMessage(null);
		try {
			const { ok, body: result } = await post({ proposalId: proposal.id, ...body });
			if (!ok) {
				setMessage({ kind: "error", text: refusalMessage(result, t) });
				return;
			}
			if (result?.status === "stale") {
				setMessage({
					kind: "info",
					text: t(
						"settings.workDiagnostics.proposals.staleResult",
						"Evidence changed since this proposal was made. Nothing else was written; create a new proposal from current evidence.",
					),
				});
			}
			router.refresh();
		} catch {
			setMessage({ kind: "error", text: refusalMessage(null, t) });
		} finally {
			setBusy(false);
		}
	};

	const rejectForm = useForm({
		defaultValues: { note: "" },
		onSubmit: ({ value }) => act({ action: "reject", note: value.note.trim() }),
	});

	const content = proposal.proposal;
	return (
		<li className="space-y-2 rounded-md border p-3">
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="outline">
					{proposal.kind === "field_repair"
						? t("settings.workDiagnostics.proposals.kind.fieldRepair", "Field repair")
						: t("settings.workDiagnostics.proposals.kind.continuation", "Append continuation")}
				</Badge>
				<Badge variant={proposal.status === "applied" ? "secondary" : "outline"}>
					{statusLabel(proposal.status, t)}
				</Badge>
				<span className="text-sm">{employeeLabel(proposal.employeeId)}</span>
			</div>
			<p className="text-sm">{proposal.reason}</p>
			<p className="text-xs text-muted-foreground">
				{t("settings.workDiagnostics.proposals.proposedBy", "Proposed by {name}", {
					name: actor(proposal.proposedBy),
				})}
				{proposal.approvedBy
					? ` · ${t("settings.workDiagnostics.proposals.approvedBy", "approved by {name}", {
							name: actor(proposal.approvedBy),
						})}`
					: ""}
				{proposal.resolvedBy
					? ` · ${t("settings.workDiagnostics.proposals.resolvedBy", "resolved by {name}", {
							name: actor(proposal.resolvedBy),
						})}`
					: ""}
			</p>
			{proposal.kind === "field_repair" ? (
				<RepairDetails proposal={content as HistoricalRepairProposal} t={t} />
			) : (
				<ContinuationDetails proposal={content as AppendContinuationProposal} t={t} />
			)}
			<div className="flex flex-wrap gap-2">
				{proposal.status === "proposed" ? (
					<Button
						size="sm"
						disabled={busy}
						onClick={() => act({ action: "approve", fingerprint: proposal.fingerprint })}
					>
						{t("settings.workDiagnostics.proposals.approve", "Approve this proposal")}
					</Button>
				) : null}
				{proposal.status === "approved" ? (
					<Button size="sm" disabled={busy || !authorized} onClick={() => act({ action: "apply" })}>
						{t("settings.workDiagnostics.proposals.apply", "Apply")}
					</Button>
				) : null}
				{proposal.status === "proposed" || proposal.status === "approved" ? (
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => setRejecting(!rejecting)}
					>
						{t("settings.workDiagnostics.proposals.reject", "Reject")}
					</Button>
				) : null}
			</div>
			{rejecting ? (
				<form
					className="space-y-2"
					onSubmit={(event) => {
						event.preventDefault();
						rejectForm.handleSubmit();
					}}
				>
					<rejectForm.Field name="note">
						{(field) => (
							<>
								<Label htmlFor={`work-proposal-reject-${proposal.id}`}>
									{t("settings.workDiagnostics.proposals.rejectNote", "Why is it rejected?")}
								</Label>
								<Textarea
									id={`work-proposal-reject-${proposal.id}`}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									maxLength={1000}
									rows={2}
								/>
								<Button
									type="submit"
									size="sm"
									variant="destructive"
									disabled={busy || !field.state.value.trim()}
								>
									{t("settings.workDiagnostics.proposals.confirmReject", "Reject proposal")}
								</Button>
							</>
						)}
					</rejectForm.Field>
				</form>
			) : null}
			{message ? (
				<p
					className={message.kind === "error" ? "text-sm text-destructive" : "text-sm"}
					role={message.kind === "error" ? "alert" : "status"}
				>
					{message.text}
				</p>
			) : null}
		</li>
	);
}

function RepairDetails({ proposal, t }: { proposal: HistoricalRepairProposal; t: Translate }) {
	const consequences = proposal.consequences;
	return (
		<div className="space-y-2 text-sm">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>
							{t("settings.workDiagnostics.proposals.representation", "Representation")}
						</TableHead>
						<TableHead>{t("settings.workDiagnostics.proposals.fieldName", "Field")}</TableHead>
						<TableHead>{t("settings.workDiagnostics.proposals.before", "Before")}</TableHead>
						<TableHead>{t("settings.workDiagnostics.proposals.after", "New value")}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{proposal.changes.map((change) => (
						<TableRow key={`${change.target}:${change.field}`}>
							<TableCell>{targetLabel(change.target, t)}</TableCell>
							<TableCell>{fieldLabel(change.field, t)}</TableCell>
							<TableCell className="font-mono text-xs">{formatValue(change.before, t)}</TableCell>
							<TableCell className="font-mono text-xs">{formatValue(change.after, t)}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			<details>
				<summary className="cursor-pointer text-muted-foreground">
					{t(
						"settings.workDiagnostics.proposals.inspect",
						"Evidence, uncertainty and consequences",
					)}
				</summary>
				<dl className="mt-2 grid gap-1 sm:grid-cols-[12rem_1fr]">
					<dt className="text-muted-foreground">
						{t("settings.workDiagnostics.proposals.evidence", "Evidence")}
					</dt>
					<dd>{proposal.evidence.note}</dd>
					<dt className="text-muted-foreground">
						{t("settings.workDiagnostics.proposals.findings", "Findings now")}
					</dt>
					<dd className="font-mono text-xs">
						{proposal.evidence.findings.map((finding) => finding.kind).join(", ") || "—"}
					</dd>
					<dt className="text-muted-foreground">
						{t("settings.workDiagnostics.proposals.remaining", "Findings remaining after")}
					</dt>
					<dd className="font-mono text-xs">
						{proposal.uncertainty.remainingFindings.map((finding) => finding.kind).join(", ") ||
							"—"}
					</dd>
					<dt className="text-muted-foreground">
						{t("settings.workDiagnostics.proposals.consequences", "Consequences")}
					</dt>
					<dd className="font-mono text-xs">
						{[
							...consequences.approval.effects,
							...consequences.allocation.effects,
							...consequences.replay.effects,
							...consequences.payroll.effects,
						].join(", ")}
					</dd>
				</dl>
			</details>
		</div>
	);
}

function ContinuationDetails({
	proposal,
	t,
}: {
	proposal: AppendContinuationProposal;
	t: Translate;
}) {
	return (
		<div className="space-y-2 text-sm">
			<p>
				{t("settings.workDiagnostics.proposals.anchorSummary", "Anchor {entry} ({hash})", {
					entry: proposal.anchor.entryId,
					hash: proposal.anchor.hash.slice(0, 12),
				})}
			</p>
			<details>
				<summary className="cursor-pointer text-muted-foreground">
					{t(
						"settings.workDiagnostics.proposals.inspect",
						"Evidence, uncertainty and consequences",
					)}
				</summary>
				<dl className="mt-2 grid gap-1 sm:grid-cols-[12rem_1fr]">
					<dt className="text-muted-foreground">
						{t("settings.workDiagnostics.proposals.candidates", "Competing heads")}
					</dt>
					<dd className="font-mono text-xs">
						{proposal.candidates
							.map((candidate) => `${candidate.entryId} ${candidate.type} ${candidate.timestamp}`)
							.join("; ")}
					</dd>
					<dt className="text-muted-foreground">
						{t("settings.workDiagnostics.proposals.issues", "Unresolved history")}
					</dt>
					<dd className="font-mono text-xs">
						{proposal.issues.map((issue) => issue.kind).join(", ")}
					</dd>
					<dt className="text-muted-foreground">
						{t("settings.workDiagnostics.proposals.limitations", "Accepted limitations")}
					</dt>
					<dd className="font-mono text-xs">
						{proposal.limitations.map((limitation) => limitation.code).join(", ")}
					</dd>
					<dt className="text-muted-foreground">
						{t("settings.workDiagnostics.proposals.consequences", "Consequences")}
					</dt>
					<dd className="font-mono text-xs">{Object.values(proposal.consequences).join(", ")}</dd>
				</dl>
			</details>
		</div>
	);
}
