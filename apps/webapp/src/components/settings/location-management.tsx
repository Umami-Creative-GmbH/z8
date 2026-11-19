"use client";

import {
	IconAlertTriangle,
	IconMapPin,
	IconPlus,
	IconRefresh,
	IconUsers,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	getLocations,
	type LocationListItem,
} from "@/app/[locale]/(app)/settings/locations/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { LocationDialog } from "./location-dialog";

interface LocationManagementProps {
	organizationId: string;
	canManageLocations: boolean;
}

export function LocationManagement({
	organizationId,
	canManageLocations,
}: LocationManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingLocation, setEditingLocation] = useState<LocationListItem | null>(null);

	const {
		data: locationsResult,
		isLoading,
		isError,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.locations.list(organizationId),
		queryFn: async () => {
			const result = await getLocations();
			if (!result.success) throw new Error(result.error ?? "Unknown error");
			return result.data;
		},
	});

	const locations = locationsResult || [];

	const handleCreate = () => {
		setEditingLocation(null);
		setDialogOpen(true);
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.locations.list(organizationId) });
		setDialogOpen(false);
		setEditingLocation(null);
	};

	return (
		<div className="page-frame flex flex-1 flex-col gap-4">
			<PageHeader
				title={t("settings.locations.title", "Locations")}
				description={t(
					"settings.locations.description",
					"Manage organization locations and subareas",
				)}
				actions={
					<>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => refetch()}
							disabled={isFetching}
							aria-label={t("common.refresh", "Refresh")}
							title={t("common.refresh", "Refresh")}
						>
							<IconRefresh
								className={cn("size-4", isFetching && "motion-safe:animate-spin")}
								aria-hidden="true"
							/>
						</Button>
						{canManageLocations && (
							<Button onClick={handleCreate}>
								<IconPlus className="size-4" aria-hidden="true" />
								{t("settings.locations.create", "Create Location")}
							</Button>
						)}
					</>
				}
			/>

			{isLoading ? (
				<Card aria-busy="true">
					<CardContent className="p-6">
						<div className="space-y-4">
							<Skeleton className="h-10 w-full" aria-hidden="true" />
							<Skeleton className="h-10 w-full" aria-hidden="true" />
							<Skeleton className="h-10 w-full" aria-hidden="true" />
						</div>
					</CardContent>
				</Card>
			) : isError && !locationsResult ? (
				<Alert variant="destructive">
					<IconAlertTriangle aria-hidden="true" />
					<AlertTitle>
						{t("settings.locations.loadFailed", "Locations could not be loaded")}
					</AlertTitle>
					<AlertDescription className="gap-3">
						<p>
							{t(
								"settings.locations.loadFailedDescription",
								"Check your connection, then try again.",
							)}
						</p>
						<Button
							variant="outline"
							size="sm"
							onClick={() => refetch()}
							disabled={isFetching}
						>
							<IconRefresh
								className={cn("size-4", isFetching && "motion-safe:animate-spin")}
								aria-hidden="true"
							/>
							{t("common.retry", "Retry")}
						</Button>
					</AlertDescription>
				</Alert>
			) : locations.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
						<IconMapPin className="size-8 text-muted-foreground" aria-hidden="true" />
						<h2 className="font-semibold">
							{t("settings.locations.noLocations", "No locations yet")}
						</h2>
						<CardDescription className="max-w-md">
							{t(
								"settings.locations.noLocationsDescription",
								"Create your first location to organize your workspace.",
							)}
						</CardDescription>
						{canManageLocations && (
							<Button className="mt-2" onClick={handleCreate}>
								<IconPlus className="size-4" aria-hidden="true" />
								{t("settings.locations.create", "Create Location")}
							</Button>
						)}
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardContent className="p-0">
						<Table mobileLayout="stacked">
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.locations.name", "Name")}</TableHead>
									<TableHead>{t("settings.locations.address", "Address")}</TableHead>
									<TableHead className="text-center">
										{t("settings.locations.subareas", "Subareas")}
									</TableHead>
									<TableHead className="text-center">
										{t("settings.locations.supervisors", "Supervisors")}
									</TableHead>
									<TableHead>{t("common.status", "Status")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{locations.map((location) => (
									<TableRow key={location.id}>
										<TableCell className="max-w-80">
											<Link
												href={`/settings/locations/${location.id}`}
												className="flex min-w-0 items-center gap-2 font-medium hover:underline"
												title={location.name}
											>
												<IconMapPin
													className="size-4 shrink-0 text-muted-foreground"
													aria-hidden="true"
												/>
												<span className="truncate">{location.name}</span>
											</Link>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{location.city && location.country
												? `${location.city}, ${location.country}`
												: location.city || location.country || "-"}
										</TableCell>
										<TableCell className="text-center">
											<Badge variant="secondary" className="tabular-nums">
												{location.subareaCount}
											</Badge>
										</TableCell>
										<TableCell className="text-center">
											<div className="flex items-center justify-center gap-1">
												<IconUsers
													className="size-4 text-muted-foreground"
													aria-hidden="true"
												/>
												<span className="tabular-nums">{location.employeeCount}</span>
											</div>
										</TableCell>
										<TableCell>
											<Badge variant={location.isActive ? "default" : "secondary"}>
												{location.isActive
													? t("common.active", "Active")
													: t("common.inactive", "Inactive")}
											</Badge>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			{canManageLocations && (
				<LocationDialog
					location={editingLocation}
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					onSuccess={handleSuccess}
				/>
			)}
		</div>
	);
}
