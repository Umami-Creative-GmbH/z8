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
import {
	type ActionFailure,
	actionErrorMessage,
} from "@/lib/organization-action/action-error-message";
import {
	isRetryableUploadRefusal,
	UPLOAD_FAILED,
	VEHICLE_PHOTO_UPLOAD_REFUSALS,
} from "./vehicle-photo-refusals";

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
	/** A failed action result, an upload route refusal (`{ refusal }`) or none: an unknown failure. */
	function message(failure?: ActionFailure) {
		return actionErrorMessage(t, failure, VEHICLE_PHOTO_UPLOAD_REFUSALS, UPLOAD_FAILED);
	}
	function fail(entry: UploadEntry, failure?: ActionFailure) {
		if (failure?.refusal === "vehicle_archived") onArchived();
		update(entry, {
			status: "failed",
			message: message(failure),
			retryable: isRetryableUploadRefusal(failure?.refusal),
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
						? { code: "AuthorizationError" }
						: { refusal: failure.reason },
				);
				return;
			}
			const outcome:
				| { ok: true; photo: VehiclePhotoView }
				| { ok: false; reason?: string } = await response.json();
			if (!outcome.ok) {
				fail(entry, { refusal: outcome.reason });
				return;
			}
			update(entry, { status: "saved", photo: outcome.photo });
			onSaved(outcome.photo);
		} catch {
			update(entry, { status: "failed", message: message() });
		}
	}
	async function resume(entry: UploadEntry) {
		if (!entry.uploadId) return;
		try {
			const result = await reconcileVehiclePhotoUpload({ vehicleId, uploadId: entry.uploadId });
			if (!result.success) {
				fail(entry, result);
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
				fail(entry, { refusal: "photo_limit" });
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
			const result = await initiateVehiclePhotoBatchUpload({
				vehicleId,
				uploadIds: batch.map((entry) => entry.id),
			});
			if (!result.success) {
				for (const entry of targets) fail(entry, result);
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
					message: message({ refusal: "unsupported_image" }),
					retryable: false,
				});
			else if (entry.file.size > MAX_VEHICLE_PHOTO_BYTES)
				update(entry, {
					status: "failed",
					message: message({ refusal: "photo_too_large" }),
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
		message,
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
		message,
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
				<p className="text-muted-foreground text-sm">
					{message({ refusal: "photo_limit" })}
				</p>
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
