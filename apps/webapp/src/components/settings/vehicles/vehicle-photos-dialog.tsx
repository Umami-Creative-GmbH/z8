"use client";

import {
	IconChevronLeft,
	IconChevronRight,
	IconPhoto,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useId, useRef, useState } from "react";
import {
	initiateVehiclePhotoUpload,
	listVehiclePhotos,
} from "@/app/[locale]/(app)/settings/vehicles/photo-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	MAX_VEHICLE_PHOTO_BYTES,
	MAX_VEHICLE_PHOTOS,
	type VehiclePhotoView,
} from "@/lib/organization/vehicles/vehicle-photo-types";
import type { OrganizationVehicleView } from "@/lib/organization/vehicles/vehicles";

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
			{open ? <VehiclePhotoGallery vehicle={vehicle} /> : null}
		</Dialog>
	);
}

function VehiclePhotoGallery({
	vehicle,
}: {
	vehicle: OrganizationVehicleView;
}) {
	const { t } = useTranslate();
	const [photos, setPhotos] = useState<VehiclePhotoView[]>([]);
	const [archived, setArchived] = useState(vehicle.archived);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [uploading, setUploading] = useState<string | null>(null);
	const fileId = useId();

	useEffect(() => {
		let cancelled = false;
		async function load() {
			try {
				const result = await listVehiclePhotos(vehicle.id);
				if (cancelled) return;
				if (result.success) {
					setPhotos(result.data.photos);
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
	}, [vehicle.id]);

	function uploadError(reason?: string) {
		switch (reason) {
			case "heic_unsupported":
			case "unsupported_image":
			case "animated_image":
				return t(
					"settings.vehicles.photos.unsupported",
					"Choose a JPEG, PNG or WebP photo. HEIC and other formats are not supported.",
				);
			case "invalid_image":
				return t(
					"settings.vehicles.photos.invalid",
					"This image could not be read. Choose another JPEG, PNG or WebP photo.",
				);
			case "photo_too_large":
				return t(
					"settings.vehicles.photos.tooLarge",
					"Choose a photo no larger than 10 MB.",
				);
			case "vehicle_archived":
				return t(
					"settings.vehicles.photos.archived",
					"This vehicle is archived. Restore it to add or remove photos.",
				);
			case "photo_limit":
				return t(
					"settings.vehicles.photos.full",
					"This vehicle has 20 photos. Remove a photo before adding another.",
				);
			default:
				return t(
					"settings.vehicles.photos.uploadFailed",
					"The photo could not be uploaded. Select the file again to try again.",
				);
		}
	}
	async function upload(file: File) {
		setError(null);
		if (archived || photos.length >= MAX_VEHICLE_PHOTOS) return;
		if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
			setError(
				t(
					"settings.vehicles.photos.unsupported",
					"Choose a JPEG, PNG or WebP photo. HEIC and other formats are not supported.",
				),
			);
			return;
		}
		if (file.size > MAX_VEHICLE_PHOTO_BYTES) {
			setError(
				t(
					"settings.vehicles.photos.tooLarge",
					"Choose a photo no larger than 10 MB.",
				),
			);
			return;
		}
		setUploading(file.name);
		try {
			const started = await initiateVehiclePhotoUpload(vehicle.id);
			if (!started.success || !started.data.ok) {
				setError(
					`${file.name}: ${uploadError(started.success && !started.data.ok ? started.data.reason : undefined)}`,
				);
				if (
					started.success &&
					!started.data.ok &&
					started.data.reason === "vehicle_archived"
				)
					setArchived(true);
				return;
			}
			const response = await fetch(
				`/api/organization/vehicles/${encodeURIComponent(vehicle.id)}/photos/${encodeURIComponent(started.data.uploadId)}`,
				{ method: "POST", body: file, headers: { "Content-Type": file.type } },
			);
			if (!response.ok) {
				const failure: { reason?: string } = await response.json();
				setError(`${file.name}: ${uploadError(failure.reason)}`);
				if (failure.reason === "vehicle_archived") setArchived(true);
				return;
			}
			const result:
				| { ok: true; photo: VehiclePhotoView }
				| { ok: false; reason?: string } = await response.json();
			if (!result.ok) {
				setError(`${file.name}: ${uploadError(result.reason)}`);
				return;
			}
			setPhotos((previousPhotos) =>
				[...previousPhotos, result.photo].sort(
					(left, right) => left.order - right.order,
				),
			);
		} catch {
			setError(`${file.name}: ${uploadError()}`);
		}
	}

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
						"Private reference photos for this vehicle. Completed uploads save immediately.",
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
				<div className="space-y-2">
					<label htmlFor={fileId} className="font-medium text-sm">
						{t("settings.vehicles.photos.add", "Add photo")}
					</label>
					<Input
						id={fileId}
						type="file"
						name="vehicle-photo"
						accept="image/jpeg,image/png,image/webp"
						disabled={
							loading ||
							error === "load" ||
							uploading !== null ||
							photos.length >= MAX_VEHICLE_PHOTOS
						}
						aria-describedby={`${fileId}-help`}
						onChange={(event) => {
							const file = event.currentTarget.files?.[0];
							event.currentTarget.value = "";
							if (file) void upload(file).finally(() => setUploading(null));
						}}
					/>
					{photos.length >= MAX_VEHICLE_PHOTOS ? (
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.vehicles.photos.full",
								"This vehicle has 20 photos. Remove a photo before adding another.",
							)}
						</p>
					) : null}
					<p id={`${fileId}-help`} className="text-muted-foreground text-sm">
						{t(
							"settings.vehicles.photos.limits",
							"JPEG, PNG or WebP. Up to 10 MB per photo, 20 photos per vehicle.",
						)}
					</p>
					{uploading ? (
						<p role="status" className="text-sm">
							{t("settings.vehicles.photos.uploading", "Uploading {name}…", {
								name: uploading,
							})}
						</p>
					) : null}
				</div>
			)}
			<VehiclePhotoBrowser vehicle={vehicle} photos={photos} />
		</DialogContent>
	);
}

