"use client";

import {
	IconArrowLeft,
	IconEdit,
	IconMapPin,
	IconPlus,
	IconRefresh,
	IconStar,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteLocation,
	deleteSubarea,
	getLocation,
	type LocationWithDetails,
	type SubareaWithEmployees,
} from "@/app/[locale]/(app)/settings/locations/actions";
import {
	removeLocationEmployee,
	removeSubareaEmployee,
} from "@/app/[locale]/(app)/settings/locations/assignment-actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";
import { Link, useRouter } from "@/navigation";
import { LocationDialog } from "./location-dialog";
import { LocationEmployeeDialog } from "./location-employee-dialog";
import { SubareaDialog } from "./subarea-dialog";
import { SubareaEmployeeDialog } from "./subarea-employee-dialog";

interface LocationDetailProps {
	locationId: string;
	organizationId: string;
}

export function LocationDetail({ locationId, organizationId }: LocationDetailProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();

	// Dialog states
	const [editLocationOpen, setEditLocationOpen] = useState(false);
	const [deleteLocationOpen, setDeleteLocationOpen] = useState(false);
	const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
	const [addSubareaOpen, setAddSubareaOpen] = useState(false);
	const [editSubarea, setEditSubarea] = useState<SubareaWithEmployees | null>(null);
	const [deleteSubareaId, setDeleteSubareaId] = useState<string | null>(null);
	const [subareaEmployeeDialog, setSubareaEmployeeDialog] = useState<{
		open: boolean;
		subareaId: string;
		subareaName: string;
	} | null>(null);

	const {
		data: locationResult,
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.locations.detail(locationId),
		queryFn: async () => {
			const result = await getLocation(locationId);
			if (!result.success) throw new Error(result.error ?? "Unknown error");
			return result.data;
		},
	});

	const location = locationResult;

	const handleDeleteLocation = async () => {
		const result = await deleteLocation(locationId);
		if (result.success) {
			toast.success(t("settings.locations.deleted", "Location deleted"));
			router.push("/settings/locations");
		} else {
			toast.error(
				result.error || t("settings.locations.deleteFailed", "Failed to delete location"),
			);
		}
		setDeleteLocationOpen(false);
	};

	const handleRemoveEmployee = async (assignmentId: string) => {
		const result = await removeLocationEmployee(assignmentId);
		if (result.success) {
			toast.success(t("settings.locations.employeeRemoved", "Employee removed"));
			queryClient.invalidateQueries({ queryKey: queryKeys.locations.detail(locationId) });
		} else {
			toast.error(
				result.error || t("settings.locations.employeeRemoveFailed", "Failed to remove employee"),
			);
		}
	};

	const handleDeleteSubarea = async () => {
		if (!deleteSubareaId) return;
		const result = await deleteSubarea(deleteSubareaId);
		if (result.success) {
			toast.success(t("settings.locations.subareaDeleted", "Subarea deleted"));
			queryClient.invalidateQueries({ queryKey: queryKeys.locations.detail(locationId) });
		} else {
			toast.error(
				result.error || t("settings.locations.subareaDeleteFailed", "Failed to delete subarea"),
			);
		}
		setDeleteSubareaId(null);
	};

	const handleRemoveSubareaEmployee = async (assignmentId: string) => {
		const result = await removeSubareaEmployee(assignmentId);
		if (result.success) {
			toast.success(t("settings.locations.employeeRemoved", "Employee removed"));
			queryClient.invalidateQueries({ queryKey: queryKeys.locations.detail(locationId) });
		} else {
			toast.error(
				result.error || t("settings.locations.employeeRemoveFailed", "Failed to remove employee"),
			);
		}
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.locations.detail(locationId) });
		queryClient.invalidateQueries({ queryKey: queryKeys.locations.list(organizationId) });
	};

	const getEmployeeName = (emp: LocationWithDetails["employees"][number]["employee"]) => {
		if (emp.firstName || emp.lastName) {
			return `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
		}
		return emp.user.name || emp.user.email;
	};

	if (isLoading) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<Skeleton className="h-8 w-48" />
				<div className="grid gap-4 lg:grid-cols-3">
					<Skeleton className="h-64" />
					<Skeleton className="h-64" />
					<Skeleton className="h-64" />
				</div>
			</div>
		);
	}

	if (!location) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
				<IconMapPin className="h-12 w-12 text-muted-foreground/50" />
				<p className="text-muted-foreground">
					{t("settings.locations.notFound", "Location not found")}
				</p>
				<Button asChild variant="outline">
					<Link href="/settings/locations">
						<IconArrowLeft className="mr-2 h-4 w-4" />
						{t("settings.locations.backToList", "Back to Locations")}
					</Link>
				</Button>
			</div>
		);
	}

	const formatAddress = () => {
		const parts = [location.street, location.postalCode, location.city, location.country].filter(
			Boolean,
		);
		return parts.length > 0 ? parts.join(", ") : null;
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Button asChild variant="ghost" size="icon">
						<Link href="/settings/locations">
							<IconArrowLeft className="h-4 w-4" />
						</Link>
					</Button>
					<div>
						<div className="flex items-center gap-2">
							<h1 className="text-2xl font-semibold tracking-tight">{location.name}</h1>
							<Badge variant={location.isActive ? "default" : "secondary"}>
								{location.isActive
									? t("common.active", "Active")
									: t("common.inactive", "Inactive")}
							</Badge>
						</div>
						{formatAddress() && <p className="text-sm text-muted-foreground">{formatAddress()}</p>}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						<IconRefresh className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
					</Button>
					<Button variant="outline" onClick={() => setEditLocationOpen(true)}>
						<IconEdit className="mr-2 h-4 w-4" />
						{t("common.edit", "Edit")}
					</Button>
					<Button variant="destructive" onClick={() => setDeleteLocationOpen(true)}>
						<IconTrash className="mr-2 h-4 w-4" />
						{t("common.delete", "Delete")}
					</Button>
				</div>
			</div>

			{/* Content Grid */}
			<div className="grid gap-4 lg:grid-cols-3">
				{/* Location Info */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconMapPin className="h-5 w-5" />
							{t("settings.locations.details", "Location Details")}
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<p className="text-sm font-medium text-muted-foreground">
								{t("settings.locations.field.name", "Name")}
							</p>
							<p>{location.name}</p>
						</div>
						{location.street && (
							<div>
								<p className="text-sm font-medium text-muted-foreground">
									{t("settings.locations.field.street", "Street")}
								</p>
								<p>{location.street}</p>
							</div>
						)}
						{(location.city || location.postalCode) && (
							<div>
								<p className="text-sm font-medium text-muted-foreground">
									{t("settings.locations.field.cityPostal", "City / Postal Code")}
								</p>
								<p>{[location.postalCode, location.city].filter(Boolean).join(" ")}</p>
							</div>
						)}
						{location.country && (
							<div>
								<p className="text-sm font-medium text-muted-foreground">
									{t("settings.locations.field.country", "Country")}
								</p>
								<p>{location.country}</p>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Assigned Employees */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle className="flex items-center gap-2">
								<IconUsers className="h-5 w-5" />
								{t("settings.locations.supervisors", "Supervisors")}
							</CardTitle>
							<Button size="sm" variant="outline" onClick={() => setAddEmployeeOpen(true)}>
								<IconPlus className="mr-2 h-4 w-4" />
								{t("common.add", "Add")}
							</Button>
						</div>
						<CardDescription>
							{t(
								"settings.locations.supervisorsDescription",
								"Employees assigned to this location",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{location.employees.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t("settings.locations.noSupervisors", "No supervisors assigned")}
							</p>
						) : (
							<div className="space-y-2">
								{location.employees.map((assignment) => (
									<div
										key={assignment.id}
										className="flex items-center justify-between rounded-lg border p-3"
									>
										<div className="flex items-center gap-3">
											<div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
												<IconUser className="h-4 w-4" />
											</div>
											<div>
												<div className="flex items-center gap-2">
													<p className="font-medium text-sm">
														{getEmployeeName(assignment.employee)}
													</p>
													{assignment.isPrimary && (
														<Badge variant="outline" className="text-xs">
															<IconStar className="mr-1 h-3 w-3" />
															{t("settings.locations.primary", "Primary")}
														</Badge>
													)}
												</div>
												<p className="text-xs text-muted-foreground">
													{assignment.employee.user.email}
												</p>
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => handleRemoveEmployee(assignment.id)}
										>
											<IconTrash className="h-4 w-4" />
										</Button>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Subareas */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle>{t("settings.locations.subareas", "Subareas")}</CardTitle>
							<Button size="sm" variant="outline" onClick={() => setAddSubareaOpen(true)}>
								<IconPlus className="mr-2 h-4 w-4" />
								{t("common.add", "Add")}
							</Button>
						</div>
						<CardDescription>
							{t("settings.locations.subareasDescription", "Areas within this location")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{location.subareas.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								{t("settings.locations.noSubareas", "No subareas yet")}
							</p>
						) : (
							<div className="space-y-3">
								{location.subareas.map((subarea) => (
									<div key={subarea.id} className="rounded-lg border">
										<div className="flex items-center justify-between p-3">
											<div className="flex items-center gap-2">
												<span className="font-medium">{subarea.name}</span>
												{!subarea.isActive && (
													<Badge variant="secondary" className="text-xs">
														{t("common.inactive", "Inactive")}
													</Badge>
												)}
											</div>
											<div className="flex items-center gap-1">
												<Button
													variant="ghost"
													size="icon"
													onClick={() =>
														setSubareaEmployeeDialog({
															open: true,
															subareaId: subarea.id,
															subareaName: subarea.name,
														})
													}
												>
													<IconPlus className="h-4 w-4" />
												</Button>
												<Button variant="ghost" size="icon" onClick={() => setEditSubarea(subarea)}>
													<IconEdit className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => setDeleteSubareaId(subarea.id)}
												>
													<IconTrash className="h-4 w-4" />
												</Button>
											</div>
										</div>
										{subarea.employees.length > 0 && (
											<div className="border-t px-3 py-2 space-y-1">
												{subarea.employees.map((emp) => (
													<div key={emp.id} className="flex items-center justify-between text-sm">
														<div className="flex items-center gap-2">
															<span>{getEmployeeName(emp.employee)}</span>
															{emp.isPrimary && <IconStar className="h-3 w-3 text-yellow-500" />}
														</div>
														<Button
															variant="ghost"
															size="icon"
															className="h-6 w-6"
															onClick={() => handleRemoveSubareaEmployee(emp.id)}
														>
															<IconTrash className="h-3 w-3" />
														</Button>
													</div>
												))}
											</div>
										)}
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Edit Location Dialog */}
			<LocationDialog
				organizationId={organizationId}
				location={{
					id: location.id,
					name: location.name,
					city: location.city,
					country: location.country,
					isActive: location.isActive,
					subareaCount: location.subareaCount,
					employeeCount: location.employeeCount,
				}}
				open={editLocationOpen}
				onOpenChange={setEditLocationOpen}
				onSuccess={() => {
					setEditLocationOpen(false);
					handleSuccess();
				}}
			/>

			{/* Delete Location Dialog */}
			<AlertDialog open={deleteLocationOpen} onOpenChange={setDeleteLocationOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.locations.deleteTitle", "Delete Location")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.locations.deleteDescription",
								"Are you sure you want to delete this location? This will also delete all subareas and employee assignments.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction onClick={handleDeleteLocation}>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Add Employee Dialog */}
			<LocationEmployeeDialog
				organizationId={organizationId}
				locationId={locationId}
				open={addEmployeeOpen}
				onOpenChange={setAddEmployeeOpen}
				onSuccess={handleSuccess}
			/>

			{/* Subarea Dialog (Create) */}
			<SubareaDialog
				locationId={locationId}
				subarea={null}
				open={addSubareaOpen}
				onOpenChange={setAddSubareaOpen}
				onSuccess={() => {
					setAddSubareaOpen(false);
					handleSuccess();
				}}
			/>

			{/* Subarea Dialog (Edit) */}
			{editSubarea && (
				<SubareaDialog
					locationId={locationId}
					subarea={editSubarea}
					open={!!editSubarea}
					onOpenChange={(open) => !open && setEditSubarea(null)}
					onSuccess={() => {
						setEditSubarea(null);
						handleSuccess();
					}}
				/>
			)}

			{/* Delete Subarea Dialog */}
			<AlertDialog open={!!deleteSubareaId} onOpenChange={() => setDeleteSubareaId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.locations.deleteSubareaTitle", "Delete Subarea")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.locations.deleteSubareaDescription",
								"Are you sure you want to delete this subarea? This will also remove all employee assignments.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction onClick={handleDeleteSubarea}>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Subarea Employee Dialog */}
			{subareaEmployeeDialog && (
				<SubareaEmployeeDialog
					organizationId={organizationId}
					subareaId={subareaEmployeeDialog.subareaId}
					subareaName={subareaEmployeeDialog.subareaName}
					open={subareaEmployeeDialog.open}
					onOpenChange={(open) => !open && setSubareaEmployeeDialog(null)}
					onSuccess={handleSuccess}
				/>
			)}
		</div>
	);
}
