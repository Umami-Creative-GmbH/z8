"use client";
import {
	IconArrowDown,
	IconArrowsSort,
	IconArrowUp,
	IconUserSearch,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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
import { useSession } from "@/lib/auth-client";
import { getDrivingLicenceCheckWorklistAction } from "@/lib/organization/driving-licence/check-actions";
import type { AuthorizationStatus } from "@/lib/organization/driving-licence/check-types";
import type { DrivingLicenceWorklistRow } from "@/lib/organization/driving-licence/checks";
import {
	DRIVING_LICENCE_INTENDED_DRIVERS_SETTINGS_PATH,
	drivingLicenceCheckPath,
} from "@/lib/organization/driving-licence/paths";
import {
	DRIVING_LICENCE_WORKLIST_STATUSES,
	type DrivingLicenceWorklistDirection,
	type DrivingLicenceWorklistSort,
	type DrivingLicenceWorklistStatus,
} from "@/lib/organization/driving-licence/worklist-query";
import { queryKeys } from "@/lib/query";
import { Link } from "@/navigation";
import { useDrivingStatusLabels } from "./check-evidence";
import { DrivingDeadlineDate } from "./deadline-date";
import { LicenceClassIcon } from "./licence-class-visuals";

const SEARCH_DELAY_MS = 300;
type StatusFilter = DrivingLicenceWorklistStatus | "all";

type Order = {
	sort: DrivingLicenceWorklistSort;
	direction: DrivingLicenceWorklistDirection;
};
const DEFAULT_ORDER: Order = { sort: "deadline", direction: "asc" };

function WorklistOrderLabel({
	fetching,
	defaultOrder,
}: {
	fetching: boolean;
	defaultOrder: boolean;
}) {
	const { t } = useTranslate();
	if (fetching)
		return t("drivingLicence.checks.refreshing", "Updating check worklist…");
	if (defaultOrder)
		return t(
			"drivingLicence.checks.dueOrder",
			"Checks due now first, then the next deadline.",
		);
	return t(
		"drivingLicence.checks.customOrder",
		"Sorted by the selected column and direction.",
	);
}

/** A column header that sorts the table on the server; the same column again flips it. */
function SortableHead({
	column,
	order,
	onSort,
	children,
}: {
	column: DrivingLicenceWorklistSort;
	order: Order;
	onSort: (order: Order) => void;
	children: string;
}) {
	const active = order.sort === column;
	const Icon = !active
		? IconArrowsSort
		: order.direction === "asc"
			? IconArrowUp
			: IconArrowDown;
	return (
		<TableHead
			aria-sort={
				active
					? order.direction === "asc"
						? "ascending"
						: "descending"
					: "none"
			}
		>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="-ml-2 h-8 px-2"
				onClick={() =>
					onSort({
						sort: column,
						direction: active && order.direction === "asc" ? "desc" : "asc",
					})
				}
			>
				{children}
				<Icon aria-hidden="true" className="size-3.5" />
			</Button>
		</TableHead>
	);
}
const STATUS_BADGE: Record<
	AuthorizationStatus,
	"default" | "secondary" | "destructive" | "outline"
> = {
	not_yet_checked: "outline",
	active: "secondary",
	partially_active: "outline",
	suspended: "destructive",
	ended: "outline",
	not_enrolled: "outline",
};

/** What the empty Checks table explains (#1937). */
export interface DrivingLicenceWorklistEmptyGuidance {
	/** The viewer administers driving licence control, so the empty state links to Intended drivers. */
	canAssignIntendedDrivers: boolean;
	/** The viewer is an intended driver: their own check needs another verifier. */
	selfIsIntendedDriver: boolean;
}

/**
 * The verifier's Checks table (#1428): intended drivers in scope, searched, filtered and sorted
 * on the server; by default checks due now first, then the soonest deadline. A row's action opens that
 * employee's check page (#1429).
 */
export function DrivingLicenceVerifierWorklist({
	emptyGuidance,
}: {
	emptyGuidance: DrivingLicenceWorklistEmptyGuidance;
}) {
	const { t } = useTranslate();
	const { data: session } = useSession();
	const organizationId = session?.session.activeOrganizationId;
	const userId = session?.user.id;
	const searchId = useId();
	const statusId = useId();
	const statusLabels = useDrivingStatusLabels();
	const [search, setSearch] = useState("");
	const [submittedSearch, setSubmittedSearch] = useState("");
	const [status, setStatus] = useState<StatusFilter>("all");
	const [order, setOrder] = useState<Order>(DEFAULT_ORDER);
	useEffect(() => {
		const timer = setTimeout(
			() => setSubmittedSearch(search.trim()),
			SEARCH_DELAY_MS,
		);
		return () => clearTimeout(timer);
	}, [search]);
	const isDefaultOrder =
		order.sort === DEFAULT_ORDER.sort &&
		order.direction === DEFAULT_ORDER.direction;
	const query = {
		search: submittedSearch,
		status: status === "all" ? undefined : status,
		// Soonest deadline first is the server's default order.
		sort: isDefaultOrder ? undefined : order.sort,
		direction: isDefaultOrder ? undefined : order.direction,
	};
	const worklist = useQuery({
		queryKey: queryKeys.drivingLicence.worklist(organizationId, userId, query),
		queryFn: () => getDrivingLicenceCheckWorklistAction(query),
		enabled: !!organizationId && !!userId,
		retry: false,
		placeholderData: (previous) => previous,
	});
	const rows = worklist.data?.success ? worklist.data.data : null;
	const filtered = !!query.search || !!query.status;
	const filterOptions: { value: StatusFilter; label: string }[] = [
		{
			value: "all",
			label: t("drivingLicence.checks.filter.all", "All statuses"),
		},
		...DRIVING_LICENCE_WORKLIST_STATUSES.map((value) => ({
			value,
			label: statusLabels[value].short,
		})),
	];

	return (
		<Card className="min-w-0" aria-busy={worklist.isFetching}>
			<CardHeader>
				<CardTitle>
					<h2 className="text-lg font-semibold">
						{t("drivingLicence.checks.title", "Intended drivers to check")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.checks.help",
						"Intended drivers covered by your current verifier responsibility. You never appear in your own list.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p role="status" className="text-sm text-muted-foreground">
						<WorklistOrderLabel
							fetching={worklist.isFetching}
							defaultOrder={isDefaultOrder}
						/>
					</p>
					<Button
						variant="outline"
						disabled={worklist.isFetching}
						onClick={() => void worklist.refetch()}
					>
						{t("drivingLicence.checks.refresh", "Refresh check worklist")}
					</Button>
				</div>
				<div className="flex flex-wrap items-end gap-3">
					<div className="flex min-w-0 basis-56 flex-1 flex-col gap-1.5">
						<Label htmlFor={searchId}>
							{t("drivingLicence.checks.search", "Search by name")}
						</Label>
						<Input
							id={searchId}
							type="search"
							name="driving-check-search"
							autoComplete="off"
							maxLength={100}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</div>
					<div className="flex min-w-0 basis-48 flex-col gap-1.5">
						<span id={statusId} className="text-sm font-medium">
							{t("drivingLicence.checks.filter.status", "Status")}
						</span>
						<Select
							value={status}
							items={filterOptions}
							onValueChange={(value) =>
								setStatus((value as StatusFilter | null) ?? "all")
							}
						>
							<SelectTrigger aria-labelledby={statusId} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{filterOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
				{worklist.isError || (worklist.data && !worklist.data.success) ? (
					<div role="alert" className="space-y-2 text-sm">
						<p>
							{t(
								"drivingLicence.checks.loadError",
								"The list could not be loaded. Check your current verifier responsibility.",
							)}
						</p>
						<Button
							variant="outline"
							disabled={worklist.isFetching}
							onClick={() => void worklist.refetch()}
						>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				) : null}
				<WorklistRecords
					loading={worklist.isPending}
					rows={rows}
					filtered={filtered}
					emptyGuidance={emptyGuidance}
				>
					{rows ? (
						<WorklistTable
							rows={rows}
							busy={worklist.isFetching}
							order={order}
							onSort={setOrder}
						/>
					) : null}
				</WorklistRecords>
			</CardContent>
		</Card>
	);
}

function WorklistRecords({
	loading,
	rows,
	filtered,
	emptyGuidance,
	children,
}: {
	loading: boolean;
	rows: readonly DrivingLicenceWorklistRow[] | null;
	filtered: boolean;
	emptyGuidance: DrivingLicenceWorklistEmptyGuidance;
	children: React.ReactNode;
}) {
	const { t } = useTranslate();
	if (loading)
		return (
			<p role="status" className="text-sm text-muted-foreground">
				{t("drivingLicence.checks.loading", "Loading intended drivers…")}
			</p>
		);
	if (!rows) return null;
	if (!rows.length)
		return <WorklistEmpty filtered={filtered} guidance={emptyGuidance} />;
	return children;
}

/**
 * No rows: either nothing matches the search or filter, or nobody is in scope yet. Checks never
 * depend on the organization's vehicles, so the empty state names the two real reasons (#1937).
 */
function WorklistEmpty({
	filtered,
	guidance,
}: {
	filtered: boolean;
	guidance: DrivingLicenceWorklistEmptyGuidance;
}) {
	const { t } = useTranslate();
	if (filtered)
		return (
			<p role="status" className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.checks.noMatches",
					"No intended drivers match the search or filter.",
				)}
			</p>
		);
	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<IconUserSearch aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>
					{t("drivingLicence.checks.empty.title", "Nobody to check yet")}
				</EmptyTitle>
				<EmptyDescription>
					{guidance.canAssignIntendedDrivers
						? t(
								"drivingLicence.checks.empty.assignDescription",
								"Only intended drivers in your verifier responsibility appear here, and nobody is one yet. Assign intended drivers for the organization, a team or single employees.",
							)
						: t(
								"drivingLicence.checks.empty.askDescription",
								"Only intended drivers in your verifier responsibility appear here, and nobody is one yet. Ask an administrator to assign intended drivers.",
							)}
				</EmptyDescription>
				{guidance.selfIsIntendedDriver ? (
					<EmptyDescription>
						{t(
							"drivingLicence.checks.empty.self",
							"You never appear in your own list: another verifier must check your licence.",
						)}
					</EmptyDescription>
				) : null}
			</EmptyHeader>
			{guidance.canAssignIntendedDrivers ? (
				<EmptyContent>
					<Button asChild variant="outline">
						<Link href={DRIVING_LICENCE_INTENDED_DRIVERS_SETTINGS_PATH}>
							{t(
								"drivingLicence.checks.empty.assignAction",
								"Assign intended drivers",
							)}
						</Link>
					</Button>
				</EmptyContent>
			) : null}
		</Empty>
	);
}

