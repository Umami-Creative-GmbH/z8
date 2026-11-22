"use client";

import {
	IconArchive,
	IconArchiveOff,
	IconInfoCircle,
	IconLoader2,
	IconPencil,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	changeVehicles,
	type VehicleSettingsData,
} from "@/app/[locale]/(app)/settings/vehicles/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { keepAlertDialogOpen } from "@/components/settings/confirm-action-utils";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent } from "@/components/ui/card";
import { useServerDataState } from "@/hooks/use-server-data-state";
import type { VehicleChangeInput } from "@/lib/organization/vehicles/vehicle-rules";
import type { OrganizationVehicleView } from "@/lib/organization/vehicles/vehicles";
import {
	type ActionFailure,
	actionErrorMessage,
} from "@/lib/organization-action/action-error-message";
import { VehiclePanel } from "./vehicle-panel";
import { VehiclePhotosDialog } from "./vehicle-photos-dialog";
import { VEHICLE_REFUSALS } from "./vehicle-refusals";

interface VehicleSettingsProps {
	initialData: VehicleSettingsData;
}

/** A delete being confirmed; `used` once the server said the vehicle was recorded on work. */
type Deletion = { vehicle: OrganizationVehicleView; used: boolean } | null;

/** Org admin management of organization vehicles and their assigned drivers (#1118). */
export function VehicleSettings({ initialData }: VehicleSettingsProps) {
	const { t } = useTranslate();
	const [vehicles, setVehicles] = useServerDataState(initialData.vehicles);
	const [dialog, setDialog] = useState<{
		vehicle: OrganizationVehicleView | null;
	} | null>(null);
	const [deletion, setDeletion] = useState<Deletion>(null);
	const [pending, setPending] = useState(false);
	const [rowPending, setRowPending] = useState<string | null>(null);
	const [deletionError, setDeletionError] = useState<string | null>(null);
	const requestDeletion = (next: Deletion) => {
		setDeletionError(null);
		setDeletion(next);
	};

	/** Applies a change; resolves the failed result, or null when it was accepted. */
	async function apply(change: VehicleChangeInput) {
		const result = await changeVehicles(change);
		if (!result.success) return result;
		setVehicles(result.data);
		return null;
	}

	function refusalMessage(failure: ActionFailure) {
		return actionErrorMessage(t, failure, VEHICLE_REFUSALS, [
			"settings.vehicles.saveFailed",
			"The vehicle could not be saved.",
		]);
	}

	async function save(change: VehicleChangeInput): Promise<boolean> {
		const failure = await apply(change);
		if (failure === null) {
			toast.success(t("settings.vehicles.saved", "Vehicle saved"));
			return true;
		}
		toast.error(refusalMessage(failure));
		return false;
	}

	/** Archive/restore straight from a row: one change at a time, with the row's buttons busy. */
	async function saveRow(change: Extract<VehicleChangeInput, { kind: "archive" | "restore" }>) {
		if (rowPending !== null) return;
		setRowPending(change.vehicleId);
		await save(change).finally(() => setRowPending(null));
	}

	async function confirmDeletion() {
		if (!deletion) return;
		const { vehicle, used } = deletion;
		setPending(true);
		const run = async () => {
			const failure = await apply({
				kind: used ? "archive" : "delete",
				vehicleId: vehicle.id,
			});
			// A vehicle recorded on work can't be deleted: offer archiving instead.
			if (failure?.refusal === "vehicle_used") {
				setDeletion({ vehicle, used: true });
				return;
			}
			if (failure !== null) {
				// The dialog stays open with the reason so the change can be retried.
				setDeletionError(refusalMessage(failure));
				return;
			}
			toast.success(
				used
					? t("settings.vehicles.archived", "Vehicle archived")
					: t("settings.vehicles.deleted", "Vehicle deleted"),
			);
			setDeletion(null);
		};
		setDeletionError(null);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await run().finally(() => setPending(false));
	}

	const active = vehicles.filter((vehicle) => !vehicle.archived);
	const archived = vehicles.filter((vehicle) => vehicle.archived);

	return (
		<div className="space-y-6">
			<Alert>
				<IconInfoCircle className="size-4" aria-hidden="true" />
				<AlertTitle>{t("settings.vehicles.logbookNotice.title", "Not a tax logbook")}</AlertTitle>
				<AlertDescription>
					{t(
						"settings.vehicles.logbookNotice.description",
						"Z8 records which vehicle was driven during work and its odometer readings. It is not a tax-compliant logbook (Fahrtenbuch): readings can be corrected, and no trip purpose or business partner is recorded.",
					)}
				</AlertDescription>
			</Alert>

			<VehiclesListCard
				vehicleCount={vehicles.length}
				onOpen={setDialog}
				active={active}
				archived={archived}
				rowPending={rowPending}
				saveRow={saveRow}
				requestDeletion={requestDeletion}
			/>

			<VehiclePanel
				open={dialog !== null}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
				vehicle={dialog?.vehicle ?? null}
				employees={initialData.employees}
				teams={initialData.teams}
				onSave={save}
			/>

			<AlertDialog
				open={deletion !== null}
				onOpenChange={(open) => {
					if (!open && !pending) setDeletion(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{deletion?.used
								? t("settings.vehicles.usedTitle", "{name} was recorded on work", {
										name: deletion.vehicle.name,
									})
								: t("settings.vehicles.deleteTitle", "Delete {name}?", {
										name: deletion?.vehicle.name ?? "",
									})}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{deletion?.used
								? t(
										"settings.vehicles.usedDescription",
										"A vehicle recorded on work cannot be deleted. Archive it instead: it can no longer be picked but stays on the work it was recorded on.",
									)
								: t(
										"settings.vehicles.deleteDescription",
										"A vehicle can be deleted only while it was never recorded on work. Its assigned drivers are removed with it.",
									)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					{deletionError ? (
						<p role="alert" className="text-sm text-destructive">
							{deletionError}
						</p>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						{deletion?.used && deletion.vehicle.archived ? null : (
							<AlertDialogAction
								className={deletion?.used ? undefined : buttonVariants({ variant: "destructive" })}
								disabled={pending}
								onClick={(event) => {
									// Base UI's Close ignores preventDefault; stop its handler so the
									// dialog stays open until the deletion or archive settles.
									keepAlertDialogOpen(event);
									if (pending) return;
									void confirmDeletion();
								}}
							>
								{pending ? (
									<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
								) : null}
								{deletion?.used
									? t("settings.vehicles.archiveInstead", "Archive instead")
									: t("settings.vehicles.deleteConfirm", "Delete vehicle")}
							</AlertDialogAction>
						)}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function DeleteButton({
	vehicle,
	onDelete,
}: {
	vehicle: OrganizationVehicleView;
	onDelete: (deletion: Deletion) => void;
}) {
	const { t } = useTranslate();
	return (
		<Button
			variant="outline"
			size="sm"
			className="text-destructive hover:text-destructive"
			aria-label={t("settings.vehicles.deleteNamed", "Delete {name}", {
				name: vehicle.name,
			})}
			onClick={() => onDelete({ vehicle, used: false })}
		>
			<IconTrash className="size-4" aria-hidden="true" />
			{t("settings.vehicles.delete", "Delete")}
		</Button>
	);
}

function VehicleList({
	label,
	vehicles,
	actions,
}: {
	label: string;
	vehicles: OrganizationVehicleView[];
	actions: (vehicle: OrganizationVehicleView) => React.ReactNode;
}) {
	const { t } = useTranslate();
	return (
		<ul aria-label={label} className="divide-y rounded-lg border">
			{vehicles.map((vehicle) => {
				const drivers = [...vehicle.drivers.employees, ...vehicle.drivers.teams].map(
					(driver) => driver.name,
				);
				return (
					<li
						key={vehicle.id}
						className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
					>
						<div className="min-w-0 space-y-1">
							<p className="flex flex-wrap items-baseline gap-x-2">
								<span className="min-w-0 break-words font-medium text-sm">{vehicle.name}</span>
								<span className="font-mono text-muted-foreground text-xs">
									{vehicle.licencePlate}
								</span>
							</p>
							<p className="text-muted-foreground text-sm">
								{drivers.length === 0 ? (
									t("settings.vehicles.noDrivers", "No assigned drivers")
								) : (
									<>
										<span className="sr-only">
											{t("settings.vehicles.driversLabel", "Assigned drivers:")}{" "}
										</span>
										<span>{drivers.join(", ")}</span>
									</>
								)}
							</p>
						</div>
						<div className="flex flex-wrap gap-2">{actions(vehicle)}</div>
					</li>
				);
			})}
		</ul>
	);
}

function VehiclesListCard({
	vehicleCount,
	onOpen,
	active,
	archived,
	rowPending,
	saveRow,
	requestDeletion,
}: {
	vehicleCount: number;
	onOpen: (dialog: { vehicle: OrganizationVehicleView | null }) => void;
	active: OrganizationVehicleView[];
	archived: OrganizationVehicleView[];
	rowPending: string | null;
	saveRow: (change: Extract<VehicleChangeInput, { kind: "archive" | "restore" }>) => Promise<void>;
	requestDeletion: (next: Deletion) => void;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardContent className="space-y-6">
				{/* The page heading and tab already say "Vehicles": the toolbar carries the count. */}
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0 space-y-1">
						<p className="font-medium text-sm tabular-nums">
							{t("settings.vehicles.count", "{count, plural, one {# vehicle} other {# vehicles}}", {
								count: vehicleCount,
							})}
						</p>
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.vehicles.listDescription",
								"Archived vehicles can no longer be picked but stay on the work they were recorded on.",
							)}
						</p>
					</div>
					<Button onClick={() => onOpen({ vehicle: null })}>
						<IconPlus className="size-4" aria-hidden="true" />
						{t("settings.vehicles.add", "Add vehicle")}
					</Button>
				</div>
				{active.length === 0 ? (
					<p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
						{archived.length > 0
							? t(
									"settings.vehicles.noActive",
									"No active vehicles. Add a vehicle or restore an archived one.",
								)
							: t("settings.vehicles.empty", "No vehicles yet.")}
					</p>
				) : (
					<VehicleList
						label={t("settings.vehicles.activeList", "Active vehicles")}
						vehicles={active}
						actions={(vehicle) => (
							<>
								<Button
									variant="outline"
									size="sm"
									aria-label={t("settings.vehicles.editNamed", "Edit {name}", {
										name: vehicle.name,
									})}
									onClick={() => onOpen({ vehicle })}
								>
									<IconPencil className="size-4" aria-hidden="true" />
									{t("settings.vehicles.edit", "Edit")}
								</Button>
								<Button
									variant="outline"
									size="sm"
									aria-label={t("settings.vehicles.archiveNamed", "Archive {name}", {
										name: vehicle.name,
									})}
									disabled={rowPending !== null}
									onClick={() => void saveRow({ kind: "archive", vehicleId: vehicle.id })}
								>
									{rowPending === vehicle.id ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : (
										<IconArchive className="size-4" aria-hidden="true" />
									)}
									{t("settings.vehicles.archive", "Archive")}
								</Button>
								<VehiclePhotosDialog vehicle={vehicle} />
								<DeleteButton vehicle={vehicle} onDelete={requestDeletion} />
							</>
						)}
					/>
				)}
				{archived.length > 0 ? (
					<div className="space-y-2">
						<h3 className="font-medium text-sm">
							{t("settings.vehicles.archivedTitle", "Archived")}
						</h3>
						<VehicleList
							label={t("settings.vehicles.archivedList", "Archived vehicles")}
							vehicles={archived}
							actions={(vehicle) => (
								<>
									<Button
										variant="outline"
										size="sm"
										aria-label={t("settings.vehicles.restoreNamed", "Restore {name}", {
											name: vehicle.name,
										})}
										disabled={rowPending !== null}
										onClick={() => void saveRow({ kind: "restore", vehicleId: vehicle.id })}
									>
										{rowPending === vehicle.id ? (
											<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
										) : (
											<IconArchiveOff className="size-4" aria-hidden="true" />
										)}
										{t("settings.vehicles.restore", "Restore")}
									</Button>
									<VehiclePhotosDialog vehicle={vehicle} />
									<DeleteButton vehicle={vehicle} onDelete={requestDeletion} />
								</>
							)}
						/>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
