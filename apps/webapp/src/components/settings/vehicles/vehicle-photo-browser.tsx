"use client";
import {
	IconChevronLeft,
	IconChevronRight,
	IconTrash,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { startTransition, useRef, useState } from "react";
import { removeVehiclePhoto } from "@/app/[locale]/(app)/settings/vehicles/photo-actions";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { VehiclePhotoView } from "@/lib/organization/vehicles/vehicle-photo-types";
import type { OrganizationVehicleView } from "@/lib/organization/vehicles/vehicles";
export function VehiclePhotoBrowser({
	vehicle,
	photos,
	archived,
	onRemoved,
	onArchived,
}: {
	vehicle: OrganizationVehicleView;
	photos: VehiclePhotoView[];
	archived: boolean;
	onRemoved: (id: string) => void;
	onArchived: () => void;
}) {
	const { t } = useTranslate();
	const [selected, setSelected] = useState<string | null>(null);
	const [confirming, setConfirming] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const viewerTitle = useRef<HTMLHeadingElement | null>(null);
	const gallery = useRef<HTMLFieldSetElement | null>(null);
	const removeButton = useRef<HTMLButtonElement | null>(null);
	const index = photos.findIndex((photo) => photo.id === selected);
	const thumbnail = useRef<HTMLButtonElement | null>(null);
	const current = photos[index] ?? null;
	function previous() {
		if (index > 0) setSelected(photos[index - 1].id);
	}
	function next() {
		if (index < photos.length - 1) setSelected(photos[index + 1].id);
	}
	function galleryFocus() {
		return thumbnail.current?.isConnected
			? thumbnail.current
			: (gallery.current?.querySelector<HTMLButtonElement>("button") ??
					gallery.current);
	}
	async function remove() {
		if (!current || removing) return;
		setRemoving(true);
		setError(null);
		try {
			const result = await removeVehiclePhoto(vehicle.id, current.id);
			if (!result.success || !result.data.ok) {
				if (
					result.success &&
					!result.data.ok &&
					result.data.reason === "vehicle_archived"
				) {
					onArchived();
					setError(
						t(
							"settings.vehicles.photos.archived",
							"This vehicle is archived. Restore it to add or remove photos.",
						),
					);
				} else
					setError(
						t(
							"settings.vehicles.photos.removeFailed",
							"The photo could not be removed. Try again.",
						),
					);
				setConfirming(false);
				setRemoving(false);
				return;
			}
			const remaining = photos.filter((photo) => photo.id !== current.id);
			setSelected(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
			onRemoved(current.id);
			setConfirming(false);
		} catch {
			setError(
				t(
					"settings.vehicles.photos.removeFailed",
					"The photo could not be removed. Try again.",
				),
			);
			setConfirming(false);
		}
		setRemoving(false);
	}

	return (
		<Dialog
			open={current !== null}
			onOpenChange={(open) => {
				if (!open) setSelected(null);
			}}
		>
			<fieldset
				ref={gallery}
				tabIndex={-1}
				aria-label={t("settings.vehicles.photos.gallery", "Vehicle photos")}
				className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
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
							setError(null);
							setSelected(photo.id);
						}}
					>
						{/* biome-ignore lint/performance/noImgElement: The optimized private image must use the authenticated delivery route directly. */}
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
			</fieldset>
			{current ? (
				<DialogContent
					className="overscroll-contain sm:max-w-5xl"
					finalFocus={galleryFocus}
					onKeyDown={(event) => {
						if (confirming) return;
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
						<DialogTitle ref={viewerTitle} tabIndex={-1} aria-live="polite">
							{t(
								"settings.vehicles.photos.position",
								"Photo {number} of {count}",
								{
									number: index + 1,
									count: photos.length,
								},
							)}
						</DialogTitle>
						<DialogDescription className="break-words">
							{vehicle.name} · {vehicle.licencePlate}
						</DialogDescription>
					</DialogHeader>
					{/* biome-ignore lint/performance/noImgElement: The optimized private image must use the authenticated delivery route directly. */}
					<img
						src={current.imageUrl}
						alt={t(
							"settings.vehicles.photos.imageNamed",
							"{name}, photo {number}",
							{
								name: vehicle.name,
								number: index + 1,
							},
						)}
						width={current.width}
						height={current.height}
						className="max-h-[65dvh] w-full object-contain"
					/>
					{error ? (
						<p role="alert" className="text-destructive text-sm">
							{error}
						</p>
					) : null}
					{!archived ? (
						<Button
							ref={removeButton}
							variant="destructive"
							onClick={() => setConfirming(true)}
						>
							<IconTrash aria-hidden="true" />
							{t("settings.vehicles.photos.remove", "Remove photo")}
						</Button>
					) : null}
					<div className="flex justify-between gap-3">
						<Button variant="outline" onClick={previous} disabled={index <= 0}>
							<IconChevronLeft aria-hidden="true" />
							{t("settings.vehicles.photos.previous", "Previous photo")}
						</Button>
						<Button
							variant="outline"
							onClick={next}
							disabled={index === photos.length - 1}
						>
							{t("settings.vehicles.photos.next", "Next photo")}
							<IconChevronRight aria-hidden="true" />
						</Button>
					</div>
				</DialogContent>
			) : null}
			<AlertDialog
				open={confirming}
				onOpenChange={(open) => {
					if (!removing) setConfirming(open);
				}}
			>
				<AlertDialogContent
					className="overscroll-contain"
					finalFocus={() =>
						current
							? (removeButton.current ?? viewerTitle.current)
							: galleryFocus()
					}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t(
								"settings.vehicles.photos.removeTitle",
								"Permanently remove this photo?",
							)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.vehicles.photos.removeDescription",
								"This photo will be permanently removed from the vehicle gallery. This cannot be undone.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={removing}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<Button
							variant="destructive"
							disabled={removing}
							onClick={() => startTransition(remove)}
						>
							{removing
								? t("settings.vehicles.photos.removing", "Removing photo…")
								: t(
										"settings.vehicles.photos.removeConfirm",
										"Permanently remove photo",
									)}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Dialog>
	);
}
