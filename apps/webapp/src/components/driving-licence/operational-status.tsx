"use client";
import { IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useDeferredValue, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query";
import { DrivingStatusLabel } from "./check-evidence";
import {
	loadDrivingAuthorizationStatus,
	loadOperationalDrivingEmployees,
} from "./operational-client";

/** This query never participates in clock commands, vehicle context loading or button admission. */
export function DrivingAuthorizationAdvisory({
	employeeId,
}: {
	employeeId?: string;
}) {
	const { t } = useTranslate();
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
	if (!organizationId || !userId) return null;
	// The server answers `null` unless the visibility reader shows the advisory (feature on,
	// intended driver). Render nothing until it has answered, so others never see a flash.
	if (query.isPending) return null;
	if (!query.isError && query.data?.success && query.data.data === null)
		return null;
	const data = !query.isError && query.data?.success ? query.data.data : null;
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
					{query.isFetching ? (
						t(
							"drivingLicence.operational.loading",
							"Loading driving authorization…",
						)
					) : data ? (
						<DrivingStatusLabel status={data.status} />
					) : (
						t(
							"drivingLicence.operational.unavailable",
							"Driving authorization status is unavailable.",
						)
					)}
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
			{!query.isFetching && data?.classes.length ? (
				<ul className="space-y-1">
					{data.classes.map((entry) => (
						<li key={entry.code} className="flex flex-wrap gap-x-2">
							<strong translate="no">{entry.code}</strong>
							<span>
								{entry.status === "active"
									? t("drivingLicence.class.active", "Authorized")
									: entry.status === "ended"
										? t("drivingLicence.class.ended", "Ended")
										: t("drivingLicence.class.suspended", "Suspended")}
							</span>
							{entry.restrictions ? (
								<span className="w-full break-words text-muted-foreground">
									{entry.restrictions}
								</span>
							) : null}
						</li>
					))}
				</ul>
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
				<Label htmlFor={id}>
					{t("drivingLicence.operational.search", "Find employee")}
				</Label>
				<Input
					id={id}
					type="search"
					name="driving-employee-search"
					autoComplete="off"
					maxLength={100}
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						setSelected(null);
					}}
				/>
				<p className="text-xs text-muted-foreground">
					{t(
						"drivingLicence.operational.searchHelp",
						"Up to 50 employees are shown. Narrow the search to find another employee. This view contains no inspection records.",
					)}
				</p>
				<ul className="flex flex-wrap gap-2">
					{employees?.map((entry) => (
						<li key={entry.employeeId} className="min-w-0 max-w-full">
							<Button
								type="button"
								variant={
									selected === entry.employeeId ? "secondary" : "outline"
								}
								aria-pressed={selected === entry.employeeId}
								className="h-auto min-h-9 max-w-full whitespace-normal break-words text-left"
								onClick={() => setSelected(entry.employeeId)}
							>
								{entry.name}
							</Button>
						</li>
					))}
				</ul>
				{employees && !employees.length ? (
					<p>
						{t(
							"drivingLicence.operational.noEmployees",
							"No matching employees.",
						)}
					</p>
				) : null}
				{selected &&
				employees?.some((entry) => entry.employeeId === selected) ? (
					<DrivingAuthorizationAdvisory employeeId={selected} />
				) : null}
			</CardContent>
		</Card>
	);
}
