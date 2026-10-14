"use client";

import {
	IconArchive,
	IconArchiveOff,
	IconCar,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { VehicleChangeInput } from "@/lib/organization/vehicles/vehicle-rules";
import type { OrganizationVehicleView } from "@/lib/organization/vehicles/vehicles";
import { VehicleDialog } from "./vehicle-dialog";
import { vehicleRefusalMessage } from "./vehicle-refusal-message";

interface VehicleSettingsProps {
	initialData: VehicleSettingsData;
}

/** A delete being confirmed; `used` once the server said the vehicle was recorded on work. */
type Deletion = { vehicle: OrganizationVehicleView; used: boolean } | null;

/** Org admin management of organization vehicles and their assigned drivers (#1118). */
export function VehicleSettings({ initialData }: VehicleSettingsProps) {
	const { t } = useTranslate();
	const [vehicles, setVehicles] = useState(initialData.vehicles);
	const [dialog, setDialog] = useState<{ vehicle: OrganizationVehicleView | null } | null>(null);
	const [deletion, setDeletion] = useState<Deletion>(null);
	const [pending, setPending] = useState(false);

	/** Applies a change; resolves the refusal reason, or null when it was accepted. */
	async function apply(change: VehicleChangeInput) {
		const result = await changeVehicles(change);
		if (!result.success) {
			toast.error(t("settings.vehicles.saveFailed", "The vehicle could not be saved."));
			return "failed" as const;
		}
		if (!result.data.ok) return result.data.reason;
		setVehicles(result.data.vehicles);
		return null;
	}

	async function save(change: VehicleChangeInput): Promise<boolean> {
		const refusal = await apply(change);
		if (refusal === null) {
			toast.success(t("settings.vehicles.saved", "Vehicle saved"));
			return true;
		}
		if (refusal !== "failed") toast.error(vehicleRefusalMessage(t, refusal));
		return false;
	}

	async function confirmDeletion() {
		if (!deletion) return;
		const { vehicle, used } = deletion;
		setPending(true);
		const run = async () => {
			const refusal = await apply({ kind: used ? "archive" : "delete", vehicleId: vehicle.id });
			if (refusal === "vehicle_used") {
				setDeletion({ vehicle, used: true });
				return;
			}
			if (refusal === null) {
				toast.success(
					used
						? t("settings.vehicles.archived", "Vehicle archived")
						: t("settings.vehicles.deleted", "Vehicle deleted"),
				);
			} else if (refusal !== "failed") {
				toast.error(vehicleRefusalMessage(t, refusal));
			}
			setDeletion(null);
		};
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

			<Card>
				<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
					<div className="space-y-1.5">
						<CardTitle className="flex items-center gap-2">
							<IconCar className="size-5" aria-hidden="true" />
							{t("settings.vehicles.listTitle", "Vehicles")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.vehicles.listDescription",
								"Archived vehicles can no longer be picked but stay on the work they were recorded on.",
							)}
						</CardDescription>
					</div>
					<Button onClick={() => setDialog({ vehicle: null })}>
						<IconPlus className="size-4" aria-hidden="true" />
						{t("settings.vehicles.add", "Add vehicle")}
					</Button>
				</CardHeader>
				<CardContent className="space-y-6">
					{active.length === 0 ? (
						<p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
							{t("settings.vehicles.empty", "No vehicles yet.")}
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
										onClick={() => setDialog({ vehicle })}
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
										onClick={() => void save({ kind: "archive", vehicleId: vehicle.id })}
									>
										<IconArchive className="size-4" aria-hidden="true" />
										{t("settings.vehicles.archive", "Archive")}
									</Button>
									<DeleteButton vehicle={vehicle} onDelete={setDeletion} />
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
											onClick={() => void save({ kind: "restore", vehicleId: vehicle.id })}
										>
											<IconArchiveOff className="size-4" aria-hidden="true" />
											{t("settings.vehicles.restore", "Restore")}
										</Button>
										<DeleteButton vehicle={vehicle} onDelete={setDeletion} />
									</>
								)}
							/>
						</div>
					) : null}
				</CardContent>
			</Card>

			<VehicleDialog
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
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						{deletion?.used && deletion.vehicle.archived ? null : (
							<AlertDialogAction
								disabled={pending}
								onClick={(event) => {
									event.preventDefault();
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
			aria-label={t("settings.vehicles.deleteNamed", "Delete {name}", { name: vehicle.name })}
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
								<span className="font-medium text-sm">{vehicle.name}</span>
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