function WorklistTable({
	rows,
	busy,
	order,
	onSort,
}: {
	rows: readonly DrivingLicenceWorklistRow[];
	busy: boolean;
	order: Order;
	onSort: (order: Order) => void;
}) {
	const { t } = useTranslate();
	const statusLabels = useDrivingStatusLabels();
	return (
		<Table aria-busy={busy} mobileLayout="stacked">
			<TableHeader>
				<TableRow>
					<SortableHead column="name" order={order} onSort={onSort}>
						{t("drivingLicence.checks.column.name", "Name")}
					</SortableHead>
					<TableHead>
						{t("drivingLicence.checks.column.status", "Status")}
					</TableHead>
					<SortableHead column="deadline" order={order} onSort={onSort}>
						{t("drivingLicence.checks.column.deadline", "Next deadline")}
					</SortableHead>
					<SortableHead column="team" order={order} onSort={onSort}>
						{t("drivingLicence.checks.column.team", "Team")}
					</SortableHead>
					<TableHead>
						<span className="sr-only">
							{t("drivingLicence.checks.column.action", "Action")}
						</span>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((person) => (
					<TableRow key={person.employeeId}>
						<TableCell className="font-medium">{person.name}</TableCell>
						<TableCell>
							<div className="flex flex-wrap items-center gap-1.5">
								<Badge variant={STATUS_BADGE[person.status]}>
									{statusLabels[person.status].short}
								</Badge>
								{person.declaredUnchecked.length ? (
									<Badge variant="outline" className="border-dashed text-muted-foreground">
										{person.declaredUnchecked.map((code) => (
											<LicenceClassIcon key={code} code={code} size="sm" />
										))}
										{t("drivingLicence.checks.declared", "Declared {classes}", {
											classes: person.declaredUnchecked.join(", "),
										})}
									</Badge>
								) : null}
							</div>
						</TableCell>
						<TableCell>
							{person.nextDeadline && person.declaredUnchecked.length ? (
								<span className="flex flex-col">
									{t("drivingLicence.checks.declaredDue", "Check declared classes")}
									<span className="text-xs text-muted-foreground">
										<DrivingDeadlineDate
											validThrough={person.nextDeadline.validThrough}
											timezone={person.nextDeadline.timezone}
										/>
									</span>
								</span>
							) : person.nextDeadline ? (
								<DrivingDeadlineDate
									validThrough={person.nextDeadline.validThrough}
									timezone={person.nextDeadline.timezone}
								/>
							) : person.status === "ended" ? (
								"—"
							) : (
								t("drivingLicence.checks.dueNow", "Check due now")
							)}
						</TableCell>
						<TableCell>{person.team ? person.team.name : "—"}</TableCell>
						<TableCell className="text-right">
							<Button
								asChild
								variant="outline"
								size="sm"
								className="h-auto min-h-8 max-w-full whitespace-normal break-words text-left"
							>
								<Link href={drivingLicenceCheckPath(person.employeeId)}>
									{person.canVerify
										? t("drivingLicence.worklist.open", "Check {name}", {
												name: person.name,
											})
										: t(
												"drivingLicence.worklist.viewEnded",
												"View ended record for {name}",
												{
													name: person.name,
												},
											)}
								</Link>
							</Button>
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
