"use client";

import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import type { PlatformAnalyticsData, PlatformAnalyticsPoint } from "@/lib/platform-analytics/types";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";

const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), {
	ssr: false,
});
const Line = dynamic(() => import("recharts").then((mod) => mod.Line), { ssr: false });
const LineChart = dynamic(() => import("recharts").then((mod) => mod.LineChart), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false });

const metricConfig = {
	signups: {
		labelKey: "admin:admin.analytics.metrics.signups",
		fallback: "Signups",
		color: "hsl(var(--chart-1))",
	},
	organizations: {
		labelKey: "admin:admin.analytics.metrics.organizations",
		fallback: "Organizations",
		color: "hsl(var(--chart-2))",
	},
	activeUsers: {
		labelKey: "admin:admin.analytics.metrics.activeUsers",
		fallback: "Active users",
		color: "hsl(var(--chart-1))",
	},
	sessions: {
		labelKey: "admin:admin.analytics.metrics.sessions",
		fallback: "Sessions",
		color: "hsl(var(--chart-2))",
	},
	timeRecords: {
		labelKey: "admin:admin.analytics.metrics.timeRecords",
		fallback: "Time records",
		color: "hsl(var(--chart-1))",
	},
	seats: {
		labelKey: "admin:admin.analytics.metrics.seats",
		fallback: "Licensed seats",
		color: "hsl(var(--chart-1))",
	},
	mrr: {
		labelKey: "admin:admin.analytics.metrics.mrr",
		fallback: "Estimated MRR",
		color: "hsl(var(--chart-2))",
	},
};

type MetricKey = keyof typeof metricConfig;
type Translate = ReturnType<typeof useTranslate>["t"];

type KpiCard = {
	title: string;
	value: number | null;
	description: string;
	kind?: "currency";
};

type AnalyticsChart = {
	title: string;
	description: string;
	metrics: MetricKey[];
	summary: string;
};

export function PlatformAnalyticsCharts({ data }: { data: PlatformAnalyticsData }) {
	const { t } = useTranslate();
	const chartConfig = getChartConfig(t);
	const kpis = getKpiCards(data, t);
	const charts = getChartCards(data, t);

	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{kpis.map((kpi) => (
					<KpiCard key={kpi.title} kpi={kpi} t={t} />
				))}
			</div>

			{data.billingEnabled && data.kpis.estimatedBilling ? <EstimatedBillingNotice t={t} /> : null}

			<div className="grid gap-4 xl:grid-cols-2">
				{charts.map((chart) => (
					<AnalyticsChartCard
						key={chart.title}
						chart={chart}
						chartConfig={chartConfig}
						series={data.series}
						t={t}
					/>
				))}
			</div>
		</div>
	);
}

export function PlatformAnalyticsPreviewCharts({ data }: { data: PlatformAnalyticsData }) {
	const { t } = useTranslate();
	const chartConfig = getChartConfig(t);
	const charts = getChartCards(data, t).slice(0, 2);

	return (
		<Card>
			<CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-1.5">
					<CardTitle>
						<h2 className="text-base">
							{t("admin:admin.analytics.preview.title", "Analytics trends")}
						</h2>
					</CardTitle>
					<CardDescription>
						{t(
							"admin:admin.analytics.preview.description",
							"Platform growth and engagement across the selected range.",
						)}
					</CardDescription>
				</div>
				<Link
					href="/platform-admin/analytics"
					className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				>
					{t("admin:admin.analytics.preview.viewFull", "View full analytics")}
				</Link>
			</CardHeader>
			<CardContent className="grid gap-4 lg:grid-cols-2">
				{charts.map((chart) => (
					<AnalyticsChartCard
						key={chart.title}
						chart={chart}
						chartConfig={chartConfig}
						series={data.series}
						t={t}
						compact
					/>
				))}
			</CardContent>
		</Card>
	);
}

