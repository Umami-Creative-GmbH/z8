import { DateTime } from "luxon";
import type { WorksCouncilPortalModel } from "@/lib/works-council/review-data";

function formatTimestamp(timestamp: string) {
	return DateTime.fromISO(timestamp).toLocaleString(DateTime.DATETIME_MED);
}

function MetricCard({ label, value }: { label: string; value: number }) {
	return (
		<section
			aria-label={label}
			className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
		>
			<p className="text-sm font-medium text-muted-foreground">{label}</p>
			<p className="mt-2 font-semibold text-2xl tabular-nums tracking-tight">{value}</p>
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

	return (
		<section className="space-y-6 p-6" aria-labelledby="works-council-title">
			<div className="space-y-1">
				<h1 id="works-council-title" className="text-balance text-2xl font-semibold tracking-tight">
					Works Council
				</h1>
				<p className="text-muted-foreground">
					Privacy-filtered workforce review for the selected period.
				</p>
			</div>

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
		</section>
	);
}
