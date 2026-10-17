"use client";

import { IconPhoto } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { listVehiclePhotos } from "@/app/[locale]/(app)/settings/vehicles/photo-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import type { VehiclePhotoView } from "@/lib/organization/vehicles/vehicle-photo-types";
import type { OrganizationVehicleView } from "@/lib/organization/vehicles/vehicles";
import { VehiclePhotoBrowser } from "./vehicle-photo-browser";
import {
	useVehiclePhotoUploadQueue,
	VehiclePhotoUploadQueue,
} from "./vehicle-photo-upload-queue";

export function VehiclePhotosDialog({
	vehicle,
}: {
	vehicle: OrganizationVehicleView;
}) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					aria-label={t("settings.vehicles.photos.named", "Photos of {name}", {
						name: vehicle.name,
					})}
				>
					<IconPhoto className="size-4" aria-hidden="true" />
					{t("settings.vehicles.photos.action", "Photos")}
				</Button>
			</DialogTrigger>
			<VehiclePhotoGallery vehicle={vehicle} open={open} />
		</Dialog>
	);
}

function VehiclePhotoGallery({
	vehicle,
	open,
}: {
	vehicle: OrganizationVehicleView;
	open: boolean;
}) {
	const { t } = useTranslate();
	const [photos, setPhotos] = useState<VehiclePhotoView[]>([]);
	const changes = useRef(0);
	const [archived, setArchived] = useState(vehicle.archived);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const uploadQueue = useVehiclePhotoUploadQueue({
		vehicleId: vehicle.id,
		photos,
		disabled: loading || error === "load",
		onArchived: () => setArchived(true),
		onSaved: (photo) => {
			changes.current += 1;
			setPhotos((previous) =>
				[
					...previous.filter((existing) => existing.id !== photo.id),
					photo,
				].sort((left, right) => left.order - right.order),
			);
		},
	});

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		async function load() {
			await Promise.resolve();
			if (cancelled) return;
			setLoading(true);
			setError(null);
			try {
				const version = changes.current;
				const result = await listVehiclePhotos(vehicle.id);
				if (cancelled) return;
				if (result.success) {
					if (changes.current === version) setPhotos(result.data.photos);
					setArchived(result.data.archived);
				} else setError("load");
			} catch {
				if (!cancelled) setError("load");
			}
		}
		void load().finally(() => {
			if (!cancelled) setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [vehicle.id, open]);

	return (
		<DialogContent className="overscroll-contain sm:max-w-3xl">
			<DialogHeader>
				<DialogTitle>
					{t("settings.vehicles.photos.named", "Photos of {name}", {
						name: vehicle.name,
					})}
				</DialogTitle>
				<DialogDescription>
					{t(
						"settings.vehicles.photos.description",
						"Private reference photos for this vehicle. Completed uploads and removals save immediately.",
					)}
				</DialogDescription>
			</DialogHeader>
			{loading ? (
				<p role="status">
					{t("settings.vehicles.photos.loading", "Loading photos…")}
				</p>
			) : null}
			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error === "load"
						? t(
								"settings.vehicles.photos.loadFailed",
								"The photos could not be loaded. Close the dialog and try again.",
							)
						: error}
				</p>
			) : null}
			{!loading && !error && photos.length === 0 ? (
				<p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
					{t("settings.vehicles.photos.empty", "No photos yet.")}
				</p>
			) : null}
			{archived ? (
				<p className="rounded-lg border bg-muted p-3 text-muted-foreground text-sm">
					{t(
						"settings.vehicles.photos.archived",
						"This vehicle is archived. Restore it to add or remove photos.",
					)}
				</p>
			) : (
				<VehiclePhotoUploadQueue queue={uploadQueue} />
			)}
			<VehiclePhotoBrowser
				vehicle={vehicle}
				photos={photos}
				archived={archived}
				onRemoved={(id) => {
					changes.current += 1;
					setPhotos((current) => current.filter((photo) => photo.id !== id));
				}}
				onArchived={() => setArchived(true)}
			/>
		</DialogContent>
	);
}
