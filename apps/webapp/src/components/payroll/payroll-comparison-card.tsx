"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { inspectPayrollBaselineAction } from "@/app/[locale]/(app)/payroll/baseline-actions";
import {
	listCompatiblePayrollBaselinesAction,
	preparePayrollComparisonAction,
} from "@/app/[locale]/(app)/payroll/comparison-actions";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { PayrollBaselineSummary } from "@/lib/payroll-export/baseline-types";
import type {
	PayrollCodeTotal,
	PayrollRowChange,
	ReviewedPayrollComparison,
} from "@/lib/payroll-export/comparison-types";
import type {
	SupportedPayrollContribution,
	SupportedPayrollOutputRow,
} from "@/lib/payroll-export/supported-output-evidence";

type Preparation = Extract<
	Awaited<ReturnType<typeof preparePayrollComparisonAction>>,
	{ success: true }
>["data"];
type Translate = ReturnType<typeof useTranslate>["t"];
interface ComparisonScope {
	formatId?: PayrollBaselineSummary["formatId"];
	startDate: string;
	endDate: string;
	employeeIds?: string[];
}

export function PayrollComparisonCard(scope: ComparisonScope) {
	const scopeKey = JSON.stringify([
		scope.formatId ?? "datev_lohn",
		scope.startDate,
		scope.endDate,
		scope.employeeIds?.toSorted(),
	]);
	return <ComparisonWorkspace key={scopeKey} scope={scope} />;
}

