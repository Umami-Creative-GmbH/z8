"use client";

import { IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { normalizeKioskBadgeCredential } from "@/lib/time-tracking/kiosk/badge-credential";
import {
	createKioskQrDecoder,
	type KioskQrDecoder,
} from "@/lib/time-tracking/kiosk/camera-qr-decoder";
import type { KioskCameraProblem } from "./kiosk-turn-flow";

/** The camera preview is read about this often while it looks for a badge. */
export const KIOSK_CAMERA_FRAME_MS = 150;

/** Why `getUserMedia` refused, in the kiosk's words. */
function cameraProblemOf(error: unknown): KioskCameraProblem {
	const name = error instanceof Error || error instanceof DOMException ? error.name : "";
	if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
		return "camera_denied";
	}
	if (
		name === "NotFoundError" ||
		name === "DevicesNotFoundError" ||
		name === "OverconstrainedError"
	) {
		return "camera_missing";
	}
	// Without a secure context some browsers have no `getUserMedia` to call at all.
	if (name === "TypeError") return "camera_unsupported";
	return "camera_failed";
}

interface KioskCameraScanProps {
	/** The kiosk badge the camera read; the camera has already stopped. Called once. */
	onBadge: (credential: string) => void;
	/** The camera could not scan; it is stopped (or never started). */
	onProblem: (problem: KioskCameraProblem) => void;
	/** The person cancelled, or the page was hidden; the camera is stopped. */
	onCancel: () => void;
}

/**
 * The kiosk camera looking for a kiosk badge (#1367, spec #889). Opens the
 * camera when it mounts, reads the preview's frames on the device
 * (`camera-qr-decoder.ts`) and, at the first kiosk badge it reads, stops the
 * camera and hands the badge to `onBadge`, once. Codes that are no kiosk badge
 * are told apart and never opened. Unmounting (any way out of the scan: a read
 * badge, cancel, the kiosk's idle timeout, a hidden or closed page) stops the
 * camera, also one that opens only afterwards. No frame is kept or sent.
 */
export function KioskCameraScan({ onBadge, onProblem, onCancel }: KioskCameraScanProps) {
	const { t } = useTranslate();
	const video = useRef<HTMLVideoElement>(null);
	const [starting, setStarting] = useState(true);
	const [notBadge, setNotBadge] = useState(false);
	// The front camera, which faces the person at a kiosk, shows mirrored like a mirror does.
	const [mirrored, setMirrored] = useState(true);
	const found = useEffectEvent((credential: string) => onBadge(credential));
	const failed = useEffectEvent((problem: KioskCameraProblem) => onProblem(problem));
	const hidden = useEffectEvent(() => onCancel());

	useEffect(() => {
		let over = false;
		let stream: MediaStream | null = null;
		let timer: number | undefined;

		function stop() {
			over = true;
			window.clearTimeout(timer);
			for (const track of stream?.getTracks() ?? []) {
				track.removeEventListener("ended", ended);
				track.stop();
			}
			stream = null;
			if (video.current) video.current.srcObject = null;
		}

		// The camera went away on its own: unplugged, or taken by another app.
		function ended() {
			if (over) return;
			stop();
			failed("camera_failed");
		}

		async function look(decoder: KioskQrDecoder) {
			if (over) return;
			const preview = video.current;
			const text = preview ? await decoder.read(preview).catch(() => null) : null;
			if (over) return;
			if (text !== null) {
				const credential = normalizeKioskBadgeCredential(text);
				if (credential) {
					stop();
					found(credential);
					return;
				}
				setNotBadge(true);
			}
			timer = window.setTimeout(() => void look(decoder), KIOSK_CAMERA_FRAME_MS);
		}

		async function start() {
			const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
			const decoder =
				typeof media?.getUserMedia === "function" ? await createKioskQrDecoder() : null;
			if (over) return;
			if (!media || !decoder) {
				over = true;
				failed("camera_unsupported");
				return;
			}
			let opened: MediaStream;
			try {
				opened = await media.getUserMedia({
					audio: false,
					video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
				});
			} catch (error) {
				if (!over) {
					over = true;
					failed(cameraProblemOf(error));
				}
				return;
			}
			if (over) {
				// The scan ended while the browser opened the camera.
				for (const track of opened.getTracks()) track.stop();
				return;
			}
			stream = opened;
			for (const track of opened.getTracks()) track.addEventListener("ended", ended);
			const [track] = opened.getVideoTracks();
			setMirrored(track?.getSettings?.().facingMode !== "environment");
			const preview = video.current;
			if (preview) {
				preview.srcObject = opened;
				await Promise.resolve(preview.play()).catch(() => undefined);
			}
			if (over) return;
			setStarting(false);
			void look(decoder);
		}

		function visibility() {
			if (document.visibilityState !== "hidden" || over) return;
			stop();
			hidden();
		}

		void start();
		document.addEventListener("visibilitychange", visibility);
		return () => {
			document.removeEventListener("visibilitychange", visibility);
			stop();
		};
	}, []);

	return (
		<section
			aria-labelledby="kiosk-camera-title"
			className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-5"
		>
			<div className="space-y-2 text-center">
				<h1 id="kiosk-camera-title" className="text-3xl font-semibold">
					{t("timeTracking.kiosk.camera.title", "Hold your kiosk badge up to the camera")}
				</h1>
				<p className="text-lg text-muted-foreground">
					{t(
						"timeTracking.kiosk.camera.hint",
						"Keep the QR code inside the frame. The code is read on this kiosk; no picture is saved.",
					)}
				</p>
			</div>
			<div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border bg-muted landscape:max-h-[60vh] landscape:w-auto">
				<video
					ref={video}
					muted
					playsInline
					autoPlay
					aria-label={t("timeTracking.kiosk.camera.preview", "Camera preview")}
					className={`size-full object-cover ${mirrored ? "-scale-x-100" : ""}`}
				/>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-[15%] rounded-xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]"
				/>
				{starting ? (
					<output
						aria-busy="true"
						className="absolute inset-0 flex items-center justify-center gap-3 bg-background/70 text-lg"
					>
						<IconLoader2
							className="size-6 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>
						{t("timeTracking.kiosk.camera.starting", "Starting the camera…")}
					</output>
				) : null}
			</div>
			{notBadge ? (
				<output className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-lg text-amber-900 dark:text-amber-100">
					{t(
						"timeTracking.kiosk.camera.notBadge",
						"This code is not a kiosk badge. Hold up your kiosk badge.",
					)}
				</output>
			) : null}
			<Button size="lg" variant="outline" className="h-14 px-8 text-lg" onClick={onCancel}>
				<IconX className="size-5" aria-hidden="true" />
				{t("timeTracking.kiosk.camera.cancel", "Cancel scanning")}
			</Button>
		</section>
	);
}
