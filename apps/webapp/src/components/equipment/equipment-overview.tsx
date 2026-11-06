"use client";
import {
	IconAlertTriangle,
	IconBarcode,
	IconCalendarDue,
	IconCircleCheck,
	IconListDetails,
	IconPackage,
	IconPackageExport,
	IconSettings,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { KpiCard, type KpiTone } from "@/components/ui/kpi-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { EquipmentView } from "@/lib/organization/equipment/contracts";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/navigation";
import { EquipmentAssignmentsCard } from "./equipment-assignments-card";
import {
	EquipmentIssueActions,
	EquipmentRefreshButton,
	EquipmentSettingsLink,
} from "./equipment-header-actions";
import {
	type AssignmentFilters,
	type AssignmentStatusView,
	defaultItemView,
	type EquipmentKpis,
	equipmentKpis,
	type ItemView,
} from "./equipment-list";
import {
	type EquipmentListQuery,
	equipmentListHref,
} from "./equipment-list-state";
import { issuanceAvailability, useEquipmentPanels } from "./equipment-panels";
import { EquipmentReadiness } from "./equipment-readiness";

type Tab = "assignments" | "items";

/** The page heading and its actions, shared by the overview's states. */
function OverviewHeader({ actions }: { actions: ReactNode }) {
	const { t } = useTranslate();
	return (
		<div className="flex flex-col gap-3 px-4 sm:flex-row sm:items-start sm:justify-between lg:px-6">
			<div className="min-w-0 space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.equipment.title", "Equipment")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.equipment.overview.description",
						"Who holds each item, what must come back, and every recorded handover.",
					)}
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">{actions}</div>
		</div>
	);
}

/** Not set up yet: owners and admins can do it, officers are told who can. */
function SetupEmpty({ canAdminister }: { canAdminister: boolean }) {
	const { t } = useTranslate();
	return (
		<div className="px-4 lg:px-6">
			<Empty className="border bg-card md:p-16">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<IconPackage aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>
						{t("settings.equipment.setupEmpty.title", "Set up equipment first")}
					</EmptyTitle>
					<EmptyDescription>
						{canAdminister
							? t(
									"settings.equipment.setupEmpty.admin",
									"Add the equipment types you issue and choose how long closed records are kept. Then you can issue equipment to employees.",
								)
							: t(
									"settings.equipment.setupEmpty.officer",
									"Ask an administrator to set up equipment types and record retention. Then you can issue equipment to employees.",
								)}
					</EmptyDescription>
				</EmptyHeader>
				{canAdminister ? (
					<EmptyContent>
						<Button asChild>
							<Link href="/settings/equipment">
								<IconSettings className="size-4" aria-hidden="true" />
								{t("settings.equipment.setupEmpty.action", "Set up equipment")}
							</Link>
						</Button>
					</EmptyContent>
				) : null}
			</Empty>
		</div>
	);
}

/** A figure that also filters the list; the whole card is its button. */
function FilterKpi({
	active,
	label,
	actionLabel,
	icon,
	value,
	tone,
	caption,
	onSelect,
}: {
	active: boolean;
	label: string;
	actionLabel: string;
	icon: ReactNode;
	value: number;
	tone: KpiTone;
	caption: string;
	onSelect: () => void;
}) {
	return (
		<div
			className={cn(
				"group relative rounded-xl",
				active && "ring-2 ring-primary ring-offset-2 ring-offset-background",
			)}
		>
			<KpiCard
				label={label}
				icon={icon}
				value={value}
				tone={tone}
				caption={caption}
				className="h-full transition-colors group-hover:border-primary/40"
			/>
			<button
				type="button"
				aria-pressed={active}
				aria-label={actionLabel}
				className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
				onClick={onSelect}
			/>
		</div>
	);
}

/**
 * The key figures. Each one shows what it counts and is active while the page
 * shows it; "Items ready to issue" only appears to managers with identified items.
 */
