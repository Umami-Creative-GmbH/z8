"use client";

import { useEffect, useEffectEvent } from "react";
import {
	KIOSK_BADGE_CREDENTIAL_PREFIX,
	normalizeKioskBadgeCredential,
} from "@/lib/time-tracking/kiosk/badge-credential";

/**
 * An attached QR scanner at a kiosk (#1366, spec #889). Keyboard-style
 * ("wedge") scanners type what the code holds as a fast burst of key presses,
 * usually ended by Enter or Tab. People type far slower, so a burst is told
 * apart from ordinary typing (the name search) by the time between keys.
 *
 * - `read` (the home screen): a burst of at least `MIN_BURST_LENGTH` keys,
 *   ended by Enter or Tab or by a pause, is a scan. A badge credential goes to
 *   `onBadge`; anything else (a link, another code) to `onUnreadable`, and is
 *   never opened. Ordinary typing is left alone; the keys of a scan that also
 *   reached the search box are taken back through `onScanStart`/`onScanEnd`.
 * - `guard` (any other screen of the kiosk): a burst that starts like a badge is
 *   swallowed, Enter included, so a scan during an employee's turn, a
 *   confirmation or an unresolved action changes nothing on screen.
 * - `off`: no listener at all (a kiosk without scanner input).
 *
 * Nothing scanned is kept beyond the burst.
 */
export type KioskBadgeScannerMode = "read" | "guard" | "off";

/** Keys of one scan follow each other at most this far apart. */
export const KIOSK_SCAN_KEY_GAP_MS = 60;
/** A burst without Enter or Tab ends after this pause. */
const SCAN_PAUSE_MS = 150;
/** Shorter bursts are typing, never a scan. */
const MIN_BURST_LENGTH = 8;
/** Longer input is never a badge; the rest of it is still swallowed or ignored. */
const MAX_BURST_LENGTH = 256;

interface KioskBadgeScannerOptions {
	mode: KioskBadgeScannerMode;
	onBadge?: (credential: string) => void;
	onUnreadable?: () => void;
	/** The first key of what may be a scan; the search box has not changed yet. */
	onScanStart?: () => void;
	/** A burst ended as a scan (read or not): undo what it typed into the search box. */
	onScanEnd?: () => void;
}

type Burst = { text: string; lastAt: number; overflow: boolean };

function isTypedCharacter(event: KeyboardEvent) {
	return event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;
}

function swallow(event: KeyboardEvent) {
	event.preventDefault();
	event.stopImmediatePropagation();
}

export function useKioskBadgeScanner(options: KioskBadgeScannerOptions) {
	const { mode } = options;

	const finish = useEffectEvent((text: string, overflow: boolean) => {
		options.onScanEnd?.();
		const credential = overflow ? null : normalizeKioskBadgeCredential(text);
		if (credential) options.onBadge?.(credential);
		else options.onUnreadable?.();
	});
	const started = useEffectEvent(() => options.onScanStart?.());

	useEffect(() => {
		if (mode === "off") return;
		let burst: Burst | null = null;
		let pause: number | undefined;

		function end() {
			window.clearTimeout(pause);
			const ended = burst;
			burst = null;
			if (mode === "read" && ended && ended.text.length >= MIN_BURST_LENGTH) {
				finish(ended.text, ended.overflow);
			}
		}

		function listener(event: KeyboardEvent) {
			if (event.isComposing || event.repeat) return;
			const terminator = event.key === "Enter" || event.key === "Tab";
			// Shift (which scanners press for capitals) and other keys neither continue nor end a burst.
			if (!terminator && !isTypedCharacter(event)) return;
			const now = Date.now();
			const continues = burst !== null && now - burst.lastAt <= KIOSK_SCAN_KEY_GAP_MS;
			// A key after a pause ends the burst before it (as the pause itself would have).
			if (!continues && burst) end();
			if (terminator) {
				if (!burst) return;
				if (mode === "guard" || burst.text.length >= MIN_BURST_LENGTH) swallow(event);
				end();
				return;
			}
			if (!burst) {
				// On other screens only what starts like a badge is a scan; everything else is typing.
				if (mode === "guard" && event.key.toUpperCase() !== KIOSK_BADGE_CREDENTIAL_PREFIX[0]) {
					return;
				}
				burst = { text: "", lastAt: now, overflow: false };
				if (mode === "read") started();
			}
			burst.lastAt = now;
			if (burst.text.length < MAX_BURST_LENGTH) burst.text += event.key;
			else burst.overflow = true;
			if (mode === "guard") swallow(event);
			window.clearTimeout(pause);
			pause = window.setTimeout(end, SCAN_PAUSE_MS);
		}

		// Capture: the scanner is heard before the focused control or the PIN pad.
		window.addEventListener("keydown", listener, true);
		return () => {
			window.removeEventListener("keydown", listener, true);
			window.clearTimeout(pause);
		};
	}, [mode]);
}
