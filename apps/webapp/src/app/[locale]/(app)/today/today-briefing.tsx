"use client";

import {
	IconAlertTriangle,
	IconArrowRight,
	IconCalendarCheck,
	IconClipboardCheck,
	IconClockExclamation,
	IconCurrencyEuro,
	IconShieldCheck,
	IconUsersGroup,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import type { ComponentType, SVGProps } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type {
	BriefingActionItem,
	BriefingActionSeverity,
	BriefingSection,
	ManagerDailyBriefing,
} from "@/lib/manager-daily-briefing/types";
import { Link } from "@/navigation";
import { TodayApprovalsPanel } from "./today-approvals-panel";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

type TodayBriefingProps = {
	briefing: ManagerDailyBriefing;
};

type SummaryCardProps = {
	title: string;
	value: number;
	description: string;
	icon: IconComponent;
	tone?: "default" | "critical" | "warning";
};

type TFunction = ReturnType<typeof useTranslate>["t"];

type SectionCardProps = {
	section: BriefingSection;
	icon: IconComponent;
};

type EmptyStateProps = {
	message: string;
};

const summaryCards: Array<{
	key: keyof ManagerDailyBriefing["summary"];
	titleKey: string;
	fallbackTitle: string;
	descriptionKey: string;
	fallbackDescription: string;
	icon: IconComponent;
	tone?: SummaryCardProps["tone"];
}> = [
	{
		key: "criticalIssues",
		titleKey: "today.briefing.summary.criticalIssues.title",
		fallbackTitle: "Critical issues",
		descriptionKey: "today.briefing.summary.criticalIssues.description",
		fallbackDescription: "Highest-priority items across today.",
		icon: IconAlertTriangle,
		tone: "critical",
	},
	{
		key: "openApprovals",
		titleKey: "today.briefing.summary.openApprovals.title",
		fallbackTitle: "Open approvals",
		descriptionKey: "today.briefing.summary.openApprovals.description",
		fallbackDescription: "Requests waiting for a decision.",
		icon: IconClipboardCheck,
	},
	{
		key: "attendanceExceptions",
		titleKey: "today.briefing.summary.attendanceExceptions.title",
		fallbackTitle: "Clock-in exceptions",
		descriptionKey: "today.briefing.summary.attendanceExceptions.description",
		fallbackDescription: "Published shifts needing attention.",
		icon: IconClockExclamation,
		tone: "warning",
	},
	{
		key: "payrollIssues",
		titleKey: "today.briefing.summary.payrollIssues.title",
		fallbackTitle: "Payroll issues",
		descriptionKey: "today.briefing.summary.payrollIssues.description",
		fallbackDescription: "Setup gaps before export readiness.",
		icon: IconCurrencyEuro,
		tone: "warning",
	},
	{
		key: "coverageRisks",
		titleKey: "today.briefing.summary.coverageRisks.title",
		fallbackTitle: "Coverage risks",
		descriptionKey: "today.briefing.summary.coverageRisks.description",
		fallbackDescription: "Minimum staffing risks for today.",
		icon: IconShieldCheck,
		tone: "warning",
	},
	{
		key: "overtimeWarnings",
		titleKey: "today.briefing.summary.overtimeWarnings.title",
		fallbackTitle: "Overtime warnings",
		descriptionKey: "today.briefing.summary.overtimeWarnings.description",
		fallbackDescription: "Employees nearing overtime thresholds.",
		icon: IconUsersGroup,
	},
];

const supportingSections: Array<{
	key: Exclude<keyof ManagerDailyBriefing["sections"], "approvals">;
	icon: IconComponent;
}> = [
	{ key: "attendance", icon: IconClockExclamation },
	{ key: "absences", icon: IconCalendarCheck },
	{ key: "coverage", icon: IconShieldCheck },
	{ key: "overtime", icon: IconUsersGroup },
	{ key: "payroll", icon: IconCurrencyEuro },
];

export function TodayBriefing({ briefing }: TodayBriefingProps) {
	const { t } = useTranslate();
	const briefingDate = DateTime.fromISO(briefing.date).toLocaleString(
		DateTime.DATE_MED_WITH_WEEKDAY,
	);
	const generatedAt = DateTime.fromISO(briefing.generatedAt).toLocaleString(DateTime.TIME_SIMPLE);

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
			<header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
				<div className="space-y-2">
					<Badge variant="secondary" className="w-fit">
						{t("today.briefing.badge", "Today")}
					</Badge>
					<div className="space-y-1">
						<h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
							{t("today.briefing.title", "Manager Daily Briefing")}
						</h1>
						<p className="max-w-2xl text-muted-foreground text-sm">
							{t(
								"today.briefing.description",
								"Review the items that need action today, then move directly into the right workflow.",
							)}
						</p>
					</div>
				</div>
				<p className="text-muted-foreground text-xs md:text-right">
					{t("today.briefing.updatedAt", "{date} - Updated {time}", {
						date: briefingDate,
						time: generatedAt,
					})}
				</p>
			</header>

			<section
				className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"
				aria-label={t("today.briefing.summaryAriaLabel", "Today summary")}
			>
				{summaryCards.map(
					({ key, titleKey, fallbackTitle, descriptionKey, fallbackDescription, ...card }) => (
						<SummaryCard
							key={key}
							{...card}
							title={t(titleKey, fallbackTitle)}
							description={t(descriptionKey, fallbackDescription)}
							value={briefing.summary[key]}
						/>
					),
				)}
			</section>

			<section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
				<NeedsActionCard items={briefing.needsAction} t={t} />
				<TodayApprovalsPanel
					items={briefing.sections.approvals.items}
					error={briefing.sections.approvals.error}
				/>
			</section>

			<section
				className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
				aria-label={t("today.briefing.supportingSectionsAriaLabel", "Supporting sections")}
			>
				{supportingSections.map(({ key, icon }) => (
					<SectionCard key={key} section={briefing.sections[key]} icon={icon} />
				))}
			</section>
		</div>
	);
}

