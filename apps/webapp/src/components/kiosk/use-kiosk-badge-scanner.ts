"use client";

import { useEffect, useEffectEvent } from "react";
import { normalizeKioskBadgeCredential } from "@/lib/time-tracking/kiosk/badge-credential";

/**
 * An attached QR scanner at a kiosk (#1366, spec #889). Keyboard-style
 * ("wedge") scanners type what the code holds as a fast burst of key presses,
 * usually ended by Enter or Tab. People type far slower, so a burst is told
 * apart from ordinary typing (the name search) by the time between keys, for
 * every key, whatever the code holds (a badge, a product barcode, a link).
 *
 * - `read` (the home screen): a burst of at least `MIN_BURST_LENGTH` keys,
 *   ended by Enter or Tab or by a pause, is a scan. A badge credential goes to
 *   `onBadge`; anything else (a link, another code) to `onUnreadable`, and is
 *   never opened. Ordinary typing in the search box is left alone; the keys of
 *   a scan that also reached it are taken back through `onScanStart`/`onScanEnd`.
 *   Outside a text field, typed characters mean nothing on the home screen, so
 *   they are kept from the focused control (no language typeahead, no button
 *   press by a scanned space); only a person's Space still presses a button.
 * - `guard` (any other screen of the kiosk): every burst is swallowed, Enter
 *   and Tab included, so a scan during an employee's turn, a confirmation or an
 *   unresolved action changes nothing on screen: no digit reaches the PIN pad,
 *   no Enter submits it or presses a focused button. A typed character outside
 *   a text field is held for one key gap and handed on only when no burst
 *   follows, so even a scan's first key never arrives. In a text field (the
 *   vehicle step's kilometres) the first key cannot be held back; the rest of
 *   the burst and its Enter still are.
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

type Burst = {
	text: string;
	lastAt: number;
	overflow: boolean;
	/** A second key followed within the key gap: this is a scanner, not a person. */
	scanning: boolean;
};

function isTypedCharacter(event: KeyboardEvent) {
	return event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/** Whether keys typed at this element edit text (where a held key could not be handed on). */
function isTextEntry(element: Element | null): boolean {
	if (!element) return false;
	if (element instanceof HTMLTextAreaElement) return true;
	if (element instanceof HTMLInputElement) {
		return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(
			element.type,
		);
	}
	return element instanceof HTMLElement && element.isContentEditable;
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
		// Guard mode: a person's key held back for one key gap, and the copies handed on.
		let held: { event: KeyboardEvent; target: EventTarget; timer: number } | null = null;
		const handedOn = new WeakSet<Event>();

		function handOn() {
			if (!held) return;
			const { event, target } = held;
			held = null;
			const copy = new KeyboardEvent("keydown", {
				key: event.key,
				code: event.code,
				shiftKey: event.shiftKey,
				bubbles: true,
				cancelable: true,
			});
			handedOn.add(copy);
			(target instanceof Node && target.isConnected ? target : window).dispatchEvent(copy);
		}

		function dropHeld() {
			if (!held) return;
			window.clearTimeout(held.timer);
			held = null;
		}

		function end() {
			window.clearTimeout(pause);
			const ended = burst;
			burst = null;
			if (mode === "read" && ended && ended.text.length >= MIN_BURST_LENGTH) {
				finish(ended.text, ended.overflow);
			}
		}

		function listener(event: KeyboardEvent) {
			if (handedOn.has(event) || event.isComposing || event.repeat) return;
			const terminator = event.key === "Enter" || event.key === "Tab";
			// Shift (which scanners press for capitals) and other keys neither continue nor end a burst.
			if (!terminator && !isTypedCharacter(event)) return;
			const now = Date.now();
			const continues = burst !== null && now - burst.lastAt <= KIOSK_SCAN_KEY_GAP_MS;
			// A key after a pause ends the burst before it (as the pause itself would have).
			if (!continues && burst) end();
			const textEntry = isTextEntry(document.activeElement);

			if (terminator) {
				if (!burst) return;
				// Guard: any Enter or Tab right after a key belongs to a scan.
				if (mode === "guard" || burst.text.length >= MIN_BURST_LENGTH) {
					dropHeld();
					swallow(event);
				}
				end();
				return;
			}

			if (!burst) {
				// A key held for the burst that just ended goes on first, in its order.
				if (held) {
					window.clearTimeout(held.timer);
					handOn();
				}
				burst = { text: "", lastAt: now, overflow: false, scanning: false };
				if (mode === "read") started();
			} else if (!burst.scanning) {
				burst.scanning = true;
				// The key held back was the scan's first one: it never arrives.
				dropHeld();
			}
			burst.lastAt = now;
			if (burst.text.length < MAX_BURST_LENGTH) burst.text += event.key;
			else burst.overflow = true;
			window.clearTimeout(pause);
			pause = window.setTimeout(end, SCAN_PAUSE_MS);

			if (textEntry) {
				// In a text field a person's first key is typed at once; a scan's other keys are not.
				if (mode === "guard" && burst.scanning) swallow(event);
				return;
			}
			if (burst.scanning || mode === "read") {
				// Read: a person's Space still presses the focused button; a scanned one does not.
				if (mode === "read" && !burst.scanning && event.key === " ") return;
				swallow(event);
				return;
			}
			// Guard, a person's key outside a text field: Space presses buttons at once (a held
			// copy could not); anything else waits one key gap, then goes on unless a burst follows.
			if (event.key === " ") return;
			swallow(event);
			const target = event.target ?? window;
			held = {
				event,
				target,
				timer: window.setTimeout(handOn, KIOSK_SCAN_KEY_GAP_MS + 1),
			};
		}

		// Capture: the scanner is heard before the focused control or the PIN pad.
		window.addEventListener("keydown", listener, true);
		return () => {
			window.removeEventListener("keydown", listener, true);
			window.clearTimeout(pause);
			dropHeld();
		};
	}, [mode]);
}
