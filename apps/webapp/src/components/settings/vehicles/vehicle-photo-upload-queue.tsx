"use client";

import { useTranslate } from "@tolgee/react";
import { useId, useRef, useState } from "react";
import {
	initiateVehiclePhotoBatchUpload,
	reconcileVehiclePhotoUpload,
} from "@/app/[locale]/(app)/settings/vehicles/photo-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	MAX_VEHICLE_PHOTO_BYTES,
	MAX_VEHICLE_PHOTOS,
	type VehiclePhotoView,
} from "@/lib/organization/vehicles/vehicle-photo-types";

type UploadEntry = {
	id: string;
	file: File;
	uploadId?: string;
	batchIds: string[];
	status: "queued" | "uploading" | "saved" | "failed";
	message?: string;
	photo?: VehiclePhotoView;
	retryable?: boolean;
};

export function useVehiclePhotoUploadQueue({
	vehicleId,
	photos,
	disabled,
	onSaved,
	onArchived,
}: {
	vehicleId: string;
	photos: VehiclePhotoView[];
	disabled: boolean;
	onSaved: (photo: VehiclePhotoView) => void;
	onArchived: () => void;
}) {
	const { t } = useTranslate();
	const inputId = useId();
	const [entries, setEntries] = useState<UploadEntry[]>([]);
	const queue = useRef<UploadEntry[]>([]);
	const reservations = useRef<Promise<void> | null>(null);
	const [selectionError, setSelectionError] = useState<string | null>(null);
	function update(entry: UploadEntry, patch: Partial<UploadEntry>) {
		Object.assign(entry, patch);
		setEntries(queue.current.map((entry) => ({ ...entry })));
	}
	function error(reason?: string) {
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
				onArchived();
				return t(
					"settings.vehicles.photos.archived",
					"This vehicle is archived. Restore it to add or remove photos.",
				);
			case "photo_limit":
				return t(
					"settings.vehicles.photos.full",
					"This vehicle has 20 photos. Remove a photo before adding another.",
				);
			case "forbidden":
				return t(
					"settings.vehicles.photos.accessChanged",
					"Your access changed. Reopen vehicle settings to check your permissions.",
				);
			case "vehicle_not_found":
				return t(
					"settings.vehicles.photos.vehicleMissing",
					"This vehicle is no longer available in your organization.",
				);
			case "upload_not_found":
			case "upload_expired":
				return t(
					"settings.vehicles.photos.expired",
					"This upload expired. Select the photo again to upload it.",
				);
			default:
				return t(
					"settings.vehicles.photos.uploadFailed",
					"The photo could not be uploaded. Try again.",
				);
		}
	}
	function fail(entry: UploadEntry, reason?: string) {
		update(entry, {
			status: "failed",
			message: error(reason),
			retryable: ![
				"invalid_image",
				"unsupported_image",
				"heic_unsupported",
				"animated_image",
				"photo_too_large",
				"upload_expired",
				"upload_not_found",
			].includes(reason ?? ""),
		});
	}
	async function transfer(entry: UploadEntry) {
		const uploadId = entry.uploadId;
		if (!uploadId) return;
		update(entry, { status: "uploading" });
		try {
			const response = await fetch(
				`/api/organization/vehicles/${encodeURIComponent(vehicleId)}/photos/${encodeURIComponent(uploadId)}`,
				{
					method: "POST",
					body: entry.file,
					headers: { "Content-Type": entry.file.type },
				},
			);
			if (!response.ok) {
				const failure: { reason?: string } = await response.json();
				fail(
					entry,
					response.status === 401 || response.status === 403
						? "forbidden"
						: failure.reason,
				);
				return;
			}
			const outcome:
				| { ok: true; photo: VehiclePhotoView }
				| { ok: false; reason?: string } = await response.json();
			if (!outcome.ok) {
				fail(entry, outcome.reason);
				return;
			}
			update(entry, { status: "saved", photo: outcome.photo });
			onSaved(outcome.photo);
		} catch {
			update(entry, { status: "failed", message: error() });
		}
	}
	async function resume(entry: UploadEntry) {
		if (!entry.uploadId) return;
		try {
			const result = await reconcileVehiclePhotoUpload(
				vehicleId,
				entry.uploadId,
			);
			if (!result.success || !result.data.ok) {
				const reason =
					result.success && !result.data.ok
						? result.data.reason
						: !result.success &&
								["AuthenticationError", "AuthorizationError"].includes(
									result.code ?? "",
								)
							? "forbidden"
							: undefined;
				fail(entry, reason);
				return;
			}
			if (result.data.photo) {
				update(entry, { status: "saved", photo: result.data.photo });
				onSaved(result.data.photo);
				return;
			}
			const occupied =
				photos.length +
				queue.current.filter(
					(other) =>
						other !== entry &&
						(other.status === "queued" || other.status === "uploading"),
				).length;
			if (occupied >= MAX_VEHICLE_PHOTOS) {
				fail(entry, "photo_limit");
				return;
			}
			await transfer(entry);
		} catch {
			fail(entry);
		}
	}
	async function reserve(
		batch: UploadEntry[],
		targets = batch,
		reconcile = false,
	) {
		try {
			const result = await initiateVehiclePhotoBatchUpload(
				vehicleId,
				batch.map((entry) => entry.id),
			);
			if (!result.success || !result.data.ok) {
				const reason =
					result.success && !result.data.ok
						? result.data.reason
						: !result.success &&
								["AuthenticationError", "AuthorizationError"].includes(
									result.code ?? "",
								)
							? "forbidden"
							: undefined;
				for (const entry of targets) {
					fail(entry, reason);
					if (
						result.success &&
						!result.data.ok &&
						result.data.remaining !== undefined
					)
						update(entry, {
							message: t(
								"settings.vehicles.photos.capacityChanged",
								"The gallery changed. {count} photo slots remain. Reopen it and choose fewer photos.",
								{ count: result.data.remaining },
							),
						});
				}
				return;
			}
			for (const [index, entry] of batch.entries())
				update(entry, { uploadId: result.data.uploadIds[index] });
			for (const entry of targets) {
				if (reconcile) void resume(entry);
				else void transfer(entry);
			}
		} catch {
			for (const entry of targets) fail(entry);
		}
	}
	async function retry(snapshot: UploadEntry) {
		const entry = queue.current.find(
			(candidate) => candidate.id === snapshot.id,
		);
		if (entry?.status !== "failed") return;
		update(entry, { status: "queued", message: undefined });
		if (!entry.uploadId) {
			const batchIds = new Set(entry.batchIds);
			const batch = queue.current.filter((candidate) =>
				batchIds.has(candidate.id),
			);
			reservations.current = (reservations.current ?? Promise.resolve()).then(
				() => reserve(batch, [entry], true),
			);
			return;
		}
		await resume(entry);
	}
	function select(files: File[]) {
		setSelectionError(null);
		const pending = queue.current.filter(
			(entry) => entry.status === "queued" || entry.status === "uploading",
		).length;
		const remaining = Math.max(0, MAX_VEHICLE_PHOTOS - photos.length - pending);
		if (files.length > remaining) {
			setSelectionError(
				t(
					"settings.vehicles.photos.selectionTooLarge",
					"This selection was not uploaded. {count} photo slots remain, including pending uploads.",
					{ count: remaining },
				),
			);
			return;
		}
		const selected: UploadEntry[] = files.map((file) => ({
			id: crypto.randomUUID(),
			file,
			status: "queued" as const,
			batchIds: [],
		}));
		queue.current.push(...selected);
		setEntries(queue.current.map((entry) => ({ ...entry })));
		for (const entry of selected) {
			if (!["image/jpeg", "image/png", "image/webp"].includes(entry.file.type))
				update(entry, {
					status: "failed",
					message: error("unsupported_image"),
					retryable: false,
				});
			else if (entry.file.size > MAX_VEHICLE_PHOTO_BYTES)
				update(entry, {
					status: "failed",
					message: error("photo_too_large"),
					retryable: false,
				});
		}
		const eligible = selected.filter((entry) => entry.status === "queued");
		if (eligible.length) {
			const batchIds = eligible.map((entry) => entry.id);
			for (const entry of eligible) entry.batchIds = batchIds;
			// Serialize ordered reservations across picker events; binary transfers stay independent.
			reservations.current = (reservations.current ?? Promise.resolve()).then(
				() => reserve(eligible),
			);
		}
	}
	return {
		inputId,
		entries,
		selectionError,
		select,
		retry,
		error,
		disabled,
		full: photos.length >= MAX_VEHICLE_PHOTOS,
	};
}