function ComparisonWorkspace({ scope }: { scope: ComparisonScope }) {
	const { t } = useTranslate();
	const id = useId();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const queryClient = useQueryClient();
	const baselines = useQuery({
		queryKey: ["payroll", "comparisonBaselines", scope],
		queryFn: async () => {
			const response = await listCompatiblePayrollBaselinesAction({
				...scope,
				formatId: scope.formatId ?? "datev_lohn",
			});
			if (!response.success) throw new Error(response.error);
			return response.data;
		},
		refetchOnWindowFocus: false,
	});
	const sorted = [
		...(baselines.data ?? []).filter(
			(item) => item.formatId === (scope.formatId ?? "datev_lohn"),
		),
	].sort(
		(a, b) =>
			Temporal.Instant.compare(b.completedAt, a.completedAt) ||
			b.id.localeCompare(a.id),
	);
	const selection =
		sorted.find((item) => item.id === selectedId && eligible(item)) ??
		sorted.find(eligible);
	return (
		<Card className="shadow-none" role="region" aria-labelledby={`${id}-title`}>
			<CardHeader>
				<CardTitle>
					<h2 id={`${id}-title`}>
						{t("payroll.comparison.title", "Compare payroll")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"payroll.comparison.description",
						"Review the supported payroll changes since a successful export before preparing a correction.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="rounded-md border bg-muted/50 p-3 text-sm">
					{t(
						"payroll.comparison.exclusions",
						"Expense reimbursements are excluded. This comparison covers supported work, absence and overtime payout hours only.",
					)}
				</p>
				<Button
					variant="outline"
					size="sm"
					disabled={baselines.isFetching}
					onClick={() => {
						void baselines.refetch();
						void queryClient.invalidateQueries({
							queryKey: ["payroll", "baseline"],
						});
					}}
				>
					{t(
						"payroll.comparison.refreshBaselines",
						"Refresh compatible baselines",
					)}
				</Button>
				{baselines.isPending ? (
					<p role="status">
						{t(
							"payroll.comparison.loading",
							"Loading compatible baseline exports…",
						)}
					</p>
				) : baselines.isError ? (
					<p role="alert">
						{t(
							"payroll.comparison.loadFailed",
							"Compatible baseline exports could not be loaded.",
						)}
					</p>
				) : !selection ? (
					<p role="status">
						{t(
							"payroll.comparison.none",
							"No compatible payroll baseline is available for this period and employee selection.",
						)}
					</p>
				) : (
					<>
						<div className="space-y-2">
							<Label htmlFor={id}>
								{t("payroll.comparison.baseline", "Comparison baseline")}
							</Label>
							<Select value={selection.id} onValueChange={setSelectedId}>
								<SelectTrigger id={id} className="min-h-11 w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{sorted.filter(eligible).map((item) => (
										<SelectItem key={item.id} value={item.id}>
											{item.formatId} · {utcTime(item.completedAt)} ·{" "}
											{item.destination.mandantennummer} /{" "}
											{item.destination.beraternummer} · {item.id}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<ComparisonSelection
							key={selection.id}
							baseline={selection}
							scope={scope}
							t={t}
						/>
					</>
				)}
			</CardContent>
		</Card>
	);
}

function ComparisonSelection({
	baseline,
	scope,
	t,
}: {
	baseline: PayrollBaselineSummary;
	scope: ComparisonScope;
	t: Translate;
}) {
	const [preparation, setPreparation] = useState<Preparation | null>(null);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	async function prepare() {
		setPending(true);
		setFailed(false);
		setPreparation(null);
		try {
			const response = await preparePayrollComparisonAction({
				...scope,
				baselineId: baseline.id,
			});
			if (!mounted.current) return;
			if (response.success) setPreparation(response.data);
			else setFailed(true);
		} catch {
			if (mounted.current) setFailed(true);
		} finally {
			if (mounted.current) setPending(false);
		}
	}
	const detail = useQuery({
		queryKey: ["payroll", "baseline", baseline.id],
		queryFn: async () => {
			const response = await inspectPayrollBaselineAction(baseline.id);
			if (!response.success) throw new Error(response.error);
			return response.data;
		},
		refetchOnWindowFocus: false,
	});
	const retainedRows = detail.data?.evidence?.output?.rows;
	const retainedNames = useMemo(() => {
		const names = new Map<string, Set<string>>();
		for (const row of retainedRows ?? []) {
			for (const contribution of row.contributions) {
				const name = [contribution.firstName, contribution.lastName]
					.filter(Boolean)
					.join(" ");
				if (!name) continue;
				const employeeNames =
					names.get(contribution.employeeId) ?? new Set<string>();
				employeeNames.add(name);
				names.set(contribution.employeeId, employeeNames);
			}
		}
		return names;
	}, [retainedRows]);
	return (
		<div className="space-y-4">
			{baseline.availability === "empty" ? (
				<p role="status">
					{t(
						"payroll.comparison.emptyBaseline",
						"This is a valid empty baseline: the successful export contained no supported payroll rows.",
					)}
				</p>
			) : null}
			<dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
				<Fact
					label={t("payroll.comparison.format", "Payroll format")}
					value={baseline.formatId}
				/>
				<Fact
					label={t("payroll.comparison.baselineId", "Baseline ID")}
					value={baseline.id}
				/>
				<Fact
					label={t("payroll.comparison.destination", "Payroll destination")}
					value={
						baseline.formatId === "datev_lohn"
							? `${baseline.destination.mandantennummer} / ${baseline.destination.beraternummer}`
							: baseline.destination.configId
					}
				/>
				<Fact
					label={t("payroll.comparison.configId", "Export configuration ID")}
					value={baseline.destination.configId}
				/>
				<Fact
					label={t("payroll.comparison.period", "Retained period")}
					value={`${baseline.period.startDate} – ${baseline.period.endDate}`}
				/>
				<Fact
					label={t("payroll.comparison.created", "Created (UTC)")}
					value={utcTime(baseline.createdAt)}
				/>
				<Fact
					label={t("payroll.comparison.completed", "Completed (UTC)")}
					value={utcTime(baseline.completedAt)}
				/>
			</dl>
			<div>
				<h3 className="text-sm font-medium">
					{t("payroll.comparison.scope", "Complete retained employee scope")}
				</h3>
				<ul className="mt-2 space-y-1 text-sm">
					{baseline.employeeIds.map((employeeId) => (
						<li
							key={employeeId}
							className="break-all font-mono [content-visibility:auto]"
							translate="no"
						>
							<span className="block font-sans">
								{retainedNames.get(employeeId)?.size
									? [...(retainedNames.get(employeeId) ?? [])].join(" / ")
									: t(
											"payroll.comparison.retainedNameUnavailable",
											"Retained name unavailable",
										)}
							</span>
							{employeeId}
						</li>
					))}
				</ul>
			</div>
			{detail.isPending ? (
				<p role="status">
					{t("payroll.comparison.loadingMetadata", "Loading baseline filters…")}
				</p>
			) : detail.isError || !detail.data?.evidence ? (
				<p role="alert">
					{t(
						"payroll.comparison.unavailable",
						"This baseline is no longer available for comparison.",
					)}
				</p>
			) : (
				<>
					<details className="rounded-md border p-3">
						<summary className="min-h-11 cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
							{t("payroll.comparison.filters", "Effective baseline filters")}
						</summary>
						<pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
							{JSON.stringify(detail.data.evidence.filters, null, 2)}
						</pre>
					</details>
					<Button
						disabled={pending}
						onClick={() => {
							void prepare();
						}}
					>
						{pending
							? t("payroll.comparison.preparing", "Preparing comparison…")
							: preparation?.status === "ready"
								? t("payroll.comparison.refresh", "Refresh comparison")
								: t("payroll.comparison.prepare", "Prepare comparison")}
					</Button>
					{pending ? (
						<p role="status">
							{t(
								"payroll.comparison.preparingStatus",
								"Collecting current payroll data. Wait for the reviewed result…",
							)}
						</p>
					) : null}
					{failed ? (
						<p role="alert">
							{t(
								"payroll.comparison.prepareFailed",
								"The comparison could not be prepared. Try preparing it again.",
							)}
						</p>
					) : null}
					{preparation?.status === "ready" ? (
						<ReviewedComparison result={preparation.result} t={t} />
					) : preparation ? (
						<PreparationIssue preparation={preparation} t={t} />
					) : null}
				</>
			)}
		</div>
	);
}

function eligible(baseline: PayrollBaselineSummary) {
	return (
		baseline.availability === "available" || baseline.availability === "empty"
	);
}
function utcTime(value: string) {
	return `${Temporal.Instant.from(value).toZonedDateTimeISO("UTC").toPlainDateTime().toString({ smallestUnit: "second" }).replace("T", " ")} UTC`;
}
function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="break-all tabular-nums">{value}</dd>
		</div>
	);
}