function SummaryCard({
	title,
	value,
	description,
	icon: Icon,
	tone = "default",
}: SummaryCardProps) {
	const toneClass =
		tone === "critical"
			? "border-destructive/30 bg-destructive/5"
			: tone === "warning"
				? "border-amber-500/30 bg-amber-500/5"
				: "";

	return (
		<Card className={`gap-3 py-4 ${toneClass}`}>
			<CardContent className="space-y-3 px-4">
				<div className="flex items-center justify-between gap-3">
					<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
					<span className="font-semibold text-2xl tabular-nums">{value}</span>
				</div>
				<div className="space-y-1">
					<h2 className="font-medium text-sm">{title}</h2>
					<p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
				</div>
			</CardContent>
		</Card>
	);
}

function NeedsActionCard({ items, t }: { items: BriefingActionItem[]; t: TFunction }) {
	return (
		<Card className="gap-4">
			<CardHeader className="gap-2">
				<div className="flex items-start justify-between gap-3">
					<div className="space-y-1">
						<h2 className="font-semibold text-base leading-none">
							{t("today.briefing.needsAction.title", "Needs Action")}
						</h2>
						<CardDescription>
							{t(
								"today.briefing.needsAction.description",
								"Start here for the most urgent operational follow-up.",
							)}
						</CardDescription>
					</div>
					<Badge variant={items.length > 0 ? "default" : "secondary"}>{items.length}</Badge>
				</div>
			</CardHeader>
			<CardContent>
				{items.length > 0 ? (
					<div className="divide-y rounded-lg border">
						{items.map((item) => (
							<ActionRow key={item.id} item={item} />
						))}
					</div>
				) : (
					<EmptyState
						message={t(
							"today.briefing.needsAction.empty",
							"All clear. No manager action is needed right now.",
						)}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function SectionCard({ section, icon: Icon }: SectionCardProps) {
	const { t } = useTranslate();

	return (
		<Card className="gap-4">
			<CardHeader className="gap-2">
				<div className="flex items-start justify-between gap-3">
					<div className="space-y-1">
						<h3 className="flex items-center gap-2 font-semibold text-base leading-none">
							<Icon className="size-4 text-primary" aria-hidden="true" />
							{section.titleKey ? t(section.titleKey, section.title) : section.title}
						</h3>
						<CardDescription>
							{section.descriptionKey
								? t(section.descriptionKey, section.description)
								: section.description}
						</CardDescription>
					</div>
					<Badge variant={section.items.length > 0 ? "outline" : "secondary"}>
						{section.items.length}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{section.error ? <SectionError message={section.error} /> : null}
				{section.items.length > 0 ? (
					<div className="divide-y rounded-lg border">
						{section.items.map((item) => (
							<ActionRow key={item.id} item={item} compact />
						))}
					</div>
				) : (
					<EmptyState
						message={
							section.emptyStateKey
								? t(section.emptyStateKey, section.emptyState ?? "No issues detected.")
								: (section.emptyState ?? t("today.briefing.sections.empty", "No issues detected."))
						}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function ActionRow({ item, compact = false }: { item: BriefingActionItem; compact?: boolean }) {
	const { t } = useTranslate();
	const title = item.titleKey ? t(item.titleKey, item.title) : item.title;
	const description = item.descriptionKey ? t(item.descriptionKey, item.description) : item.description;

	return (
		<Link
			href={item.href}
			className="group flex items-start justify-between gap-3 px-3 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="min-w-0 space-y-1 break-words">
				<div className="flex flex-wrap items-center gap-2">
					<SeverityBadge severity={item.severity} />
					<span className="min-w-0 break-words font-medium text-sm leading-snug">{title}</span>
				</div>
				<p
					className={`break-words text-muted-foreground text-sm leading-relaxed ${compact ? "line-clamp-2" : ""}`}
				>
					{description}
				</p>
			</div>
			<IconArrowRight
				className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
				aria-hidden="true"
			/>
		</Link>
	);
}

function SeverityBadge({ severity }: { severity: BriefingActionSeverity }) {
	const { t } = useTranslate();
	const label = {
		critical: t("today.briefing.severity.critical", "Critical"),
		high: t("today.briefing.severity.high", "High"),
		warning: t("today.briefing.severity.warning", "Warning"),
		info: t("today.briefing.severity.info", "Info"),
	}[severity];
	const variant =
		severity === "critical" ? "destructive" : severity === "info" ? "secondary" : "outline";

	return <Badge variant={variant}>{label}</Badge>;
}

function EmptyState({ message }: EmptyStateProps) {
	return (
		<div className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
			{message}
		</div>
	);
}

function SectionError({ message }: { message: string }) {
	return (
		<div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
			{message}
		</div>
	);
}
