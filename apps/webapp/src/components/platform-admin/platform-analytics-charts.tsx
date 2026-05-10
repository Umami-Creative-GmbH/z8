"use client";

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

const chartConfig = {
	signups: { label: "Signups", color: "hsl(var(--chart-1))" },
	organizations: { label: "Organizations", color: "hsl(var(--chart-2))" },
	activeUsers: { label: "Active users", color: "hsl(var(--chart-1))" },
	sessions: { label: "Sessions", color: "hsl(var(--chart-2))" },
	timeRecords: { label: "Time records", color: "hsl(var(--chart-1))" },
	seats: { label: "Licensed seats", color: "hsl(var(--chart-1))" },
	mrr: { label: "Estimated MRR", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

type MetricKey = keyof typeof chartConfig;

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
	const kpis = getKpiCards(data);
	const charts = getChartCards(data);

	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{kpis.map((kpi) => (
					<KpiCard key={kpi.title} kpi={kpi} />
				))}
			</div>

			{data.billingEnabled && data.kpis.estimatedBilling ? <EstimatedBillingNotice /> : null}

			<div className="grid gap-4 xl:grid-cols-2">
				{charts.map((chart) => (
					<AnalyticsChartCard key={chart.title} chart={chart} series={data.series} />
				))}
			</div>
		</div>
	);
}

export function PlatformAnalyticsPreviewCharts({ data }: { data: PlatformAnalyticsData }) {
	const charts = getChartCards(data).slice(0, 2);

	return (
		<Card>
			<CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-1.5">
					<CardTitle>
						<h2 className="text-base">Analytics trends</h2>
					</CardTitle>
					<CardDescription>Platform growth and engagement across the selected range.</CardDescription>
				</div>
				<Link
					href="/platform-admin/analytics"
					className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				>
					View full analytics
				</Link>
			</CardHeader>
			<CardContent className="grid gap-4 lg:grid-cols-2">
				{charts.map((chart) => (
					<AnalyticsChartCard key={chart.title} chart={chart} series={data.series} compact />
				))}
			</CardContent>
		</Card>
	);
}

function KpiCard({ kpi }: { kpi: KpiCard }) {
	return (
		<Card className="gap-3">
			<CardHeader className="pb-0">
				<CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-1">
				<div className="text-2xl font-semibold tabular-nums tracking-tight">
					{formatValue(kpi.value, kpi.kind)}
				</div>
				<p className="text-xs text-muted-foreground">{kpi.description}</p>
			</CardContent>
		</Card>
	);
}

function AnalyticsChartCard({
	chart,
	series,
	compact = false,
}: {
	chart: AnalyticsChart;
	series: PlatformAnalyticsPoint[];
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
						No data for this range
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

function EstimatedBillingNotice() {
	return (
		<Card className="border-amber-500/30 bg-amber-500/5 py-4">
			<CardContent>
				<p className="text-sm text-muted-foreground">
					Historical seats and MRR are estimated. Exact reconstruction requires future snapshots or
					a billing ledger.
				</p>
			</CardContent>
		</Card>
	);
}

function getKpiCards(data: PlatformAnalyticsData): KpiCard[] {
	const kpis: KpiCard[] = [
		{
			title: "Active users",
			value: data.kpis.activeUsers,
			description: "Users active in the selected range",
		},
		{ title: "Signups", value: data.kpis.signups, description: "New platform accounts" },
		{
			title: "Organizations",
			value: data.kpis.organizations,
			description: "Active workspaces on the platform",
		},
		{ title: "Sessions", value: data.kpis.sessions, description: "Authenticated sessions" },
		{
			title: "Time records",
			value: data.kpis.timeRecords,
			description: "Submitted operational records",
		},
	];

	if (data.billingEnabled) {
		kpis.push(
			{
				title: "Licensed seats",
				value: data.kpis.seats,
				description: "Current paid or trial seats",
			},
			{
				title: "Estimated MRR",
				value: data.kpis.mrr,
				description: "Monthly recurring revenue estimate",
				kind: "currency",
			},
		);
	}

	return kpis;
}

function getChartCards(data: PlatformAnalyticsData): AnalyticsChart[] {
	const charts: AnalyticsChart[] = [
		{
			title: "Growth",
			description: "New users and organizations entering the platform.",
			metrics: ["signups", "organizations"],
			summary: `Growth summary: ${formatValue(data.kpis.signups)} signups and ${formatValue(
				data.kpis.organizations,
			)} organizations.`,
		},
		{
			title: "Engagement",
			description: "Platform usage through active users and sessions.",
			metrics: ["activeUsers", "sessions"],
			summary: `Engagement summary: ${formatValue(
				data.kpis.activeUsers,
			)} active users and ${formatValue(data.kpis.sessions)} sessions.`,
		},
		{
			title: "Operations",
			description: "Time tracking volume generated by tenant activity.",
			metrics: ["timeRecords"],
			summary: `Operations summary: ${formatValue(data.kpis.timeRecords)} time records.`,
		},
	];

	if (data.billingEnabled) {
		charts.push({
			title: "Commercial",
			description: "Seat and recurring revenue signals for billing health.",
			metrics: ["seats", "mrr"],
			summary: `Commercial summary: ${formatValue(data.kpis.seats)} seats and ${formatValue(
				data.kpis.mrr,
				"currency",
			)} estimated MRR.`,
		});
	}

	return charts;
}

function formatValue(value: number | null, kind?: "currency") {
	if (value === null) {
		return "Not available";
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
