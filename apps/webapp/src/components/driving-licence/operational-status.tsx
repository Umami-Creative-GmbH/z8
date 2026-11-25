"use client";
import { IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useDeferredValue, useId, useState } from "react";
import { EmployeeSingleSelect, toSelectableEmployee } from "@/components/employee-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query";
import { DrivingStatusLabel } from "./check-evidence";
import { LicenceClassChip, LicenceClassIcon } from "./licence-class-visuals";
import {
	loadDrivingAuthorizationStatus,
	loadOperationalDrivingEmployees,
} from "./operational-client";

type DrivingAuthorizationStatus = Extract<
	Awaited<ReturnType<typeof loadDrivingAuthorizationStatus>>,
	{ success: true }
>["data"];
type DrivingAuthorizationStatusData = NonNullable<DrivingAuthorizationStatus>;

function useDrivingAuthorizationStatus(employeeId: string | undefined) {
	const { data: session } = useSession();
	const organizationId = session?.session.activeOrganizationId;
	const userId = session?.user.id;
	const query = useQuery({
		queryKey: queryKeys.drivingLicence.statusFor(
			organizationId,
			userId,
			employeeId,
		),
		// Let an already started advisory read finish after its UI unmounts.
		queryFn: () =>
			loadDrivingAuthorizationStatus(organizationId ?? "", employeeId),
		enabled: !!organizationId && !!userId,
		staleTime: 0,
		refetchInterval: 60_000,
		retry: false,
	});
	const signedIn = !!organizationId && !!userId;
	const answer = !query.isError && query.data?.success ? query.data.data : null;
	// The server answers `null` unless the visibility reader shows the advisory (feature on,
	// intended driver). Render nothing until it has answered, so others never see a flash.
	const hidden =
		!signedIn ||
		query.isPending ||
		(!query.isError && !!query.data?.success && query.data.data === null);
	return { query, hidden, data: answer };
}

