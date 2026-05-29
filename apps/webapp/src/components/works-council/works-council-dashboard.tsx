import { DateTime } from "luxon";
import type { SuppressedValue } from "@/lib/works-council/privacy";
import type { WorksCouncilPortalModel } from "@/lib/works-council/review-data";

function formatTimestamp(timestamp: string) {
	return DateTime.fromISO(timestamp).toLocaleString(DateTime.DATETIME_MED);
}

function formatDateRange(range: { start: string; end: string }) {
	const start = DateTime.fromISO(range.start, { zone: "utc" }).toLocaleString(DateTime.DATE_MED);
	const end = DateTime.fromISO(range.end, { zone: "utc" }).toLocaleString(DateTime.DATE_MED);
	return `${start} - ${end}`;
}

function formatDateInput(value: string) {
	return DateTime.fromISO(value, { zone: "utc" }).toISODate() ?? "";
}

function buildExportHref(range: { start: string; end: string }) {
	const params = new URLSearchParams({
		from: formatDateInput(range.start),
		to: formatDateInput(range.end),
	});
	return `/works-council/export?${params.toString()}`;
}

function formatIdentityLabel(entry: { employeeName: string | null; identityState: string }) {
	if (entry.employeeName) return entry.employeeName;
	if (entry.identityState === "insufficient_data") return "Insufficient data";
	return "Identity hidden";
}

function MetricCard({ label, value }: { label: string; value: SuppressedValue<number> }) {
	return (
		<section
			aria-label={label}
			className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
		>
			<p className="text-sm font-medium text-muted-foreground">{label}</p>
			{value.state === "available" ? (
				<p className="mt-2 font-semibold text-2xl tabular-nums tracking-tight">{value.value}</p>
			) : (
				<p className="mt-2 font-medium text-muted-foreground text-sm">Insufficient data</p>
			)}
		</section>
	);
}

export function WorksCouncilDashboard({ model }: { model: WorksCouncilPortalModel }) {
	if (model.state === "disabled") {
		return (
			<section className="space-y-2 p-6" aria-labelledby="works-council-title">
				<h1 id="works-council-title" className="text-balance text-2xl font-semibold tracking-tight">
					Works Council
				</h1>
				<p className="text-muted-foreground">
					Works Council Mode is not enabled for this organization.
				</p>
			</section>
		);
	}

	const fromValue = formatDateInput(model.dateRange.start);
	const toValue = formatDateInput(model.dateRange.end);

	return (
		<section className="space-y-6 p-6" aria-labelledby="works-council-title">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-1">
					<h1
						id="works-council-title"
						className="text-balance text-2xl font-semibold tracking-tight"
					>
						Works Council
					</h1>
					<p className="text-muted-foreground">
						Privacy-filtered workforce review for the selected period.
					</p>
					<p className="font-medium text-sm">{formatDateRange(model.dateRange)}</p>
				</div>
				{model.exportEnabled && (
					<form method="post" action={buildExportHref(model.dateRange)}>
						<button
							type="submit"
							className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm shadow-xs hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							Export review pack
						</button>
					</form>
				)}
			</div>

			<form method="get" className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
				<div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
					<div className="space-y-2">
						<label className="font-medium text-sm" htmlFor="works-council-from">
							From
						</label>
						<input
							id="works-council-from"
							name="from"
							type="date"
							aria-label="From"
							autoComplete="off"
							defaultValue={fromValue}
							className="flex h-10 w-full rounded-md border border-input px-3 py-2 text-sm text-foreground"
						/>
					</div>
					<div className="space-y-2">
						<label className="font-medium text-sm" htmlFor="works-council-to">
							To
						</label>
						<input
							id="works-council-to"
							name="to"
							type="date"
							aria-label="To"
							autoComplete="off"
							defaultValue={toValue}
							className="flex h-10 w-full rounded-md border border-input px-3 py-2 text-sm text-foreground"
						/>
					</div>
					<button
						type="submit"
						className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 font-medium text-sm shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Update Range
					</button>
				</div>
			</form>

			<div className="grid gap-4 md:grid-cols-3">
				<MetricCard label="Policy changes" value={model.dashboard.policyChangeCount} />
				<MetricCard label="Schedule changes" value={model.dashboard.scheduleChangeCount} />
				<MetricCard label="Compliance findings" value={model.dashboard.complianceFindingCount} />
			</div>

			<div className="rounded-lg border bg-card text-card-foreground shadow-sm">
				<div className="border-b px-4 py-3">
					<h2 className="font-semibold tracking-tight">Change review log</h2>
					<p className="text-sm text-muted-foreground">
						Workforce-impacting changes scoped to this organization and period.
					</p>
				</div>
				{model.changeLog.length === 0 ? (
					<p className="px-4 py-6 text-sm text-muted-foreground">
						No changes found for this period.
					</p>
				) : (
					<ul className="divide-y">
						{model.changeLog.map((entry) => (
							<li key={entry.id} className="px-4 py-3">
								<p className="break-words font-medium">{entry.summary}</p>
								<p className="text-sm text-muted-foreground">
									{entry.actorLabel} - {formatTimestamp(entry.timestamp)}
								</p>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="rounded-lg border bg-card text-card-foreground shadow-sm">
				<div className="border-b px-4 py-3">
					<h2 className="font-semibold tracking-tight">Schedule review</h2>
					<p className="text-sm text-muted-foreground">
						Privacy-filtered schedule entries for the selected period.
					</p>
				</div>
				{model.scheduleReview.length === 0 ? (
					<p className="px-4 py-6 text-sm text-muted-foreground">
						No schedule entries found for this period.
					</p>
				) : (
					<ul className="divide-y">
						{model.scheduleReview.map((entry) => (
							<li key={entry.id} className="px-4 py-3">
								<p className="break-words font-medium">{entry.teamName ?? "Unassigned team"}</p>
								<p className="text-sm text-muted-foreground">
									{formatIdentityLabel(entry)} - {formatTimestamp(entry.startsAt)} to{" "}
									{formatTimestamp(entry.endsAt)}
								</p>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