function OverviewKpis({
	kpis,
	canManage,
	activeStatus,
	readyActive,
	onShowStatus,
	onShowReady,
}: {
	kpis: EquipmentKpis;
	canManage: boolean;
	/** The assignments view on screen, or null while the items tab is. */
	activeStatus: AssignmentStatusView | null;
	readyActive: boolean;
	onShowStatus: (status: AssignmentStatusView) => void;
	onShowReady: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const showReady = canManage && kpis.identifiedItems > 0;
	const date = (value: string) =>
		parsePlainDate(value).toLocaleString(locale, { dateStyle: "medium" });
	return (
		<div
			className={cn(
				"grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2",
				showReady ? "@5xl/main:grid-cols-4" : "@5xl/main:grid-cols-3",
			)}
		>
			<FilterKpi
				active={activeStatus === "outstanding"}
				label={t(
					"settings.equipment.filters.outstanding",
					"Outstanding returns",
				)}
				actionLabel={t(
					"settings.equipment.kpi.showOutstanding",
					"Show outstanding returns",
				)}
				icon={<IconPackageExport />}
				value={kpis.outstanding}
				tone="neutral"
				caption={t(
					"settings.equipment.kpi.outstandingCaption",
					"{count, plural, =0 {No employee holds an outstanding return} one {Across # employee} other {Across # employees}}",
					{ count: kpis.outstandingHolders },
				)}
				onSelect={() => onShowStatus("outstanding")}
			/>
			<FilterKpi
				active={activeStatus === "overdue"}
				label={t("settings.equipment.custody.overdue", "Overdue")}
				actionLabel={t(
					"settings.equipment.kpi.showOverdue",
					"Show overdue returns",
				)}
				icon={<IconAlertTriangle />}
				value={kpis.overdue}
				tone={kpis.overdue > 0 ? "critical" : "neutral"}
				caption={
					kpis.oldestOverdueDays === null
						? t("settings.equipment.kpi.noneOverdue", "Nothing overdue")
						: t(
								"settings.equipment.kpi.oldestOverdue",
								"{count, plural, one {Oldest: # day overdue} other {Oldest: # days overdue}}",
								{ count: kpis.oldestOverdueDays },
							)
				}
				onSelect={() => onShowStatus("overdue")}
			/>
			<FilterKpi
				active={activeStatus === "soon"}
				label={t("settings.equipment.kpi.dueSoon", "Due within 14 days")}
				actionLabel={t(
					"settings.equipment.kpi.showDueSoon",
					"Show returns due within 14 days",
				)}
				icon={<IconCalendarDue />}
				value={kpis.dueSoon}
				tone={kpis.dueSoon > 0 ? "warning" : "neutral"}
				caption={
					kpis.nextDueDate
						? t("settings.equipment.kpi.nextDue", "Next: {date}", {
								date: date(kpis.nextDueDate),
							})
						: t("settings.equipment.kpi.nothingDue", "Nothing due soon")
				}
				onSelect={() => onShowStatus("soon")}
			/>
			{showReady ? (
				<FilterKpi
					active={readyActive}
					label={t("settings.equipment.kpi.ready", "Items ready to issue")}
					actionLabel={t(
						"settings.equipment.kpi.showReady",
						"Show items ready to issue",
					)}
					icon={<IconCircleCheck />}
					value={kpis.readyToIssue}
					tone="info"
					caption={t(
						"settings.equipment.kpi.readyCaption",
						"{count, plural, one {Of # identified item} other {Of # identified items}}",
						{ count: kpis.identifiedItems },
					)}
					onSelect={onShowReady}
				/>
			) : null}
		</div>
	);
}

/**
 * The staff Equipment overview (#1572): key figures, assignments with URL filters
 * and row commands, and the item availability tab.
 */
export function EquipmentOverview({
	data,
	query,
}: {
	data: EquipmentView;
	query: EquipmentListQuery;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const { open, panel, pending } = useEquipmentPanels(data);
	const [tab, setTab] = useState<Tab>("assignments");
	const [itemView, setItemView] = useState<ItemView>(() =>
		defaultItemView(data.readinessItems),
	);
	const [listQuery, setListQuery] = useState(query);
	const [search, setSearch] = useState("");
	// A navigation to other filters (a reminder link) replaces the local state.
	const queryKey = JSON.stringify(query);
	const [seenQuery, setSeenQuery] = useState(queryKey);
	if (queryKey !== seenQuery) {
		setSeenQuery(queryKey);
		setListQuery(query);
	}
	const filters: AssignmentFilters = { ...listQuery, search };
	const listHref = equipmentListHref(listQuery);
	function changeFilters(next: AssignmentFilters) {
		const { search: nextSearch, ...nextQuery } = next;
		setSearch(nextSearch);
		if (JSON.stringify(nextQuery) === JSON.stringify(listQuery)) return;
		setListQuery(nextQuery);
		router.replace(equipmentListHref(nextQuery), { scroll: false });
	}
	function showStatus(status: AssignmentStatusView) {
		setTab("assignments");
		changeFilters({ ...filters, status });
	}
	const { canIssue, canRecordHistorical } = issuanceAvailability(data);
	const actions = (
		<>
			<EquipmentRefreshButton />
			{data.canAdminister ? <EquipmentSettingsLink /> : null}
			<EquipmentIssueActions
				canIssue={canIssue}
				canRecordHistorical={canRecordHistorical}
				disabled={pending}
				onIssue={() => open({ kind: "issue" })}
				onRecordHistorical={() => open({ kind: "historical" })}
			/>
		</>
	);
	const notSetUp = !data.policyConfigured || data.types.length === 0;
	if (notSetUp && !data.assignments.length)
		return (
			<>
				<OverviewHeader actions={<EquipmentRefreshButton />} />
				<SetupEmpty canAdminister={data.canAdminister} />
			</>
		);
	const kpis = equipmentKpis(data.assignments, data.readinessItems, data.today);
	const showItems = data.canManage && data.readinessItems.length > 0;
	const assignments = (
		<EquipmentAssignmentsCard
			data={data}
			filters={filters}
			onFiltersChange={changeFilters}
			showHolder
			back={listHref}
			onAction={(action, assignmentId) => open({ kind: action, assignmentId })}
			emptyAction={
				canIssue ? (
					<Button onClick={() => open({ kind: "issue" })}>
						{t("settings.equipment.custody.issue", "Issue equipment")}
					</Button>
				) : null
			}
		/>
	);
	return (
		<>
			<OverviewHeader actions={actions} />
			{data.canManage && !canIssue ? (
				<p className="px-4 text-sm text-muted-foreground lg:px-6">
					{t(
						"settings.equipment.custody.noItems",
						"To issue equipment, configure retention and add a quantity type or available individual item in Equipment settings.",
					)}
				</p>
			) : null}
			<OverviewKpis
				kpis={kpis}
				canManage={data.canManage}
				activeStatus={tab === "assignments" ? listQuery.status : null}
				readyActive={tab === "items" && itemView === "available"}
				onShowStatus={showStatus}
				onShowReady={() => {
					setItemView("available");
					setTab("items");
				}}
			/>
			<div className="px-4 lg:px-6">
				{showItems ? (
					<Tabs
						value={tab}
						onValueChange={(value) =>
							setTab(value === "items" ? "items" : "assignments")
						}
						className="gap-4"
					>
						<TabsList>
							<TabsTrigger value="assignments">
								<IconListDetails aria-hidden="true" />
								{t("settings.equipment.list.title", "Assignments")}
							</TabsTrigger>
							<TabsTrigger value="items">
								<IconBarcode aria-hidden="true" />
								{t("settings.equipment.items.tab", "Items")}
							</TabsTrigger>
						</TabsList>
						<TabsContent value="assignments">{assignments}</TabsContent>
						<TabsContent value="items">
							<EquipmentReadiness
								items={data.readinessItems}
								today={data.today}
								timezone={data.timezone}
								view={itemView}
								onViewChange={setItemView}
							/>
						</TabsContent>
					</Tabs>
				) : (
					assignments
				)}
			</div>
			{panel}
		</>
	);
}