/** This query never participates in clock commands, vehicle context loading or button admission. */
export function DrivingAuthorizationAdvisory({
	employeeId,
}: {
	employeeId?: string;
}) {
	const { t } = useTranslate();
	const { query, hidden, data } = useDrivingAuthorizationStatus(employeeId);
	if (hidden) return null;
	return (
		<aside
			className="space-y-2 rounded-md border p-3 text-sm"
			aria-label={t(
				"drivingLicence.operational.advisory",
				"Driving authorization",
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<p
					role="status"
					aria-live="polite"
					className="min-w-0 break-words font-medium"
				>
					<AdvisoryStatusText isFetching={query.isFetching} data={data} />
				</p>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-7 shrink-0"
					aria-label={t(
						"drivingLicence.operational.refresh",
						"Refresh driving status",
					)}
					disabled={query.isFetching}
					onClick={() => void query.refetch()}
				>
					<IconRefresh className="size-4" aria-hidden="true" />
				</Button>
			</div>
			{!query.isFetching && data ? (
				<>
					<AdvisoryClassList classes={data.classes} />
					<AdvisoryDeclaredClasses codes={data.declaredClasses} />
				</>
			) : null}
			<p className="text-xs text-muted-foreground">
				{t(
					"drivingLicence.operational.recordingHelp",
					"You can always record working time and actual vehicle use. Selecting a vehicle grants no driving authorization; checked classes do not establish suitability for every vehicle.",
				)}
			</p>
		</aside>
	);
}

function AdvisoryStatusText({
	isFetching,
	data,
}: {
	isFetching: boolean;
	data: DrivingAuthorizationStatus;
}) {
	const { t } = useTranslate();
	if (isFetching)
		return t(
			"drivingLicence.operational.loading",
			"Loading driving authorization…",
		);
	if (data) return <DrivingStatusLabel status={data.status} />;
	return t(
		"drivingLicence.operational.unavailable",
		"Driving authorization status is unavailable.",
	);
}

function AdvisoryClassList({
	classes,
}: {
	classes: DrivingAuthorizationStatusData["classes"];
}) {
	const { t } = useTranslate();
	if (!classes.length) return null;
	const statusText = (status: (typeof classes)[number]["status"]) => {
		if (status === "active")
			return t("drivingLicence.class.active", "Authorized");
		if (status === "ended") return t("drivingLicence.class.ended", "Ended");
		return t("drivingLicence.class.suspended", "Suspended");
	};
	return (
		<ul className="space-y-1">
			{classes.map((entry) => (
				<li key={entry.code} className="flex flex-wrap items-center gap-x-2">
					<LicenceClassIcon code={entry.code} size="sm" className="text-muted-foreground" />
					<strong translate="no">{entry.code}</strong>
					<span>{statusText(entry.status)}</span>
					{entry.restrictions ? (
						<span className="w-full break-words text-muted-foreground">
							{entry.restrictions}
						</span>
					) : null}
				</li>
			))}
		</ul>
	);
}

function AdvisoryDeclaredClasses({
	codes,
}: {
	codes: DrivingAuthorizationStatusData["declaredClasses"];
}) {
	const { t } = useTranslate();
	if (!codes?.length) return null;
	return (
		<div className="space-y-1.5 border-t border-dashed pt-2">
			<p className="text-xs font-medium text-muted-foreground">
				{t(
					"drivingLicence.operational.declared",
					"Declared, not checked yet. Not an authorization to drive.",
				)}
			</p>
			<ul className="flex flex-wrap gap-1.5">
				{codes.map((code) => (
					<li key={code}>
						<LicenceClassChip code={code} />
					</li>
				))}
			</ul>
		</div>
	);
}
export function OperationalDrivingStatusPanel() {
	const { data: session } = useSession();
	if (!session?.session.activeOrganizationId || !session.user.id) return null;
	return (
		<OperationalDrivingEmployees
			key={`${session.session.activeOrganizationId}:${session.user.id}`}
			organizationId={session.session.activeOrganizationId}
			userId={session.user.id}
		/>
	);
}
function OperationalDrivingEmployees({
	organizationId,
	userId,
}: {
	organizationId: string;
	userId: string;
}) {
	const { t } = useTranslate();
	const id = useId();
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const deferredSearch = useDeferredValue(search);
	const query = useQuery({
		queryKey: queryKeys.drivingLicence.operationalEmployees(
			organizationId,
			userId,
			deferredSearch,
		),
		queryFn: ({ signal }) =>
			loadOperationalDrivingEmployees(organizationId, deferredSearch, signal),
		placeholderData: (previous) => previous,
		refetchInterval: 60_000,
		retry: false,
	});
	// A refusal withdraws the roster and selected status; never retain inspection access.
	const employees =
		!query.isError && query.data?.success ? query.data.data : null;
	const selectableEmployees = (employees ?? []).map((entry) =>
		toSelectableEmployee({ id: entry.employeeId, name: entry.name }),
	);
	const activeSelected =
		selected && employees?.some((entry) => entry.employeeId === selected)
			? selected
			: null;
	return (
		<Card
			className="min-w-0"
			role="region"
			aria-labelledby={`${id}-title`}
			aria-busy={query.isFetching}
		>
			<CardHeader>
				<CardTitle>
					<h2 id={`${id}-title`} className="text-lg font-semibold">
						{t(
							"drivingLicence.operational.title",
							"Driving status for planning",
						)}
					</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{query.isPending ? (
					<p role="status">
						{t(
							"drivingLicence.operational.loadingEmployees",
							"Loading employees for planning…",
						)}
					</p>
				) : null}
				{!query.isPending && !employees ? (
					<div role="alert" className="space-y-2 text-sm">
						<p>
							{t(
								"drivingLicence.operational.rosterUnavailable",
								"Planning employees are unavailable. Check your current organization access and retry.",
							)}
						</p>
						<Button
							variant="outline"
							disabled={query.isFetching}
							onClick={() => void query.refetch()}
						>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				) : null}
				<Button
					variant="outline"
					disabled={query.isFetching}
					onClick={() => void query.refetch()}
				>
					{t(
						"drivingLicence.operational.refreshEmployees",
						"Refresh planning employees",
					)}
				</Button>
				<EmployeeSingleSelect
					id={id}
					label={t("drivingLicence.operational.search", "Find employee")}
					placeholder={t(
						"drivingLicence.operational.selectEmployee",
						"Select employee",
					)}
					searchPlaceholder={t(
						"drivingLicence.operational.search",
						"Find employee",
					)}
					emptyMessage={t(
						"drivingLicence.operational.noEmployees",
						"No matching employees.",
					)}
					value={activeSelected}
					onChange={(next) => setSelected(next)}
					employees={selectableEmployees}
					onSearchChange={(next) => {
						setSearch(next);
						setSelected(null);
					}}
					isLoading={query.isFetching}
					allowClear
					disabled={!employees}
				/>
				<p className="text-xs text-muted-foreground">
					{t(
						"drivingLicence.operational.searchHelp",
						"Up to 50 employees are shown. Narrow the search to find another employee. This view contains no inspection records.",
					)}
				</p>
				{activeSelected ? (
					<DrivingAuthorizationAdvisory employeeId={activeSelected} />
				) : null}
			</CardContent>
		</Card>
	);
}
