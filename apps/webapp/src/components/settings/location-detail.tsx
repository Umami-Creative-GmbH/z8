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
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
	canManageLocations: boolean;
}

function getEmployeeName(
	emp: LocationWithDetails["employees"][number]["employee"],
) {
	if (emp.firstName || emp.lastName) {
		return `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
	}
	return emp.user.name || emp.user.email;
}

export function LocationDetail({
	locationId,
	organizationId,
	canManageLocations,
}: LocationDetailProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();

	// Dialog states
	const [editLocationOpen, setEditLocationOpen] = useState(false);
	const [deleteLocationOpen, setDeleteLocationOpen] = useState(false);
	const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
	const [addSubareaOpen, setAddSubareaOpen] = useState(false);
	const [editSubarea, setEditSubarea] = useState<SubareaWithEmployees | null>(
		null,
	);
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
				result.error ||
					t("settings.locations.deleteFailed", "Failed to delete location"),
			);
		}
		setDeleteLocationOpen(false);
	};

	const handleRemoveEmployee = async (assignmentId: string) => {
		const result = await removeLocationEmployee(assignmentId);
		if (result.success) {
			toast.success(
				t("settings.locations.employeeRemoved", "Employee removed"),
			);
			queryClient.invalidateQueries({
				queryKey: queryKeys.locations.detail(locationId),
			});
		} else {
			toast.error(
				result.error ||
					t(
						"settings.locations.employeeRemoveFailed",
						"Failed to remove employee",
					),
			);
		}
	};

	const handleDeleteSubarea = async () => {
		if (!deleteSubareaId) return;
		const result = await deleteSubarea(deleteSubareaId);
		if (result.success) {
			toast.success(t("settings.locations.subareaDeleted", "Subarea deleted"));
			queryClient.invalidateQueries({
				queryKey: queryKeys.locations.detail(locationId),
			});
		} else {
			toast.error(
				result.error ||
					t(
						"settings.locations.subareaDeleteFailed",
						"Failed to delete subarea",
					),
			);
		}
		setDeleteSubareaId(null);
	};

	const handleRemoveSubareaEmployee = async (assignmentId: string) => {
		const result = await removeSubareaEmployee(assignmentId);
		if (result.success) {
			toast.success(
				t("settings.locations.employeeRemoved", "Employee removed"),
			);
			queryClient.invalidateQueries({
				queryKey: queryKeys.locations.detail(locationId),
			});
		} else {
			toast.error(
				result.error ||
					t(
						"settings.locations.employeeRemoveFailed",
						"Failed to remove employee",
					),
			);
		}
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.locations.detail(locationId),
		});
		queryClient.invalidateQueries({
			queryKey: queryKeys.locations.list(organizationId),
		});
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
				<IconMapPin className="size-12 text-muted-foreground/50" />
				<p className="text-muted-foreground">
					{t("settings.locations.notFound", "Location not found")}
				</p>
				<Button asChild variant="outline">
					<Link href="/settings/locations">
						<IconArrowLeft className="mr-2 size-4" />
						{t("settings.locations.backToList", "Back to Locations")}
					</Link>
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<LocationDetailHeader
				canManageLocations={canManageLocations}
				isFetching={isFetching}
				location={location}
				onDelete={() => setDeleteLocationOpen(true)}
				onEdit={() => setEditLocationOpen(true)}
				onRefresh={() => refetch()}
			/>

			{/* Content Grid */}
			<div className="grid gap-4 lg:grid-cols-3">
				<LocationInfoCard location={location} />

				<LocationEmployeesCard
					canManageLocations={canManageLocations}
					location={location}
					onAdd={() => setAddEmployeeOpen(true)}
					onRemove={handleRemoveEmployee}
				/>

				<LocationSubareasCard
					canManageLocations={canManageLocations}
					location={location}
					onAdd={() => setAddSubareaOpen(true)}
					onAddEmployee={(subareaId, subareaName) =>
						setSubareaEmployeeDialog({ open: true, subareaId, subareaName })
					}
					onDelete={(subareaId) => setDeleteSubareaId(subareaId)}
					onEdit={setEditSubarea}
					onRemoveEmployee={handleRemoveSubareaEmployee}
				/>
			</div>

			{/* Edit Location Dialog */}
			{canManageLocations && (
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
			)}

			{canManageLocations && (
				<DeleteLocationDialog
					onConfirm={handleDeleteLocation}
					onOpenChange={setDeleteLocationOpen}
					open={deleteLocationOpen}
				/>
			)}

			{/* Add Employee Dialog */}
			{canManageLocations && (
				<LocationEmployeeDialog
					organizationId={organizationId}
					locationId={locationId}
					open={addEmployeeOpen}
					onOpenChange={setAddEmployeeOpen}
					onSuccess={handleSuccess}
				/>
			)}

			{/* Subarea Dialog (Create) */}
			{canManageLocations && (
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
			)}

			{/* Subarea Dialog (Edit) */}
			{canManageLocations && editSubarea && (
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

			{canManageLocations && (
				<DeleteSubareaDialog
					onConfirm={handleDeleteSubarea}
					onOpenChange={() => setDeleteSubareaId(null)}
					open={!!deleteSubareaId}
				/>
			)}

			{/* Subarea Employee Dialog */}
			{canManageLocations && subareaEmployeeDialog && (
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

function LocationInfoCard({ location }: { location: LocationWithDetails }) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconMapPin className="size-5" />
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
						<p>
							{[location.postalCode, location.city].filter(Boolean).join(" ")}
						</p>
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
	);
}

function LocationDetailHeader({
	canManageLocations,
	isFetching,
	location,
	onDelete,
	onEdit,
	onRefresh,
}: {
	canManageLocations: boolean;
	isFetching: boolean;
	location: LocationWithDetails;
	onDelete: () => void;
	onEdit: () => void;
	onRefresh: () => void;
}) {
	const { t } = useTranslate();
	const address = [
		location.street,
		location.postalCode,
		location.city,
		location.country,
	]
		.filter(Boolean)
		.join(", ");

	return (
		<div className="flex items-center justify-between">
			<div className="flex items-center gap-4">
				<Button asChild variant="ghost" size="icon">
					<Link href="/settings/locations">
						<IconArrowLeft className="size-4" />
					</Link>
				</Button>
				<div>
					<div className="flex items-center gap-2">
						<h1 className="text-2xl font-semibold tracking-tight">
							{location.name}
						</h1>
						<Badge variant={location.isActive ? "default" : "secondary"}>
							{location.isActive
								? t("common.active", "Active")
								: t("common.inactive", "Inactive")}
						</Badge>
					</div>
					{address && (
						<p className="text-sm text-muted-foreground">{address}</p>
					)}
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Button
					variant="ghost"
					size="icon"
					onClick={onRefresh}
					disabled={isFetching}
				>
					<IconRefresh
						className={`size-4 ${isFetching ? "animate-spin" : ""}`}
					/>
				</Button>
				{canManageLocations && (
					<>
						<Button variant="outline" onClick={onEdit}>
							<IconEdit className="mr-2 size-4" />
							{t("common.edit", "Edit")}
						</Button>
						<Button variant="destructive" onClick={onDelete}>
							<IconTrash className="mr-2 size-4" />
							{t("common.delete", "Delete")}
						</Button>
					</>
				)}
			</div>
		</div>
	);
}

function LocationEmployeesCard({
	canManageLocations,
	location,
	onAdd,
	onRemove,
}: {
	canManageLocations: boolean;
	location: LocationWithDetails;
	onAdd: () => void;
	onRemove: (assignmentId: string) => void;
}) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="flex items-center gap-2">
						<IconUsers className="size-5" />
						{t("settings.locations.supervisors", "Supervisors")}
					</CardTitle>
					{canManageLocations && (
						<Button size="sm" variant="outline" onClick={onAdd}>
							<IconPlus className="mr-2 size-4" />
							{t("common.add", "Add")}
						</Button>
					)}
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
									<div className="flex size-8 items-center justify-center rounded-full bg-muted">
										<IconUser className="size-4" />
									</div>
									<div>
										<div className="flex items-center gap-2">
											<p className="font-medium text-sm">
												{getEmployeeName(assignment.employee)}
											</p>
											{assignment.isPrimary && (
												<Badge variant="outline" className="text-xs">
													<IconStar className="mr-1 size-3" />
													{t("settings.locations.primary", "Primary")}
												</Badge>
											)}
										</div>
										<p className="text-xs text-muted-foreground">
											{assignment.employee.user.email}
										</p>
									</div>
								</div>
								{canManageLocations && (
									<Button
										variant="ghost"
										size="icon"
										onClick={() => onRemove(assignment.id)}
									>
										<IconTrash className="size-4" />
									</Button>
								)}
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function LocationSubareasCard({
	canManageLocations,
	location,
	onAdd,
	onAddEmployee,
	onDelete,
	onEdit,
	onRemoveEmployee,
}: {
	canManageLocations: boolean;
	location: LocationWithDetails;
	onAdd: () => void;
	onAddEmployee: (subareaId: string, subareaName: string) => void;
	onDelete: (subareaId: string) => void;
	onEdit: (subarea: SubareaWithEmployees) => void;
	onRemoveEmployee: (assignmentId: string) => void;
}) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>{t("settings.locations.subareas", "Subareas")}</CardTitle>
					{canManageLocations && (
						<Button size="sm" variant="outline" onClick={onAdd}>
							<IconPlus className="mr-2 size-4" />
							{t("common.add", "Add")}
						</Button>
					)}
				</div>
				<CardDescription>
					{t(
						"settings.locations.subareasDescription",
						"Areas within this location",
					)}
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
									{canManageLocations && (
										<div className="flex items-center gap-1">
											<Button
												variant="ghost"
												size="icon"
												onClick={() => onAddEmployee(subarea.id, subarea.name)}
											>
												<IconPlus className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => onEdit(subarea)}
											>
												<IconEdit className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => onDelete(subarea.id)}
											>
												<IconTrash className="size-4" />
											</Button>
										</div>
									)}
								</div>
								{subarea.employees.length > 0 && (
									<div className="border-t px-3 py-2 space-y-1">
										{subarea.employees.map((assignment) => (
											<div
												key={assignment.id}
												className="flex items-center justify-between text-sm"
											>
												<div className="flex items-center gap-2">
													<span>{getEmployeeName(assignment.employee)}</span>
													{assignment.isPrimary && (
														<IconStar className="size-3 text-yellow-500" />
													)}
												</div>
												{canManageLocations && (
													<Button
														variant="ghost"
														size="icon"
														className="size-6"
														onClick={() => onRemoveEmployee(assignment.id)}
													>
														<IconTrash className="size-3" />
													</Button>
												)}
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
	);
}

function DeleteLocationDialog({
	onConfirm,
	onOpenChange,
	open,
}: {
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const { t } = useTranslate();

	return (
		<DeleteConfirmationDialog
			description={t(
				"settings.locations.deleteDescription",
				"Are you sure you want to delete this location? This will also delete all subareas and employee assignments.",
			)}
			onConfirm={onConfirm}
			onOpenChange={onOpenChange}
			open={open}
			title={t("settings.locations.deleteTitle", "Delete Location")}
		/>
	);
}

function DeleteSubareaDialog({
	onConfirm,
	onOpenChange,
	open,
}: {
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const { t } = useTranslate();

	return (
		<DeleteConfirmationDialog
			description={t(
				"settings.locations.deleteSubareaDescription",
				"Are you sure you want to delete this subarea? This will also remove all employee assignments.",
			)}
			onConfirm={onConfirm}
			onOpenChange={onOpenChange}
			open={open}
			title={t("settings.locations.deleteSubareaTitle", "Delete Subarea")}
		/>
	);
}

function DeleteConfirmationDialog({
	description,
	onConfirm,
	onOpenChange,
	open,
	title,
}: {
	description: string;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: string;
}) {
	const { t } = useTranslate();

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>
						{t("common.delete", "Delete")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
