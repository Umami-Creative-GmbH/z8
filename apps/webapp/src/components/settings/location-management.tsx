"use client";

import { IconMapPin, IconPlus, IconRefresh, IconUsers } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	getLocations,
	type LocationListItem,
} from "@/app/[locale]/(app)/settings/locations/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Link } from "@/navigation";
import { LocationDialog } from "./location-dialog";

interface LocationManagementProps {
	organizationId: string;
}

export function LocationManagement({ organizationId }: LocationManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingLocation, setEditingLocation] = useState<LocationListItem | null>(null);

	const {
		data: locationsResult,
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.locations.list(organizationId),
		queryFn: async () => {
			const result = await getLocations(organizationId);
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
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.locations.title", "Locations")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.locations.description",
							"Manage organization locations and subareas",
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						<IconRefresh className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
					<Button onClick={handleCreate}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.locations.create", "Create Location")}
					</Button>
				</div>
			</div>

			{isLoading ? (
				<Card>
					<CardContent className="p-6">
						<div className="space-y-4">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					</CardContent>
				</Card>
			) : locations.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<IconMapPin className="h-12 w-12 text-muted-foreground/50 mb-4" />
						<CardTitle className="mb-2">
							{t("settings.locations.noLocations", "No locations yet")}
						</CardTitle>
						<CardDescription className="text-center mb-4">
							{t(
								"settings.locations.noLocationsDescription",
								"Create your first location to organize your workspace.",
							)}
						</CardDescription>
						<Button onClick={handleCreate}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.locations.create", "Create Location")}
						</Button>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardContent className="p-0">
						<Table>
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
									<TableRow key={location.id} className="cursor-pointer hover:bg-muted/50">
										<TableCell>
											<Link
												href={`/settings/locations/${location.id}`}
												className="flex items-center gap-2 font-medium hover:underline"
											>
												<IconMapPin className="h-4 w-4 text-muted-foreground" />
												{location.name}
											</Link>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{location.city && location.country
												? `${location.city}, ${location.country}`
												: location.city || location.country || "-"}
										</TableCell>
										<TableCell className="text-center">
											<Badge variant="secondary">{location.subareaCount}</Badge>
										</TableCell>
										<TableCell className="text-center">
											<div className="flex items-center justify-center gap-1">
												<IconUsers className="h-4 w-4 text-muted-foreground" />
												<span>{location.employeeCount}</span>
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

			<LocationDialog
				organizationId={organizationId}
				location={editingLocation}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSuccess={handleSuccess}
			/>
		</div>
	);
}