function ReviewedComparison({
	result,
	t,
}: {
	result: ReviewedPayrollComparison;
	t: Translate;
}) {
	const { comparison } = result;
	const [page, setPage] = useState(0);
	const pageSize = 50;
	const rows = comparison.rows.slice(page * pageSize, (page + 1) * pageSize);
	return (
		<section
			className="space-y-4"
			aria-label={t("payroll.comparison.reviewed", "Reviewed comparison")}
		>
			<dl className="grid gap-3 text-sm sm:grid-cols-2">
				<Fact
					label={t(
						"payroll.comparison.preparedAt",
						"Current data prepared at (UTC)",
					)}
					value={utcTime(result.preparedAt)}
				/>
				<Fact
					label={t("payroll.comparison.resultId", "Reviewed result ID")}
					value={result.id}
				/>
			</dl>
			<p className="text-sm text-muted-foreground">
				{t(
					"payroll.comparison.frozen",
					"This result and its download use the same prepared data. Refresh the comparison to include later edits.",
				)}
			</p>
			<Button asChild variant="outline">
				<a href={`/api/payroll/comparisons/${encodeURIComponent(result.id)}`}>
					{t(
						"payroll.comparison.download",
						"Download reviewed comparison (CSV)",
					)}
				</a>
			</Button>
			<p role="status">
				{comparison.hasPayrollImpact
					? t("payroll.comparison.changed", "Supported payroll changes found.")
					: t(
							"payroll.comparison.noChanges",
							"No supported payroll changes found.",
						)}
			</p>
			<dl className="grid gap-3 text-sm sm:grid-cols-3">
				<Fact
					label={t("payroll.comparison.addedRows", "Added rows")}
					value={String(comparison.summary.addedRows)}
				/>
				<Fact
					label={t("payroll.comparison.removedRows", "Removed rows")}
					value={String(comparison.summary.removedRows)}
				/>
				<Fact
					label={t("payroll.comparison.changedRows", "Changed rows")}
					value={String(comparison.summary.changedRows)}
				/>
			</dl>
			<details className="rounded-md border p-3">
				<summary className="min-h-11 cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
					{t("payroll.comparison.changeEvents", "Recorded change events")}
				</summary>
				{result.explanations?.length ? (
					<ul className="space-y-3">
						{result.explanations.map((event, index) => (
							<li
								key={JSON.stringify([
									event.kind,
									event.sourceId,
									event.action,
									index,
								])}
								className="rounded-md border p-3 text-sm [content-visibility:auto]"
							>
								<dl className="space-y-2">
									<Fact
										label={t("payroll.comparison.employeeId", "Employee ID")}
										value={event.employeeId}
									/>
									<Fact
										label={t("payroll.comparison.sourceId", "Source ID")}
										value={event.sourceId}
									/>
									<Fact
										label={t(
											"payroll.comparison.recordedAction",
											"Recorded action",
										)}
										value={event.action}
									/>
									<Fact
										label={t(
											"payroll.comparison.changeActor",
											"Recorded change actor",
										)}
										value={
											event.actorId ??
											t(
												"payroll.comparison.actorUnavailable",
												"Actor unavailable",
											)
										}
									/>
									<Fact
										label={t(
											"payroll.comparison.changeReason",
											"Recorded change reason",
										)}
										value={
											event.reason ??
											t(
												"payroll.comparison.reasonUnavailable",
												"Reason unavailable",
											)
										}
									/>
								</dl>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							"payroll.comparison.noChangeEvents",
							"No recorded change explanation is available. Actors and reasons cannot be inferred from original source notes.",
						)}
					</p>
				)}
			</details>
			<CodeTotals totals={comparison.totals} t={t} />
			{comparison.sourceOnlyChanges.length ? (
				<details className="rounded-md border p-3">
					<summary className="min-h-11 cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
						{t(
							"payroll.comparison.sourceOnly",
							"Source changes only; no payroll output impact",
						)}
					</summary>
					<p className="mb-3 text-sm text-muted-foreground">
						{t(
							"payroll.comparison.sourceOnlyDescription",
							"Source records changed, but the supported payroll output values are identical.",
						)}
					</p>
					<ul className="space-y-4">
						{comparison.sourceOnlyChanges.map((change) => (
							<li
								key={change.key}
								className="space-y-2 border-t pt-3 text-sm [content-visibility:auto]"
							>
								<p className="break-all font-mono" translate="no">
									{change.employeeIds.join(", ")}
								</p>
								<SourceComparison
									oldRow={change.oldRow}
									newRow={change.newRow}
									t={t}
								/>
							</li>
						))}
					</ul>
				</details>
			) : null}
			{comparison.employees.length ? (
				<details className="rounded-md border p-3">
					<summary className="min-h-11 cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
						{t(
							"payroll.comparison.employees",
							"Employee changes and wage-code totals",
						)}
					</summary>
					<ul className="space-y-4">
						{comparison.employees.map((employee) => (
							<li
								key={employee.employeeId}
								className="space-y-2 border-t pt-3 text-sm [content-visibility:auto]"
							>
								<h4 className="font-medium">
									{[employee.firstName, employee.lastName]
										.filter(Boolean)
										.join(" ") || employee.employeeId}
								</h4>
								<p className="break-all font-mono" translate="no">
									{employee.employeeId}
								</p>
								<p>{changeLabel(employee.status, t)}</p>
								<dl className="grid gap-2 sm:grid-cols-2">
									<Fact
										label={t(
											"payroll.comparison.oldPersonnel",
											"Baseline personnel numbers",
										)}
										value={employee.oldPersonnelNumbers.join(", ") || "—"}
									/>
									<Fact
										label={t(
											"payroll.comparison.newPersonnel",
											"Current personnel numbers",
										)}
										value={employee.newPersonnelNumbers.join(", ") || "—"}
									/>
								</dl>
								<CodeTotals totals={employee.totals} t={t} />
							</li>
						))}
					</ul>
				</details>
			) : null}
			{rows.length ? (
				<>
					<Table>
						<caption className="p-2 text-left text-sm font-medium">
							{t(
								"payroll.comparison.outputRows",
								"Changed payroll output rows",
							)}
						</caption>
						<TableHeader>
							<TableRow>
								<TableHead scope="col">
									{t("payroll.comparison.change", "Change")}
								</TableHead>
								<TableHead scope="col">
									{t("payroll.comparison.oldOutput", "Baseline output")}
								</TableHead>
								<TableHead scope="col">
									{t("payroll.comparison.newOutput", "Current output")}
								</TableHead>
								<TableHead scope="col" className="text-right">
									{t("payroll.comparison.delta", "Delta (hours)")}
								</TableHead>
								<TableHead scope="col">
									{t("payroll.comparison.sources", "Source contributions")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<ChangeRow key={row.key} row={row} t={t} />
							))}
						</TableBody>
					</Table>
					{comparison.rows.length > pageSize ? (
						<div className="flex flex-wrap items-center gap-3">
							<Button
								variant="outline"
								disabled={page === 0}
								onClick={() => setPage((current) => current - 1)}
							>
								{t("payroll.comparison.previous", "Previous changes")}
							</Button>
							<p role="status" className="text-sm tabular-nums">
								{page * pageSize + 1}–
								{Math.min((page + 1) * pageSize, comparison.rows.length)} /{" "}
								{comparison.rows.length}
							</p>
							<Button
								variant="outline"
								disabled={(page + 1) * pageSize >= comparison.rows.length}
								onClick={() => setPage((current) => current + 1)}
							>
								{t("payroll.comparison.next", "Next changes")}
							</Button>
						</div>
					) : null}
				</>
			) : null}
		</section>
	);
}

