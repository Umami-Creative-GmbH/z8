import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/datetime/format";
import type {
	ExportOperationsActivityItem,
	ExportOperationsAlert,
	ExportOperationsCockpitData,
	ExportOperationsUpcomingRun,
} from "@/lib/export-operations/get-export-operations-cockpit";
import { Link } from "@/navigation";

type TranslateFn = (key: string, defaultValue?: string) => string;

interface ExportOperationsDashboardProps {
	t: TranslateFn;
	data: ExportOperationsCockpitData;
}

export function ExportOperationsDashboard({ t, data }: ExportOperationsDashboardProps) {
	return (
		<div className="space-y-6">
			{data.errors.summary ? (
				<Alert>
					<AlertTitle>{t("settings.exportOperations.partialData", "Partial data")}</AlertTitle>
					<AlertDescription>{data.errors.summary}</AlertDescription>
				</Alert>
			) : null}

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<SummaryCard
					title={t("settings.exportOperations.summary.activeSchedules", "Active schedules")}
					value={String(data.summary.activeSchedules)}
					description={t(
						"settings.exportOperations.summary.activeSchedulesDescription",
						"Enabled recurring export schedules.",
					)}
				/>
				<SummaryCard
					title={t("settings.exportOperations.summary.failedRuns", "Failed runs (7 days)")}
					value={String(data.summary.failedRunsLast7Days)}
					description={t(
						"settings.exportOperations.summary.failedRunsDescription",
						"Failed payroll, audit, and scheduled runs in the last week.",
					)}
				/>
				<SummaryCard
					title={t("settings.exportOperations.summary.lastPayrollExport", "Last payroll export")}
					value={formatOptionalDate(data.summary.lastPayrollExportAt, t)}
					description={t(
						"settings.exportOperations.summary.lastPayrollExportDescription",
						"Most recent payroll export completion.",
					)}
				/>
				<SummaryCard
					title={t("settings.exportOperations.summary.lastAuditPack", "Last audit pack")}
					value={formatOptionalDate(data.summary.lastAuditPackageAt, t)}
					description={t(
						"settings.exportOperations.summary.lastAuditPackDescription",
						"Most recent audit package generation.",
					)}
				/>
			</div>

			<div className="grid gap-6 xl:grid-cols-2">
				<AlertsCard t={t} alerts={data.alerts} error={data.errors.alerts} />
				<UpcomingRunsCard t={t} runs={data.upcomingRuns} error={data.errors.upcomingRuns} />
			</div>

			<RecentActivityCard t={t} items={data.recentActivity} error={data.errors.recentActivity} />
		</div>
	);
}

function SummaryCard({ title, value, description }: { title: string; value: string; description: string }) {
	return (
		<Card>
			<CardHeader>
				<CardDescription>{description}</CardDescription>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-2xl font-semibold tracking-tight">{value}</p>
			</CardContent>
		</Card>
	);
}

