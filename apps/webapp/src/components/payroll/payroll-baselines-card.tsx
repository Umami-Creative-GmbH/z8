"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { Temporal } from "temporal-polyfill";
import {
	inspectPayrollBaselineAction,
	listPayrollBaselinesAction,
} from "@/app/[locale]/(app)/payroll/baseline-actions";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type {
	PayrollBaselineDetail,
	PayrollBaselineSummary,
} from "@/lib/payroll-export/baseline-types";
import {
	payrollDestinationLabel,
	payrollFormatLabel,
} from "@/lib/payroll-export/supported-format";
import type {
	SupportedPayrollContribution,
	SupportedPayrollOutputRow,
} from "@/lib/payroll-export/supported-output-evidence";
import { queryKeys } from "@/lib/query/keys";
import { payrollUtcTime as utcTime } from "./payroll-evidence-format";
import {
	EvidenceFact as Fact,
	PayrollSourceFacts as RetainedSourceFacts,
} from "./payroll-evidence-presentation";

type Translate = ReturnType<typeof useTranslate>["t"];

export function PayrollBaselinesCard({
	formatId,
	startDate,
	endDate,
}: {
	formatId?: string;
	startDate: string;
	endDate: string;
}) {
	const { t } = useTranslate();
	const selectorId = useId();
	const queryClient = useQueryClient();
	const baselines = useQuery({
		queryKey: [
			...queryKeys.payroll.baselines({ startDate, endDate }),
			formatId,
		],
		queryFn: async () => {
			const result = await listPayrollBaselinesAction({
				startDate,
				endDate,
				...(formatId ? { formatId } : {}),
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		refetchOnWindowFocus: false,
	});
	return (
		<Card role="region" aria-labelledby={`${selectorId}-title`}>
			<CardHeader>
				<CardTitle>
					<h2 id={`${selectorId}-title`}>
						{t("payroll.baselines.title", "Payroll baseline exports")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"payroll.baselines.description",
						"Inspect the historical values retained from successful exports for 24 calendar months after completion, independently of the downloadable file.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
					{t(
						"payroll.baselines.exclusions",
						"Expense reimbursements are excluded. Only supported work, absence and overtime payout hours are shown.",
					)}
				</p>
				<Button
					variant="outline"
					size="sm"
					disabled={baselines.isFetching}
					onClick={() => {
						void baselines.refetch();
						void queryClient.invalidateQueries({
							queryKey: queryKeys.payroll.baselineDetails(),
						});
					}}
				>
					{t("payroll.baselines.refresh", "Refresh baselines")}
				</Button>
				{baselines.isPending ? (
					<p role="status">
						{t("payroll.baselines.loading", "Loading baseline exports…")}
					</p>
				) : baselines.isError ? (
					<p role="alert">
						{t(
							"payroll.baselines.loadFailed",
							"Baseline exports could not be loaded.",
						)}
					</p>
				) : (
					<BaselineBrowser
						baselines={baselines.data}
						selectorId={selectorId}
						t={t}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function BaselineBrowser({
	baselines,
	selectorId,
	t,
}: {
	baselines: PayrollBaselineSummary[];
	selectorId: string;
	t: Translate;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const sorted = [...baselines].sort(
		(a, b) =>
			Temporal.Instant.compare(b.completedAt, a.completedAt) ||
			b.id.localeCompare(a.id),
	);
	const selection =
		sorted.find((item) => item.id === selectedId) ??
		sorted.find(
			(item) =>
				item.availability === "available" || item.availability === "empty",
		) ??
		sorted[0];
	if (!selection)
		return (
			<p role="status">
				{t(
					"payroll.baselines.none",
					"No successful Payroll baseline exports are available for this period.",
				)}
			</p>
		);
	return (
		<>
			<div className="space-y-2">
				<Label htmlFor={selectorId}>
					{t("payroll.baselines.select", "Baseline export")}
				</Label>
				<select
					id={selectorId}
					name="baseline-export"
					value={selection.id}
					onChange={(event) => setSelectedId(event.target.value)}
					className="h-11 w-full rounded-md border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
				>
					{sorted.map((item) => (
						<option key={item.id} value={item.id}>
							{payrollFormatLabel(item.formatId)} · {utcTime(item.completedAt)}{" "}
							· {payrollDestinationLabel(item.formatId, item.destination)} ·{" "}
							{item.id} · {availabilityLabel(item.availability, t)}
						</option>
					))}
				</select>
			</div>
			<BaselineInspection baselineId={selection.id} t={t} />
		</>
	);
}

function BaselineInspection({
	baselineId,
	t,
}: {
	baselineId: string;
	t: Translate;
}) {
	const detail = useQuery({
		queryKey: queryKeys.payroll.baseline(baselineId),
		queryFn: async () => {
			const result = await inspectPayrollBaselineAction(baselineId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		refetchOnWindowFocus: false,
	});
	if (detail.isPending)
		return (
			<p role="status">
				{t(
					"payroll.baselines.loadingDetails",
					"Loading retained export details…",
				)}
			</p>
		);
	if (detail.isError)
		return (
			<p role="alert">
				{t(
					"payroll.baselines.detailFailed",
					"The selected baseline could not be loaded.",
				)}
			</p>
		);
	if (!detail.data)
		return (
			<p role="status">
				{t(
					"payroll.baselines.notAccessible",
					"The selected baseline is no longer available to inspect.",
				)}
			</p>
		);
	return (
		<BaselineDetail key={detail.data.summary.id} detail={detail.data} t={t} />
	);
}

function availabilityLabel(
	availability: PayrollBaselineSummary["availability"],
	t: Translate,
): string {
	switch (availability) {
		case "available":
			return t("payroll.baselines.available", "Available");
		case "empty":
			return t("payroll.baselines.empty", "Valid empty baseline");
		case "legacy":
			return t("payroll.baselines.legacy", "Historical evidence unavailable");
		case "expired":
			return t("payroll.baselines.expired", "Evidence expired");
		case "erased":
			return t("payroll.baselines.erased", "Evidence erased");
		case "corrupt":
			return t("payroll.baselines.corrupt", "Evidence integrity check failed");
		case "unsupported_version":
			return t(
				"payroll.baselines.unsupportedVersion",
				"Evidence version unsupported",
			);
	}
}

function BaselineDetail({
	detail: { summary, evidence },
	t,
}: {
	detail: PayrollBaselineDetail;
	t: Translate;
}) {
	return (
		<div className="space-y-4">
			<p role="status">{availabilityLabel(summary.availability, t)}</p>
			{availabilityExplanation(summary.availability, t) ? (
				<p className="rounded-md border p-3 text-sm" role="status">
					{availabilityExplanation(summary.availability, t)}
				</p>
			) : null}
			<dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
				<div>
					<dt className="text-muted-foreground">
						{t("payroll.baselines.jobId", "Export job ID")}
					</dt>
					<dd className="break-all font-mono">{summary.jobId}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("payroll.baselines.identity", "Baseline ID")}
					</dt>
					<dd className="break-all font-mono">{summary.id}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("payroll.baselines.payrollDestination", "Payroll destination")}
					</dt>
					<dd>
						{summary.formatId === "datev_lohn"
							? `${summary.destination.mandantennummer} / ${summary.destination.beraternummer}`
							: summary.destination.configId}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("payroll.baselines.configId", "Export configuration ID")}
					</dt>
					<dd className="break-all">{summary.destination.configId}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("payroll.baselines.period", "Retained period")}
					</dt>
					<dd>
						{summary.period.startDate} – {summary.period.endDate}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("payroll.baselines.created", "Created (UTC)")}
					</dt>
					<dd>{utcTime(summary.createdAt)}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("payroll.baselines.completed", "Completed (UTC)")}
					</dt>
					<dd>{utcTime(summary.completedAt)}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("payroll.baselines.expires", "Evidence expires (UTC)")}
					</dt>
					<dd>{utcTime(summary.expiresAt)}</dd>
				</div>
			</dl>
			<div>
				<h3 className="text-sm font-medium">
					{t("payroll.baselines.scope", "Complete retained employee scope")}
				</h3>
				<ul className="mt-2 space-y-1 text-sm">
					{summary.employeeIds.map((id) => (
						<li key={id} className="break-all font-mono">
							{id}
						</li>
					))}
				</ul>
			</div>
			{evidence &&
			(summary.availability === "available" ||
				summary.availability === "empty") ? (
				<RetainedEvidence evidence={evidence} t={t} />
			) : null}
		</div>
	);
}

function RetainedEvidence({
	evidence,
	t,
}: {
	evidence: NonNullable<PayrollBaselineDetail["evidence"]>;
	t: Translate;
}) {
	const [page, setPage] = useState(0);
	const pageSize = 50;
	const visibleRows = evidence.output.rows.slice(
		page * pageSize,
		(page + 1) * pageSize,
	);
	return (
		<div className="space-y-4">
			<details className="rounded-md border p-3">
				<summary className="min-h-11 cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
					{t(
						"payroll.baselines.windowsAndFilters",
						"Retained employee boundaries, filters and configuration",
					)}
				</summary>
				<Table>
					<caption className="sr-only">
						{t(
							"payroll.baselines.employeeBoundaries",
							"Retained employee boundaries",
						)}
					</caption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">
								{t("payroll.baselines.employeeId", "Employee ID")}
							</TableHead>
							<TableHead scope="col">
								{t("payroll.baselines.timezone", "Retained timezone")}
							</TableHead>
							<TableHead scope="col">
								{t(
									"payroll.baselines.windowStart",
									"Period start (UTC, inclusive)",
								)}
							</TableHead>
							<TableHead scope="col">
								{t(
									"payroll.baselines.windowEnd",
									"Period end (UTC, exclusive)",
								)}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{evidence.employeeWindows.map((window) => (
							<TableRow key={window.employeeId}>
								<TableCell className="font-mono">{window.employeeId}</TableCell>
								<TableCell>{window.timezone}</TableCell>
								<TableCell className="tabular-nums">
									{utcTime(window.startUtc)}
								</TableCell>
								<TableCell className="tabular-nums">
									{utcTime(window.endExclusiveUtc)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				<h4 className="mt-3 text-sm font-medium">
					{t("payroll.baselines.filters", "Effective export filters")}
				</h4>
				<pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs">
					{JSON.stringify(evidence.filters, null, 2)}
				</pre>
				<h4 className="mt-3 text-sm font-medium">
					{t("payroll.baselines.config", "Historical payroll configuration")}
				</h4>
				<pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs">
					{JSON.stringify(evidence.config, null, 2)}
				</pre>
			</details>
			{evidence.output.rows.length > 0 ? (
				<Table>
					<caption className="p-2 text-left text-sm font-medium">
						{t("payroll.baselines.rows", "Actual supported exported rows")}
					</caption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">
								{t(
									"payroll.baselines.personnelNumber",
									"Exported personnel number",
								)}
							</TableHead>
							<TableHead scope="col">
								{t("payroll.baselines.wageCode", "Exported wage code")}
							</TableHead>
							<TableHead scope="col">
								{t("payroll.baselines.rowDate", "Exported date")}
							</TableHead>
							<TableHead scope="col" className="text-right">
								{t("payroll.baselines.quantity", "Exported hours")}
							</TableHead>
							<TableHead scope="col">
								{t("payroll.baselines.note", "Exported note")}
							</TableHead>
							<TableHead scope="col">
								{t("payroll.baselines.contributions", "Source contributions")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{visibleRows.map((row) => (
							<ExportedRow
								key={JSON.stringify([
									row.personnelNumber,
									row.wageTypeCode,
									row.date,
								])}
								row={row}
								t={t}
							/>
						))}
					</TableBody>
				</Table>
			) : null}
			{evidence.output.rows.length > pageSize ? (
				<div className="flex flex-wrap items-center gap-3">
					<Button
						variant="outline"
						disabled={page === 0}
						onClick={() => setPage((current) => current - 1)}
					>
						{t("payroll.baselines.previousRows", "Previous exported rows")}
					</Button>
					<p role="status" className="text-sm tabular-nums">
						{t("payroll.baselines.rowPage", "Rows {start}–{end} of {count}", {
							start: page * pageSize + 1,
							end: Math.min((page + 1) * pageSize, evidence.output.rows.length),
							count: evidence.output.rows.length,
						})}
					</p>
					<Button
						variant="outline"
						disabled={(page + 1) * pageSize >= evidence.output.rows.length}
						onClick={() => setPage((current) => current + 1)}
					>
						{t("payroll.baselines.nextRows", "Next exported rows")}
					</Button>
				</div>
			) : null}
		</div>
	);
}

function ExportedRow({
	row,
	t,
}: {
	row: SupportedPayrollOutputRow;
	t: Translate;
}) {
	const [open, setOpen] = useState(false);
	const [page, setPage] = useState(0);
	const pageSize = 50;
	return (
		<TableRow>
			<TableCell className="align-top font-mono">
				{row.personnelNumber}
			</TableCell>
			<TableCell className="align-top font-mono">{row.wageTypeCode}</TableCell>
			<TableCell className="align-top">{row.date}</TableCell>
			<TableCell className="text-right align-top tabular-nums">
				{row.quantity}
				{Object.entries(row.renderedColumns ?? {}).map(([column, value]) => (
					<div
						key={column}
						className="whitespace-nowrap text-xs text-muted-foreground"
					>
						{column}: {value || "—"}
					</div>
				))}
			</TableCell>
			<TableCell className="whitespace-normal align-top">{row.note}</TableCell>
			<TableCell className="min-w-60 whitespace-normal align-top">
				<details onToggle={(event) => setOpen(event.currentTarget.open)}>
					<summary className="min-h-11 cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
						{t("payroll.baselines.contributions", "Source contributions")}
					</summary>
					{open ? (
						<>
							<ul className="space-y-3">
								{row.contributions
									.slice(page * pageSize, (page + 1) * pageSize)
									.map((contribution) => (
										<li
											key={JSON.stringify([
												contribution.kind,
												contribution.sourceId,
											])}
											className="rounded-md border p-3"
										>
											<RetainedContribution contribution={contribution} t={t} />
										</li>
									))}
							</ul>
							{row.contributions.length > pageSize ? (
								<div className="mt-3 flex flex-wrap items-center gap-3">
									<Button
										variant="outline"
										disabled={page === 0}
										onClick={() => setPage((current) => current - 1)}
									>
										{t(
											"payroll.baselines.previousSources",
											"Previous source contributions",
										)}
									</Button>
									<p role="status" className="text-sm tabular-nums">
										{page * pageSize + 1}–
										{Math.min((page + 1) * pageSize, row.contributions.length)}{" "}
										/ {row.contributions.length}
									</p>
									<Button
										variant="outline"
										disabled={(page + 1) * pageSize >= row.contributions.length}
										onClick={() => setPage((current) => current + 1)}
									>
										{t(
											"payroll.baselines.nextSources",
											"Next source contributions",
										)}
									</Button>
								</div>
							) : null}
						</>
					) : null}
				</details>
			</TableCell>
		</TableRow>
	);
}

function RetainedContribution({
	contribution,
	t,
}: {
	contribution: SupportedPayrollContribution;
	t: Translate;
}) {
	const name = [contribution.firstName, contribution.lastName]
		.filter(Boolean)
		.join(" ");
	return (
		<div className="space-y-2 text-sm">
			<p className="font-medium">{contributionKind(contribution.kind, t)}</p>
			<p>
				{name ||
					t(
						"payroll.baselines.identityUnavailable",
						"Historical name unavailable",
					)}
			</p>
			<dl className="grid gap-2">
				<Fact
					label={t("payroll.baselines.employeeId", "Employee ID")}
					value={contribution.employeeId}
				/>
				<Fact
					label={t("payroll.baselines.sourceId", "Historical source reference")}
					value={contribution.sourceId}
				/>
				<Fact
					label={t(
						"payroll.baselines.sourceRevision",
						"Historical source revision",
					)}
					value={
						contribution.sourceRevision ??
						t("payroll.baselines.revisionUnavailable", "Revision unavailable")
					}
				/>
				<Fact
					label={t(
						"payroll.baselines.sourceActor",
						"Historical source actor ID",
					)}
					value={
						contribution.sourceActorId ??
						t("payroll.baselines.actorUnavailable", "Actor unavailable")
					}
				/>
				<Fact
					label={t(
						"payroll.baselines.unroundedHours",
						"Unrounded contribution (hours)",
					)}
					value={String(contribution.hours)}
				/>
				<Fact
					label={t("payroll.baselines.reason", "Recorded reason")}
					value={
						contribution.reason ??
						t("payroll.baselines.reasonUnavailable", "Reason unavailable")
					}
				/>
				<Fact
					label={t("payroll.baselines.mapping", "Historical mapping ID")}
					value={
						contribution.facts.mappingId ??
						t("payroll.baselines.notRetained", "Not retained")
					}
				/>
				<RetainedSourceFacts contribution={contribution} t={t} />
			</dl>
		</div>
	);
}

function contributionKind(
	kind: SupportedPayrollContribution["kind"],
	t: Translate,
): string {
	switch (kind) {
		case "work":
			return t("payroll.baselines.work", "Work");
		case "absence":
			return t("payroll.baselines.absence", "Absence");
		case "overtime_payout":
			return t("payroll.baselines.payout", "Overtime payout");
	}
}

function availabilityExplanation(
	availability: PayrollBaselineSummary["availability"],
	t: Translate,
): string | null {
	switch (availability) {
		case "available":
			return null;
		case "empty":
			return t(
				"payroll.baselines.emptyExplanation",
				"This is a valid empty baseline: the successful export contained no supported work, absence or overtime payout rows.",
			);
		case "legacy":
			return t(
				"payroll.baselines.legacyExplanation",
				"This export predates retained comparison evidence. Historical values cannot be reconstructed.",
			);
		case "expired":
			return t(
				"payroll.baselines.expiredExplanation",
				"The 24-month retention period has ended. Historical evidence is unavailable.",
			);
		case "erased":
			return t(
				"payroll.baselines.erasedExplanation",
				"Employee erasure made this baseline incomplete. Historical rows are unavailable.",
			);
		case "corrupt":
			return t(
				"payroll.baselines.corruptExplanation",
				"The retained evidence failed its integrity check. Historical rows are unavailable.",
			);
		case "unsupported_version":
			return t(
				"payroll.baselines.unsupportedVersionExplanation",
				"This evidence version cannot be read. Historical rows are unavailable.",
			);
	}
}