function CodeTotals({
	totals,
	t,
}: {
	totals: PayrollCodeTotal[];
	t: Translate;
}) {
	if (!totals.length) return null;
	return (
		<Table>
			<caption className="p-2 text-left text-sm font-medium">
				{t("payroll.comparison.totals", "Totals by wage code and unit")}
			</caption>
			<TableHeader>
				<TableRow>
					<TableHead scope="col">
						{t("payroll.comparison.wageCode", "Wage code")}
					</TableHead>
					<TableHead scope="col">
						{t("payroll.comparison.unit", "Unit")}
					</TableHead>
					<TableHead scope="col" className="text-right">
						{t("payroll.comparison.oldQuantity", "Baseline quantity")}
					</TableHead>
					<TableHead scope="col" className="text-right">
						{t("payroll.comparison.newQuantity", "Current quantity")}
					</TableHead>
					<TableHead scope="col" className="text-right">
						{t("payroll.comparison.signedDelta", "Signed delta")}
					</TableHead>
					<TableHead scope="col">
						{t("payroll.comparison.outputImpact", "Payroll output impact")}
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{totals.map((total) => (
					<TableRow key={JSON.stringify([total.wageTypeCode, total.unit])}>
						<TableCell className="font-mono" translate="no">
							{total.wageTypeCode}
						</TableCell>
						<TableCell>
							{total.unit === "hours"
								? t("payroll.comparison.hours", "Hours")
								: total.unit}
						</TableCell>
						<TableCell className="text-right tabular-nums">
							{total.oldQuantity}
						</TableCell>
						<TableCell className="text-right tabular-nums">
							{total.newQuantity}
						</TableCell>
						<TableCell className="text-right tabular-nums">
							{total.delta}
						</TableCell>
						<TableCell>
							{total.hasPayrollImpact
								? t("payroll.comparison.impactYes", "Changed")
								: t("payroll.comparison.impactNo", "None")}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
function ChangeRow({ row, t }: { row: PayrollRowChange; t: Translate }) {
	return (
		<TableRow>
			<TableCell className="align-top">{changeLabel(row.status, t)}</TableCell>
			<TableCell className="min-w-52 whitespace-normal align-top">
				<OutputRow row={row.oldRow} t={t} />
			</TableCell>
			<TableCell className="min-w-52 whitespace-normal align-top">
				<OutputRow row={row.newRow} t={t} />
			</TableCell>
			<TableCell className="text-right align-top tabular-nums">
				{row.delta}
			</TableCell>
			<TableCell className="min-w-60 whitespace-normal align-top">
				<SourceComparison oldRow={row.oldRow} newRow={row.newRow} t={t} />
			</TableCell>
		</TableRow>
	);
}
function OutputRow({
	row,
	t,
}: {
	row: SupportedPayrollOutputRow | null;
	t: Translate;
}) {
	if (!row) return <p>{t("payroll.comparison.rowAbsent", "No output row")}</p>;
	return (
		<dl className="space-y-2 text-sm">
			<Fact
				label={t("payroll.comparison.personnel", "Personnel number")}
				value={row.personnelNumber}
			/>
			<Fact
				label={t("payroll.comparison.wageCode", "Wage code")}
				value={row.wageTypeCode}
			/>
			<Fact
				label={t("payroll.comparison.date", "Exported date")}
				value={row.date}
			/>
			<Fact
				label={t("payroll.comparison.hours", "Hours")}
				value={row.quantity}
			/>
			{Object.entries(row.renderedColumns ?? {}).map(([column, value]) => (
				<Fact key={column} label={column} value={value || "—"} />
			))}
			<Fact
				label={t("payroll.comparison.note", "Exported note")}
				value={row.note || "—"}
			/>
		</dl>
	);
}
function SourceComparison({
	oldRow,
	newRow,
	t,
}: {
	oldRow: SupportedPayrollOutputRow | null;
	newRow: SupportedPayrollOutputRow | null;
	t: Translate;
}) {
	const [open, setOpen] = useState(false);
	return (
		<details onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary className="min-h-11 cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
				{t("payroll.comparison.sources", "Source contributions")}
			</summary>
			{open ? (
				<>
					<p className="mb-3 text-xs text-muted-foreground">
						{t(
							"payroll.comparison.sourceCaution",
							"Original source notes describe the source record; they do not establish why the payroll output changed.",
						)}
					</p>
					<ContributionList
						title={t("payroll.comparison.baselineSources", "Baseline sources")}
						rows={oldRow?.contributions ?? []}
						t={t}
					/>
					<ContributionList
						title={t(
							"payroll.comparison.currentSources",
							"Current sources at preparation",
						)}
						rows={newRow?.contributions ?? []}
						t={t}
					/>
				</>
			) : null}
		</details>
	);
}
function ContributionList({
	title,
	rows,
	t,
}: {
	title: string;
	rows: SupportedPayrollContribution[];
	t: Translate;
}) {
	const [page, setPage] = useState(0);
	const pageSize = 50;
	return (
		<section aria-label={title} className="mb-3 space-y-2">
			<h4 className="font-medium">{title}</h4>
			{rows.length ? (
				<ul className="space-y-3">
					{rows
						.slice(page * pageSize, (page + 1) * pageSize)
						.map((contribution, index) => (
							<li
								key={JSON.stringify([
									contribution.kind,
									contribution.sourceId,
									index,
								])}
								className="space-y-2 rounded-md border p-3 [content-visibility:auto]"
							>
								<p className="font-medium">
									{contribution.kind === "work"
										? t("payroll.comparison.work", "Work")
										: contribution.kind === "absence"
											? t("payroll.comparison.absence", "Absence")
											: t("payroll.comparison.overtime", "Overtime payout")}
								</p>
								<p>
									{[contribution.firstName, contribution.lastName]
										.filter(Boolean)
										.join(" ") ||
										t("payroll.comparison.nameUnavailable", "Name unavailable")}
								</p>
								<dl className="space-y-2">
									<Fact
										label={t("payroll.comparison.employeeId", "Employee ID")}
										value={contribution.employeeId}
									/>
									<Fact
										label={t("payroll.comparison.sourceId", "Source ID")}
										value={contribution.sourceId}
									/>
									<Fact
										label={t("payroll.comparison.revision", "Source revision")}
										value={
											contribution.sourceRevision ??
											t(
												"payroll.comparison.revisionUnavailable",
												"Revision unavailable",
											)
										}
									/>
									<Fact
										label={t(
											"payroll.comparison.actor",
											"Recorded source actor",
										)}
										value={
											contribution.sourceActorId ??
											t(
												"payroll.comparison.actorUnavailable",
												"Actor unavailable",
											)
										}
									/>
									<Fact
										label={t(
											"payroll.comparison.sourceHours",
											"Unrounded source hours",
										)}
										value={String(contribution.hours)}
									/>
									<Fact
										label={t(
											"payroll.comparison.sourceReason",
											"Original source note / reason",
										)}
										value={
											contribution.reason ??
											t(
												"payroll.comparison.reasonUnavailable",
												"Reason unavailable",
											)
										}
									/>
									{contribution.kind === "work" ? (
										<>
											<Fact
												label={t("payroll.comparison.startUtc", "Start (UTC)")}
												value={
													contribution.facts.startAt
														? utcTime(contribution.facts.startAt)
														: "—"
												}
											/>
											<Fact
												label={t("payroll.comparison.endUtc", "End (UTC)")}
												value={
													contribution.facts.endAt
														? utcTime(contribution.facts.endAt)
														: "—"
												}
											/>
											<Fact
												label={t(
													"payroll.comparison.category",
													"Work category",
												)}
												value={
													contribution.facts.workCategoryName ??
													contribution.facts.workCategoryId ??
													"—"
												}
											/>
											<Fact
												label={t("payroll.comparison.project", "Project")}
												value={
													contribution.facts.projectName ??
													contribution.facts.projectId ??
													"—"
												}
											/>
										</>
									) : contribution.kind === "absence" ? (
										<>
											<Fact
												label={t(
													"payroll.comparison.absencePeriod",
													"Absence period",
												)}
												value={`${contribution.facts.startDate} – ${contribution.facts.endDate}`}
											/>
											<Fact
												label={t(
													"payroll.comparison.absenceCategory",
													"Absence category",
												)}
												value={
													contribution.facts.absenceCategoryName ??
													contribution.facts.absenceCategoryId
												}
											/>
										</>
									) : (
										<Fact
											label={t("payroll.comparison.payoutDay", "Payout day")}
											value={contribution.facts.day}
										/>
									)}
									<Fact
										label={t("payroll.comparison.mapping", "Wage mapping ID")}
										value={contribution.facts.mappingId ?? "—"}
									/>
								</dl>
							</li>
						))}
				</ul>
			) : (
				<p className="text-muted-foreground">
					{t("payroll.comparison.noSources", "No contributions on this side.")}
				</p>
			)}
			{rows.length > pageSize ? (
				<div className="flex flex-wrap items-center gap-3">
					<Button
						variant="outline"
						disabled={page === 0}
						onClick={() => setPage((current) => current - 1)}
					>
						{t(
							"payroll.comparison.previousSources",
							"Previous source contributions",
						)}
					</Button>
					<p role="status" className="tabular-nums">
						{page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)}{" "}
						/ {rows.length}
					</p>
					<Button
						variant="outline"
						disabled={(page + 1) * pageSize >= rows.length}
						onClick={() => setPage((current) => current + 1)}
					>
						{t("payroll.comparison.nextSources", "Next source contributions")}
					</Button>
				</div>
			) : null}
		</section>
	);
}
function changeLabel(
	status: PayrollRowChange["status"] | "source_only" | "unchanged",
	t: Translate,
) {
	switch (status) {
		case "added":
			return t("payroll.comparison.added", "Added");
		case "removed":
			return t("payroll.comparison.removed", "Removed");
		case "changed":
			return t("payroll.comparison.changedLabel", "Changed");
		case "source_only":
			return t(
				"payroll.comparison.sourceOnly",
				"Source changes only; no payroll output impact",
			);
		case "unchanged":
			return t("payroll.comparison.unchanged", "Unchanged");
	}
}

function PreparationIssue({
	preparation,
	t,
}: {
	preparation: Exclude<Preparation, { status: "ready" }>;
	t: Translate;
}) {
	if (preparation.status === "unavailable")
		return (
			<p role="alert">
				{t(
					"payroll.comparison.unavailable",
					"This baseline is no longer available for comparison.",
				)}
			</p>
		);
	if (preparation.status === "incompatible")
		return (
			<div role="alert" className="space-y-2 rounded-md border p-3 text-sm">
				<p>
					{t(
						"payroll.comparison.incompatible",
						"The selected baseline is incompatible with the current payroll scope. Select a compatible baseline or restore the original period, employees and destination.",
					)}
				</p>
				<p>{compatibilityReason(preparation.reason, t)}</p>
			</div>
		);
	return (
		<div
			role="alert"
			className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm"
		>
			<p>
				{t(
					"payroll.comparison.blocked",
					"Current payroll data is blocked. Resolve these issues and prepare the comparison again.",
				)}
			</p>
			<ul className="space-y-2">
				{preparation.blockers.map((blocker, index) => (
					<li key={JSON.stringify([blocker.employeeId, blocker.reason, index])}>
						{blocker.employeeId ? (
							<p className="break-all font-mono" translate="no">
								{blocker.employeeId}
							</p>
						) : null}
						<p>{blockerReason(blocker.reason, t)}</p>
						<code className="break-all text-xs" translate="no">
							{blocker.reason}
						</code>
					</li>
				))}
			</ul>
		</div>
	);
}
function blockerReason(reason: string, t: Translate) {
	switch (reason) {
		case "pending_absence":
			return t(
				"payroll.comparison.pendingAbsence",
				"An absence is awaiting approval. Review the employee’s absences before preparing a complete comparison.",
			);
		case "pending_absence_change":
			return t(
				"payroll.comparison.pendingAbsenceChange",
				"An absence change is awaiting approval. Review the employee’s absence changes before preparing a complete comparison.",
			);
		case "missing_personnel_identifier":
			return t(
				"payroll.comparison.missingIdentifier",
				"Missing personnel identifier. Update the employee’s payroll identifier.",
			);
		case "duplicate_personnel_identifier":
			return t(
				"payroll.comparison.duplicateIdentifier",
				"Duplicate personnel identifier. Assign a unique payroll identifier to each employee.",
			);
		case "invalid_configuration":
			return t(
				"payroll.comparison.invalidConfiguration",
				"Payroll configuration is invalid. Review the payroll export settings.",
			);
		case "unmapped_overtime_payout":
			return t(
				"payroll.comparison.unmappedOvertime",
				"An overtime payout has no wage mapping. Review the overtime wage mapping.",
			);
		default:
			return t(
				"payroll.comparison.reviewBlocker",
				"Review the employee’s current time and approval records to resolve this payroll blocker.",
			);
	}
}
function compatibilityReason(reason: string, t: Translate) {
	switch (reason) {
		case "period_changed":
			return t(
				"payroll.comparison.periodChanged",
				"The payroll period differs from the baseline.",
			);
		case "employee_scope_changed":
			return t(
				"payroll.comparison.scopeChanged",
				"The complete employee scope differs from the baseline.",
			);
		case "destination_unavailable":
			return t(
				"payroll.comparison.destinationUnavailable",
				"The original payroll destination is unavailable.",
			);
		case "destination_changed":
			return t(
				"payroll.comparison.destinationChanged",
				"The DATEV client or consultant number differs from the baseline.",
			);
		case "employee_windows_changed":
			return t(
				"payroll.comparison.windowsChanged",
				"Employee period boundaries differ from the baseline.",
			);
		case "effective_filters_changed":
			return t(
				"payroll.comparison.filtersChanged",
				"The effective export filters differ from the baseline.",
			);
		default:
			return t(
				"payroll.comparison.scopeIncompatible",
				"The original export scope cannot be reproduced.",
			);
	}
}