function KpiCard({ kpi, t }: { kpi: KpiCard; t: Translate }) {
	return (
		<Card className="gap-3">
			<CardHeader className="pb-0">
				<CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-1">
				<div className="text-2xl font-semibold tabular-nums tracking-tight">
					{formatValue(kpi.value, kpi.kind, t)}
				</div>
				<p className="text-xs text-muted-foreground">{kpi.description}</p>
			</CardContent>
		</Card>
	);
}

function AnalyticsChartCard({
	chart,
	chartConfig,
	series,
	t,
	compact = false,
}: {
	chart: AnalyticsChart;
	chartConfig: ChartConfig;
	series: PlatformAnalyticsPoint[];
	t: Translate;
	compact?: boolean;
}) {
	return (
		<Card className={cn("overflow-hidden", compact && "gap-4 border-muted/80 shadow-none")}>
			<CardHeader>
				<CardTitle>
					<h3 className={cn("text-base", compact && "text-sm")}>{chart.title}</h3>
				</CardTitle>
				<CardDescription>{chart.description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-sm text-muted-foreground">{chart.summary}</p>
				<ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					{chart.metrics.map((metric) => (
						<li key={metric} className="flex items-center gap-1.5">
							<span
								className="size-2 rounded-full"
								style={{ backgroundColor: `var(--color-${metric})` }}
								aria-hidden="true"
							/>
							{chartConfig[metric].label}
						</li>
					))}
				</ul>
				{series.length === 0 ? (
					<div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground">
						{t("admin:admin.analytics.emptyState.noData", "No data for this range")}
					</div>
				) : (
					<ChartContainer
						config={chartConfig}
						className={cn("h-[260px] w-full", compact && "h-[180px]")}
					>
						<LineChart accessibilityLayer data={series} margin={{ left: 12, right: 12, top: 8 }}>
							<CartesianGrid vertical={false} />
							<XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
							<YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} />
							<ChartTooltip content={<ChartTooltipContent indicator="line" />} />
							{chart.metrics.map((metric) => (
								<Line
									key={metric}
									dataKey={metric}
									type="monotone"
									stroke={`var(--color-${metric})`}
									strokeWidth={2}
									dot={false}
								/>
							))}
						</LineChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}

function EstimatedBillingNotice({ t }: { t: Translate }) {
	return (
		<Card className="border-amber-500/30 bg-amber-500/5 py-4">
			<CardContent>
				<p className="text-sm text-muted-foreground">
					{t(
						"admin:admin.analytics.billing.estimatedNotice",
						"Historical seats and MRR are estimated. Exact reconstruction requires future snapshots or a billing ledger.",
					)}
				</p>
			</CardContent>
		</Card>
	);
}

function getKpiCards(data: PlatformAnalyticsData, t: Translate): KpiCard[] {
	const kpis: KpiCard[] = [
		{
			title: t("admin:admin.analytics.kpis.activeUsers.title", "Active users"),
			value: data.kpis.activeUsers,
			description: t(
				"admin:admin.analytics.kpis.activeUsers.description",
				"Users active in the selected range",
			),
		},
		{
			title: t("admin:admin.analytics.kpis.signups.title", "Signups"),
			value: data.kpis.signups,
			description: t("admin:admin.analytics.kpis.signups.description", "New platform accounts"),
		},
		{
			title: t("admin:admin.analytics.kpis.organizations.title", "Organizations"),
			value: data.kpis.organizations,
			description: t(
				"admin:admin.analytics.kpis.organizations.description",
				"Active workspaces on the platform",
			),
		},
		{
			title: t("admin:admin.analytics.kpis.sessions.title", "Sessions"),
			value: data.kpis.sessions,
			description: t("admin:admin.analytics.kpis.sessions.description", "Authenticated sessions"),
		},
		{
			title: t("admin:admin.analytics.kpis.timeRecords.title", "Time records"),
			value: data.kpis.timeRecords,
			description: t(
				"admin:admin.analytics.kpis.timeRecords.description",
				"Submitted operational records",
			),
		},
	];

	if (data.billingEnabled) {
		kpis.push(
			{
				title: t("admin:admin.analytics.kpis.seats.title", "Licensed seats"),
				value: data.kpis.seats,
				description: t(
					"admin:admin.analytics.kpis.seats.description",
					"Current paid or trial seats",
				),
			},
			{
				title: t("admin:admin.analytics.kpis.mrr.title", "Estimated MRR"),
				value: data.kpis.mrr,
				description: t(
					"admin:admin.analytics.kpis.mrr.description",
					"Monthly recurring revenue estimate",
				),
				kind: "currency",
			},
		);
	}

	return kpis;
}

function getChartCards(data: PlatformAnalyticsData, t: Translate): AnalyticsChart[] {
	const charts: AnalyticsChart[] = [
		{
			title: t("admin:admin.analytics.charts.growth.title", "Growth"),
			description: t(
				"admin:admin.analytics.charts.growth.description",
				"New users and organizations entering the platform.",
			),
			metrics: ["signups", "organizations"],
			summary: t(
				"admin:admin.analytics.charts.growth.summary",
				"Growth summary: {signups} signups and {organizations} organizations.",
				{
					signups: formatValue(data.kpis.signups, undefined, t),
					organizations: formatValue(data.kpis.organizations, undefined, t),
				},
			),
		},
		{
			title: t("admin:admin.analytics.charts.engagement.title", "Engagement"),
			description: t(
				"admin:admin.analytics.charts.engagement.description",
				"Platform usage through active users and sessions.",
			),
			metrics: ["activeUsers", "sessions"],
			summary: t(
				"admin:admin.analytics.charts.engagement.summary",
				"Engagement summary: {activeUsers} active users and {sessions} sessions.",
				{
					activeUsers: formatValue(data.kpis.activeUsers, undefined, t),
					sessions: formatValue(data.kpis.sessions, undefined, t),
				},
			),
		},
		{
			title: t("admin:admin.analytics.charts.operations.title", "Operations"),
			description: t(
				"admin:admin.analytics.charts.operations.description",
				"Time tracking volume generated by tenant activity.",
			),
			metrics: ["timeRecords"],
			summary: t(
				"admin:admin.analytics.charts.operations.summary",
				"Operations summary: {timeRecords} time records.",
				{
					timeRecords: formatValue(data.kpis.timeRecords, undefined, t),
				},
			),
		},
	];

	if (data.billingEnabled) {
		charts.push({
			title: t("admin:admin.analytics.charts.commercial.title", "Commercial"),
			description: t(
				"admin:admin.analytics.charts.commercial.description",
				"Seat and recurring revenue signals for billing health.",
			),
			metrics: ["seats", "mrr"],
			summary: t(
				"admin:admin.analytics.charts.commercial.summary",
				"Commercial summary: {seats} seats and {mrr} estimated MRR.",
				{
					seats: formatValue(data.kpis.seats, undefined, t),
					mrr: formatValue(data.kpis.mrr, "currency", t),
				},
			),
		});
	}

	return charts;
}

function getChartConfig(t: Translate): ChartConfig {
	return Object.fromEntries(
		Object.entries(metricConfig).map(([key, config]) => [
			key,
			{ label: t(config.labelKey, config.fallback), color: config.color },
		]),
	) as ChartConfig;
}

function formatValue(value: number | null, kind: "currency" | undefined, t: Translate) {
	if (value === null) {
		return t("admin:admin.analytics.values.notAvailable", "Not available");
	}

	if (kind === "currency") {
		return new Intl.NumberFormat("en", {
			style: "currency",
			currency: "EUR",
			maximumFractionDigits: 0,
		}).format(value);
	}

	return new Intl.NumberFormat("en").format(value);
}