export function VehiclePhotoUploadQueue({
	queue,
}: {
	queue: ReturnType<typeof useVehiclePhotoUploadQueue>;
}) {
	const { t } = useTranslate();
	const {
		inputId,
		entries,
		selectionError,
		select,
		retry,
		error,
		disabled,
		full,
	} = queue;
	return (
		<div className="space-y-2">
			<label htmlFor={inputId} className="font-medium text-sm">
				{t("settings.vehicles.photos.add", "Add photo")}
			</label>
			<Input
				id={inputId}
				name="vehicle-photo"
				type="file"
				multiple
				accept="image/jpeg,image/png,image/webp"
				disabled={disabled || full}
				aria-describedby={`${inputId}-help`}
				onChange={(event) => {
					const files = Array.from(event.currentTarget.files ?? []);
					event.currentTarget.value = "";
					if (files.length) select(files);
				}}
			/>
			<p id={`${inputId}-help`} className="text-muted-foreground text-sm">
				{t(
					"settings.vehicles.photos.limits",
					"JPEG, PNG or WebP. Up to 10 MB per photo, 20 photos per vehicle.",
				)}
			</p>
			{full ? (
				<p className="text-muted-foreground text-sm">{error("photo_limit")}</p>
			) : null}
			{selectionError ? (
				<p role="alert" className="text-destructive text-sm">
					{selectionError}
				</p>
			) : null}
			<ul
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable results need keyboard focus when no retry buttons remain.
				tabIndex={0}
				className="max-h-48 space-y-2 overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				aria-live="polite"
				aria-label={t(
					"settings.vehicles.photos.uploadResults",
					"Photo upload results",
				)}
			>
				{entries.map((entry) => (
					<li
						key={entry.id}
						className="min-w-0 break-words rounded-md border p-3 text-sm"
					>
						{entry.status === "failed" ? (
							<p role="alert" className="text-destructive">
								{entry.file.name}: {entry.message}
							</p>
						) : (
							<p role={entry.status === "saved" ? undefined : "status"}>
								{entry.status === "saved"
									? t("settings.vehicles.photos.saved", "Saved {name}.", {
											name: entry.file.name,
										})
									: entry.status === "queued"
										? t(
												"settings.vehicles.photos.queued",
												"Waiting to upload {name}…",
												{ name: entry.file.name },
											)
										: t(
												"settings.vehicles.photos.uploading",
												"Uploading {name}…",
												{ name: entry.file.name },
											)}
							</p>
						)}
						{entry.status === "failed" && entry.retryable !== false ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="mt-2"
								onClick={() => void retry(entry)}
								aria-label={t(
									"settings.vehicles.photos.retryNamed",
									"Retry {name}",
									{ name: entry.file.name },
								)}
							>
								{t("settings.vehicles.photos.retry", "Retry")}
							</Button>
						) : null}
					</li>
				))}
			</ul>
		</div>
	);
}