function VehiclePhotoBrowser({
	vehicle,
	photos,
}: {
	vehicle: OrganizationVehicleView;
	photos: VehiclePhotoView[];
}) {
	const { t } = useTranslate();
	const [selected, setSelected] = useState<number | null>(null);
	const thumbnail = useRef<HTMLButtonElement | null>(null);
	const current = selected === null ? null : photos[selected];
	function previous() {
		setSelected((index) => (index === null ? null : Math.max(0, index - 1)));
	}
	function next() {
		setSelected((index) =>
			index === null ? null : Math.min(photos.length - 1, index + 1),
		);
	}

	return (
		<Dialog
			open={selected !== null}
			onOpenChange={(open) => {
				if (!open) setSelected(null);
			}}
		>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
				{photos.map((photo, index) => (
					<button
						key={photo.id}
						type="button"
						className="overflow-hidden rounded-lg border bg-muted transition-colors hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
						aria-label={t(
							"settings.vehicles.photos.viewNamed",
							"View photo {number} of {name}",
							{
								number: index + 1,
								name: vehicle.name,
							},
						)}
						onClick={(event) => {
							thumbnail.current = event.currentTarget;
							setSelected(index);
						}}
					>
						<img
							src={photo.imageUrl}
							alt={t(
								"settings.vehicles.photos.imageNamed",
								"{name}, photo {number}",
								{
									name: vehicle.name,
									number: index + 1,
								},
							)}
							width={photo.width}
							height={photo.height}
							loading="lazy"
							className="aspect-[4/3] w-full object-contain"
						/>
					</button>
				))}
			</div>
			{current ? (
				<DialogContent
					className="overscroll-contain sm:max-w-5xl"
					finalFocus={thumbnail}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft") {
							event.preventDefault();
							previous();
						}
						if (event.key === "ArrowRight") {
							event.preventDefault();
							next();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{t(
								"settings.vehicles.photos.position",
								"Photo {number} of {count}",
								{
									number: (selected ?? 0) + 1,
									count: photos.length,
								},
							)}
						</DialogTitle>
						<DialogDescription>
							{vehicle.name} · {vehicle.licencePlate}
						</DialogDescription>
					</DialogHeader>
					<img
						src={current.imageUrl}
						alt={t(
							"settings.vehicles.photos.imageNamed",
							"{name}, photo {number}",
							{
								name: vehicle.name,
								number: (selected ?? 0) + 1,
							},
						)}
						width={current.width}
						height={current.height}
						className="max-h-[65dvh] w-full object-contain"
					/>
					<div className="flex justify-between gap-3">
						<Button
							variant="outline"
							onClick={previous}
							disabled={selected === 0}
						>
							<IconChevronLeft aria-hidden="true" />
							{t("settings.vehicles.photos.previous", "Previous photo")}
						</Button>
						<Button
							variant="outline"
							onClick={next}
							disabled={selected === photos.length - 1}
						>
							{t("settings.vehicles.photos.next", "Next photo")}
							<IconChevronRight aria-hidden="true" />
						</Button>
					</div>
				</DialogContent>
			) : null}
		</Dialog>
	);
}