function AlertsCard({
	t,
	alerts,
	error,
}: {
	t: TranslateFn;
	alerts: ExportOperationsAlert[];
	error: string | null;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2 className="text-base font-semibold">{t("settings.exportOperations.alerts.title", "Alerts")}</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"settings.exportOperations.alerts.description",
						"Export issues that may need administrator attention.",
					)}
				</CardDescription>
				{error ? <p className="text-muted-foreground text-sm">{error}</p> : null}
			</CardHeader>
			<CardContent>
				{error ? null : alerts.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("settings.exportOperations.alerts.empty", "No alerts right now")}
					</p>
				) : (
					<div className="space-y-3">
						{alerts.map((alert) => (
							<Alert key={alert.id}>
								<AlertTitle className="flex items-center justify-between gap-3">
									<span>{alert.title}</span>
									<Badge>{alert.severity}</Badge>
								</AlertTitle>
								<AlertDescription>
									<div className="space-y-2">
										<p className="break-words">{alert.description}</p>
										<p className="text-muted-foreground text-xs">{formatDateTime(alert.occurredAt)}</p>
										<Link className={settingsLinkClassName} href={alert.href}>
											{getSettingsLinkLabel(alert.href, t)}
										</Link>
									</div>
								</AlertDescription>
							</Alert>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function UpcomingRunsCard({
	t,
	runs,
	error,
}: {
	t: TranslateFn;
	runs: ExportOperationsUpcomingRun[];
	error: string | null;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2 className="text-base font-semibold">
						{t("settings.exportOperations.upcomingRuns.title", "Upcoming runs")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"settings.exportOperations.upcomingRuns.description",
						"The next scheduled exports queued for this organization.",
					)}
				</CardDescription>
				{error ? <p className="text-muted-foreground text-sm">{error}</p> : null}
			</CardHeader>
			<CardContent>
				{error ? null : runs.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("settings.exportOperations.upcomingRuns.empty", "No upcoming runs")}
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.exportOperations.upcomingRuns.name", "Name")}</TableHead>
								<TableHead>{t("settings.exportOperations.upcomingRuns.when", "Scheduled for")}</TableHead>
								<TableHead>{t("settings.exportOperations.upcomingRuns.link", "Settings")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{runs.map((run) => (
								<TableRow key={run.id}>
									<TableCell className="break-words">{run.name}</TableCell>
									<TableCell>{formatDateTime(run.scheduledFor)}</TableCell>
									<TableCell>
										<Link className={settingsLinkClassName} href={run.href}>
											{getSettingsLinkLabel(run.href, t)}
										</Link>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

function RecentActivityCard({
	t,
	items,
	error,
}: {
	t: TranslateFn;
	items: ExportOperationsActivityItem[];
	error: string | null;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2 className="text-base font-semibold">
						{t("settings.exportOperations.recentActivity.title", "Recent activity")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"settings.exportOperations.recentActivity.description",
						"Latest payroll, audit, and scheduled export events.",
					)}
				</CardDescription>
				{error ? <p className="text-muted-foreground text-sm">{error}</p> : null}
			</CardHeader>
			<CardContent>
				{error ? null : items.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("settings.exportOperations.recentActivity.empty", "No recent export activity")}
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.exportOperations.recentActivity.export", "Export")}</TableHead>
								<TableHead>{t("settings.exportOperations.recentActivity.status", "Status")}</TableHead>
								<TableHead>{t("settings.exportOperations.recentActivity.when", "Occurred")}</TableHead>
								<TableHead>{t("settings.exportOperations.recentActivity.link", "Settings")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map((item) => (
								<TableRow key={item.id}>
									<TableCell>
										<div className="min-w-0 space-y-1">
											<p className="font-medium">{item.title}</p>
											<p className="text-muted-foreground text-sm break-words">{item.description}</p>
										</div>
									</TableCell>
									<TableCell>
										<Badge>{item.status}</Badge>
									</TableCell>
									<TableCell>{formatDateTime(item.occurredAt)}</TableCell>
									<TableCell>
										<Link className={settingsLinkClassName} href={item.href}>
											{getSettingsLinkLabel(item.href, t)}
										</Link>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

function formatOptionalDate(value: Date | null, t: TranslateFn) {
	if (!value) {
		return t("settings.exportOperations.summary.none", "Never");
	}

	return formatDateTime(value);
}

const settingsLinkClassName =
	"rounded-sm text-sm font-medium underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function getSettingsLinkLabel(
	href: ExportOperationsAlert["href"] | ExportOperationsUpcomingRun["href"] | ExportOperationsActivityItem["href"],
	t: TranslateFn,
) {
		switch (href) {
			case "/settings/payroll-export":
				return t("settings.exportOperations.links.payroll", "Open payroll export settings");
			case "/settings/scheduled-exports":
				return t("settings.exportOperations.links.scheduled", "Open scheduled export settings");
			case "/settings/audit-export":
				return t("settings.exportOperations.links.audit", "Open audit export settings");
		}
}
