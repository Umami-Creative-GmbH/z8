"use client";

import {
	IconAlertTriangle,
	IconArrowLeft,
	IconEdit,
	IconLoader2,
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
	type LocationEmployeeData,
	type LocationWithDetails,
	type SubareaWithEmployees,
} from "@/app/[locale]/(app)/settings/locations/actions";
import {
	assignLocationEmployee,
	assignSubareaEmployee,
	removeLocationEmployee,
	removeSubareaEmployee,
} from "@/app/[locale]/(app)/settings/locations/assignment-actions";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationDetailSkeleton } from "./location-detail-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import type { ServerActionResult } from "@/lib/effect/result";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/navigation";
import { LocationAssignedEmployeesCard } from "./assigned-locations/location-assigned-employees-card";
import { LocationDialog } from "./location-dialog";
import { LocationEmployeeDialog } from "./location-employee-dialog";
import { SubareaDialog } from "./subarea-dialog";
import { SubareaEmployeeDialog } from "./subarea-employee-dialog";

interface LocationDetailProps {
	locationId: string;
	organizationId: string;
	canManageLocations: boolean;
}

function getEmployeeName(emp: LocationWithDetails["employees"][number]["employee"]) {
	if (emp.firstName || emp.lastName) {
		return `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
	}
	return emp.user.name || emp.user.email;
}

function useLocationDetail({ locationId, organizationId }: LocationDetailProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();

	// Dialog states
	const [editLocationOpen, setEditLocationOpen] = useState(false);
	const [deleteLocationOpen, setDeleteLocationOpen] = useState(false);
	const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
	const [addSubareaOpen, setAddSubareaOpen] = useState(false);
	const [editSubarea, setEditSubarea] = useState<SubareaWithEmployees | null>(null);
	const [subareaToDelete, setSubareaToDelete] = useState<{ id: string; name: string } | null>(null);
	const [deletingLocation, setDeletingLocation] = useState(false);
	const [deletingSubarea, setDeletingSubarea] = useState(false);
	const [removingAssignmentId, setRemovingAssignmentId] = useState<string | null>(null);
	const [subareaEmployeeDialog, setSubareaEmployeeDialog] = useState<{
		open: boolean;
		subareaId: string;
		subareaName: string;
	} | null>(null);

	const {
		data: locationResult,
		isLoading,
		isError,
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

	// Promise#finally rather than try/finally: the React Compiler cannot
	// compile try statements without a catch clause.
	const handleDeleteLocation = async () => {
		setDeletingLocation(true);
		const run = async () => {
			const result = await deleteLocation(locationId);
			if (result.success) {
				toast.success(t("settings.locations.deleted", "Location deleted"));
				setDeleteLocationOpen(false);
				router.push("/settings/locations");
			} else {
				// Keep the confirmation open so the admin can retry or cancel.
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.locations.deleteFailed",
						"Failed to delete location",
					]),
				);
			}
		};
		await run().finally(() => setDeletingLocation(false));
	};

	const refreshDetail = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.locations.detail(locationId),
		});

	// Undo re-creates the removed assignment through the regular add action, with
	// its original primary flag; the server re-checks access and the roster.
	const restoreAssignment = async (
		restore: () => Promise<ServerActionResult<unknown>>,
		name: string,
	) => {
		const result = await restore().then(
			(response) => response,
			() => null,
		);
		if (result?.success) {
			toast.success(
				t("settings.locations.assignmentRestored", "Restored {name}", {
					name,
				}),
			);
		} else {
			toast.error(
				actionErrorMessage(t, result, {}, [
					"settings.locations.assignmentRestoreFailed",
					"The assignment could not be restored",
				]),
			);
		}
		await refreshDetail();
	};

	const handleRemoveEmployee = async (assignment: LocationEmployeeData) => {
		setRemovingAssignmentId(assignment.id);
		const run = async () => {
			const result = await removeLocationEmployee(assignment.id);
			if (result.success) {
				const name = getEmployeeName(assignment.employee);
				toast.success(
					t("settings.locations.assignmentRemovedFrom", "Removed {name} from {place}", {
						name,
						place: location?.name ?? "",
					}),
					{
						action: {
							label: t("common.undo", "Undo"),
							onClick: () =>
								void restoreAssignment(
									() =>
										assignLocationEmployee({
											locationId,
											employeeId: assignment.employeeId,
											isPrimary: assignment.isPrimary,
										}),
									name,
								),
						},
					},
				);
				await refreshDetail();
			} else {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.locations.employeeRemoveFailed",
						"Failed to remove employee",
					]),
				);
			}
		};
		await run().finally(() => setRemovingAssignmentId(null));
	};

	const handleDeleteSubarea = async () => {
		if (!subareaToDelete) return;
		const subareaId = subareaToDelete.id;
		setDeletingSubarea(true);
		const run = async () => {
			const result = await deleteSubarea(subareaId);
			if (result.success) {
				toast.success(t("settings.locations.subareaDeleted", "Subarea deleted"));
				setSubareaToDelete(null);
				queryClient.invalidateQueries({
					queryKey: queryKeys.locations.detail(locationId),
				});
			} else {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.locations.subareaDeleteFailed",
						"Failed to delete subarea",
					]),
				);
			}
		};
		await run().finally(() => setDeletingSubarea(false));
	};

	const handleRemoveSubareaEmployee = async (
		subarea: SubareaWithEmployees,
		assignment: LocationEmployeeData,
	) => {
		setRemovingAssignmentId(assignment.id);
		const run = async () => {
			const result = await removeSubareaEmployee(assignment.id);
			if (result.success) {
				const name = getEmployeeName(assignment.employee);
				toast.success(
					t("settings.locations.assignmentRemovedFrom", "Removed {name} from {place}", {
						name,
						place: subarea.name,
					}),
					{
						action: {
							label: t("common.undo", "Undo"),
							onClick: () =>
								void restoreAssignment(
									() =>
										assignSubareaEmployee({
											subareaId: subarea.id,
											employeeId: assignment.employeeId,
											isPrimary: assignment.isPrimary,
										}),
									name,
								),
						},
					},
				);
				await refreshDetail();
			} else {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.locations.employeeRemoveFailed",
						"Failed to remove employee",
					]),
				);
			}
		};
		await run().finally(() => setRemovingAssignmentId(null));
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.locations.detail(locationId),
		});
		queryClient.invalidateQueries({
			queryKey: queryKeys.locations.list(organizationId),
		});
	};
	return {
		t,
		editLocationOpen,
		setEditLocationOpen,
		deleteLocationOpen,
		setDeleteLocationOpen,
		addEmployeeOpen,
		setAddEmployeeOpen,
		addSubareaOpen,
		setAddSubareaOpen,
		editSubarea,
		setEditSubarea,
		subareaToDelete,
		setSubareaToDelete,
		deletingLocation,
		deletingSubarea,
		removingAssignmentId,
		subareaEmployeeDialog,
		setSubareaEmployeeDialog,
		isLoading,
		isError,
		isFetching,
		refetch,
		location,
		handleDeleteLocation,
		handleRemoveEmployee,
		handleDeleteSubarea,
		handleRemoveSubareaEmployee,
		handleSuccess,
	};
}

export function LocationDetail(props: LocationDetailProps) {
	const { locationId, canManageLocations } = props;
	const {
		t,
		editLocationOpen,
		setEditLocationOpen,
		deleteLocationOpen,
		setDeleteLocationOpen,
		addEmployeeOpen,
		setAddEmployeeOpen,
		addSubareaOpen,
		setAddSubareaOpen,
		editSubarea,
		setEditSubarea,
		subareaToDelete,
		setSubareaToDelete,
		deletingLocation,
		deletingSubarea,
		removingAssignmentId,
		subareaEmployeeDialog,
		setSubareaEmployeeDialog,
		isLoading,
		isError,
		isFetching,
		refetch,
		location,
		handleDeleteLocation,
		handleRemoveEmployee,
		handleDeleteSubarea,
		handleRemoveSubareaEmployee,
		handleSuccess,
	} = useLocationDetail(props);

	if (isLoading) {
		return <LocationDetailSkeleton />;
	}

	if (!location) {
		return (
			<div className="page-frame">
				<div className="page-measure space-y-4">
					{isError ? (
						<Alert variant="destructive">
							<IconAlertTriangle aria-hidden="true" />
							<AlertTitle>
								{t("settings.locations.detailLoadFailed", "This location could not be loaded")}
							</AlertTitle>
							<AlertDescription className="gap-3">
								<p>
									{t(
										"settings.locations.detailLoadFailedDescription",
										"It may have been deleted, or the connection failed. Try again or go back to the location list.",
									)}
								</p>
								<div className="flex flex-wrap gap-2">
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
									<Button asChild variant="ghost" size="sm">
										<Link href="/settings/locations">
											<IconArrowLeft className="size-4" aria-hidden="true" />
											{t("settings.locations.backToList", "Back to Locations")}
										</Link>
									</Button>
								</div>
							</AlertDescription>
						</Alert>
					) : (
						<div className="flex flex-col items-start gap-4 rounded-lg border border-dashed p-6">
							<p className="text-muted-foreground">
								{t("settings.locations.notFound", "Location not found")}
							</p>
							<Button asChild variant="outline">
								<Link href="/settings/locations">
									<IconArrowLeft className="size-4" aria-hidden="true" />
									{t("settings.locations.backToList", "Back to Locations")}
								</Link>
							</Button>
						</div>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="page-frame flex flex-1 flex-col gap-6">
			<LocationDetailHeader
				canManageLocations={canManageLocations}
				location={location}
				onDelete={() => setDeleteLocationOpen(true)}
				onEdit={() => setEditLocationOpen(true)}
			/>

			{/* Content Grid */}
			<div className="grid items-start gap-4 lg:grid-cols-2">
				<LocationInfoCard location={location} />

				<LocationEmployeesCard
					canManageLocations={canManageLocations}
					location={location}
					onAdd={() => setAddEmployeeOpen(true)}
					onRemove={handleRemoveEmployee}
					removingAssignmentId={removingAssignmentId}
				/>

				{canManageLocations && <LocationAssignedEmployeesCard locationId={locationId} />}

				<LocationSubareasCard
					canManageLocations={canManageLocations}
					location={location}
					onAdd={() => setAddSubareaOpen(true)}
					onAddEmployee={(subareaId, subareaName) =>
						setSubareaEmployeeDialog({ open: true, subareaId, subareaName })
					}
					onDelete={(subarea) => setSubareaToDelete({ id: subarea.id, name: subarea.name })}
					onEdit={setEditSubarea}
					onRemoveEmployee={handleRemoveSubareaEmployee}
					removingAssignmentId={removingAssignmentId}
				/>
			</div>

			{canManageLocations && (
				<>
					{/* Edit Location Dialog */}
					<LocationDialog
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

					<DeleteLocationDialog
						locationName={location.name}
						onConfirm={() => void handleDeleteLocation()}
						onOpenChange={(open) => {
							if (!deletingLocation) setDeleteLocationOpen(open);
						}}
						open={deleteLocationOpen}
						pending={deletingLocation}
					/>

					{/* Add Employee Dialog */}
					<LocationEmployeeDialog
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

					<DeleteSubareaDialog
						subareaName={subareaToDelete?.name ?? ""}
						onConfirm={() => void handleDeleteSubarea()}
						onOpenChange={(open) => {
							if (!open && !deletingSubarea) setSubareaToDelete(null);
						}}
						open={subareaToDelete !== null}
						pending={deletingSubarea}
					/>

					{/* Subarea Employee Dialog */}
					{subareaEmployeeDialog && (
						<SubareaEmployeeDialog
							subareaId={subareaEmployeeDialog.subareaId}
							subareaName={subareaEmployeeDialog.subareaName}
							open={subareaEmployeeDialog.open}
							onOpenChange={(open) => !open && setSubareaEmployeeDialog(null)}
							onSuccess={handleSuccess}
						/>
					)}
				</>
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
					<IconMapPin className="size-5" aria-hidden="true" />
					{t("settings.locations.details", "Location Details")}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div>
					<p className="text-sm font-medium text-muted-foreground">
						{t("settings.locations.field.name", "Name")}
					</p>
					<p className="break-words">{location.name}</p>
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
	);
}

function LocationDetailHeader({
	canManageLocations,
	location,
	onDelete,
	onEdit,
}: {
	canManageLocations: boolean;
	location: LocationWithDetails;
	onDelete: () => void;
	onEdit: () => void;
}) {
	const { t } = useTranslate();
	const address = [location.street, location.postalCode, location.city, location.country]
		.filter(Boolean)
		.join(", ");

	return (
		<PageHeader
			scope={
				<Link
					href="/settings/locations"
					className="inline-flex items-center gap-1 rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<IconArrowLeft className="size-4" aria-hidden="true" />
					{t("settings.locations.backToList", "Back to Locations")}
				</Link>
			}
			title={location.name}
			description={
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={location.isActive ? "default" : "secondary"}>
						{location.isActive ? t("common.active", "Active") : t("common.inactive", "Inactive")}
					</Badge>
					{address ? <span className="min-w-0 break-words">{address}</span> : null}
				</div>
			}
			actions={
				canManageLocations ? (
					<>
						<Button variant="outline" onClick={onEdit}>
							<IconEdit className="size-4" aria-hidden="true" />
							{t("settings.locations.dialog.editTitle", "Edit Location")}
						</Button>
						<Button variant="destructive" onClick={onDelete}>
							<IconTrash className="size-4" aria-hidden="true" />
							{t("settings.locations.deleteTitle", "Delete Location")}
						</Button>
					</>
				) : undefined
			}
		/>
	);
}

function LocationEmployeesCard({
	canManageLocations,
	location,
	onAdd,
	onRemove,
	removingAssignmentId,
}: {
	canManageLocations: boolean;
	location: LocationWithDetails;
	onAdd: () => void;
	onRemove: (assignment: LocationEmployeeData) => void;
	removingAssignmentId: string | null;
}) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle className="flex items-center gap-2">
						<IconUsers className="size-5" aria-hidden="true" />
						{t("settings.locations.supervisors", "Supervisors")}
					</CardTitle>
					{canManageLocations && (
						<Button size="sm" variant="outline" onClick={onAdd}>
							<IconPlus className="size-4" aria-hidden="true" />
							{t("common.add", "Add")}
						</Button>
					)}
				</div>
				<CardDescription>
					{t("settings.locations.supervisorsDescription", "Employees assigned to this location")}
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
								className="flex items-center justify-between gap-2 rounded-lg border p-3"
							>
								<div className="flex min-w-0 items-center gap-3">
									<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
										<IconUser className="size-4" aria-hidden="true" />
									</div>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<p
												className="min-w-0 max-w-full truncate font-medium text-sm"
												title={getEmployeeName(assignment.employee)}
											>
												{getEmployeeName(assignment.employee)}
											</p>
											{assignment.isPrimary && (
												<Badge variant="outline" className="text-xs">
													<IconStar className="mr-1 size-3" aria-hidden="true" />
													{t("settings.locations.primary", "Primary")}
												</Badge>
											)}
										</div>
										<p
											className="truncate text-xs text-muted-foreground"
											title={assignment.employee.user.email}
										>
											{assignment.employee.user.email}
										</p>
									</div>
								</div>
								{canManageLocations && (
									<Button
										variant="ghost"
										size="icon"
										className="shrink-0"
										onClick={() => onRemove(assignment)}
										disabled={removingAssignmentId !== null}
										aria-label={`${t("common.remove", "Remove")}: ${getEmployeeName(assignment.employee)}`}
									>
										{removingAssignmentId === assignment.id ? (
											<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
										) : (
											<IconTrash className="size-4" aria-hidden="true" />
										)}
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
	removingAssignmentId,
}: {
	canManageLocations: boolean;
	location: LocationWithDetails;
	onAdd: () => void;
	onAddEmployee: (subareaId: string, subareaName: string) => void;
	onDelete: (subarea: SubareaWithEmployees) => void;
	onEdit: (subarea: SubareaWithEmployees) => void;
	onRemoveEmployee: (subarea: SubareaWithEmployees, assignment: LocationEmployeeData) => void;
	removingAssignmentId: string | null;
}) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle>{t("settings.locations.subareas", "Subareas")}</CardTitle>
					{canManageLocations && (
						<Button size="sm" variant="outline" onClick={onAdd}>
							<IconPlus className="size-4" aria-hidden="true" />
							{t("common.add", "Add")}
						</Button>
					)}
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
								<div className="flex items-center justify-between gap-2 p-3">
									<div className="flex min-w-0 flex-wrap items-center gap-2">
										<span className="min-w-0 max-w-full truncate font-medium" title={subarea.name}>
											{subarea.name}
										</span>
										{!subarea.isActive && (
											<Badge variant="secondary" className="text-xs">
												{t("common.inactive", "Inactive")}
											</Badge>
										)}
									</div>
									{canManageLocations && (
										<div className="flex shrink-0 items-center gap-1">
											<Button
												variant="ghost"
												size="icon"
												onClick={() => onAddEmployee(subarea.id, subarea.name)}
												aria-label={`${t("common.add", "Add")}: ${t("settings.locations.supervisors", "Supervisors")} (${subarea.name})`}
												title={t("settings.locations.supervisors", "Supervisors")}
											>
												<IconPlus className="size-4" aria-hidden="true" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => onEdit(subarea)}
												aria-label={`${t("common.edit", "Edit")}: ${subarea.name}`}
												title={t("common.edit", "Edit")}
											>
												<IconEdit className="size-4" aria-hidden="true" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => onDelete(subarea)}
												aria-label={`${t("common.delete", "Delete")}: ${subarea.name}`}
												title={t("common.delete", "Delete")}
											>
												<IconTrash className="size-4" aria-hidden="true" />
											</Button>
										</div>
									)}
								</div>
								{subarea.employees.length > 0 && (
									<div className="border-t px-3 py-2 space-y-1">
										{subarea.employees.map((assignment) => (
											<div
												key={assignment.id}
												className="flex items-center justify-between gap-2 text-sm"
											>
												<div className="flex min-w-0 items-center gap-2">
													<span className="truncate" title={getEmployeeName(assignment.employee)}>
														{getEmployeeName(assignment.employee)}
													</span>
													{assignment.isPrimary && (
														<Badge variant="outline" className="shrink-0 text-xs">
															<IconStar className="mr-1 size-3" aria-hidden="true" />
															{t("settings.locations.primary", "Primary")}
														</Badge>
													)}
												</div>
												{canManageLocations && (
													<Button
														variant="ghost"
														size="icon"
														className="size-6 shrink-0"
														onClick={() => onRemoveEmployee(subarea, assignment)}
														disabled={removingAssignmentId !== null}
														aria-label={`${t("common.remove", "Remove")}: ${getEmployeeName(assignment.employee)}`}
													>
														{removingAssignmentId === assignment.id ? (
															<IconLoader2 className="size-3 animate-spin" aria-hidden="true" />
														) : (
															<IconTrash className="size-3" aria-hidden="true" />
														)}
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
	locationName,
	onConfirm,
	onOpenChange,
	open,
	pending,
}: {
	locationName: string;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	pending: boolean;
}) {
	const { t } = useTranslate();

	return (
		<DeleteConfirmationDialog
			confirmLabel={t("settings.locations.deleteTitle", "Delete Location")}
			description={t(
				"settings.locations.deleteDescription",
				"Are you sure you want to delete this location? This will also delete all subareas and employee assignments.",
			)}
			onConfirm={onConfirm}
			onOpenChange={onOpenChange}
			open={open}
			pending={pending}
			title={t("settings.locations.deleteNamedTitle", "Delete location {name}?", {
				name: locationName,
			})}
		/>
	);
}

function DeleteSubareaDialog({
	subareaName,
	onConfirm,
	onOpenChange,
	open,
	pending,
}: {
	subareaName: string;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	pending: boolean;
}) {
	const { t } = useTranslate();

	return (
		<DeleteConfirmationDialog
			confirmLabel={t("settings.locations.deleteSubareaTitle", "Delete Subarea")}
			description={t(
				"settings.locations.deleteSubareaDescription",
				"Are you sure you want to delete this subarea? This will also remove all employee assignments.",
			)}
			onConfirm={onConfirm}
			onOpenChange={onOpenChange}
			open={open}
			pending={pending}
			title={t("settings.locations.deleteSubareaNamedTitle", "Delete subarea {name}?", {
				name: subareaName,
			})}
		/>
	);
}

function DeleteConfirmationDialog({
	confirmLabel,
	description,
	onConfirm,
	onOpenChange,
	open,
	pending,
	title,
}: {
	confirmLabel: string;
	description: string;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	pending: boolean;
	title: string;
}) {
	// Stays open until the deletion settles, so failures can be retried.
	return (
		<ConfirmActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			description={description}
			confirmLabel={confirmLabel}
			isPending={pending}
			onConfirm={onConfirm}
		/>
	);
}
