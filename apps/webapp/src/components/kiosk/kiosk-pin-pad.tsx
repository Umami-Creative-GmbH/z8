"use client";

import { IconArrowLeft, IconBackspace, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 6;
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

interface KioskPinPadProps {
	name: string;
	/** Why the last PIN did nothing, already worded. */
	error: string | null;
	busy: boolean;
	disabled: boolean;
	onSubmit: (pin: string) => void;
	onBack: () => void;
}

/**
 * The kiosk PIN pad (#862): big keys for gloved or hurried hands, the digits
 * shown as dots, and a hardware keyboard works too. The PIN is held only here
 * until it is sent; a refused PIN is cleared.
 */
export function KioskPinPad({ name, error, busy, disabled, onSubmit, onBack }: KioskPinPadProps) {
	const { t } = useTranslate();
	// The parent remounts the pad after a refused PIN, which clears it.
	const [pin, setPin] = useState("");

	const canSubmit = !busy && !disabled && pin.length >= PIN_MIN_LENGTH;

	function press(digit: string) {
		if (busy) return;
		setPin((current) => (current.length < PIN_MAX_LENGTH ? current + digit : current));
	}

	function submit() {
		if (canSubmit) onSubmit(pin);
	}

	const onKey = useEffectEvent((event: KeyboardEvent) => {
		if (/^\d$/.test(event.key)) press(event.key);
		else if (event.key === "Backspace") setPin((current) => current.slice(0, -1));
		else if (event.key === "Enter") submit();
		else if (event.key === "Escape") onBack();
	});

	useEffect(() => {
		const listener = (event: KeyboardEvent) => onKey(event);
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, []);

	const keyClass = "h-20 text-3xl font-semibold sm:h-24";

	return (
		<div className="mx-auto flex w-full max-w-md flex-col gap-6">
			<Button variant="ghost" size="lg" className="h-14 self-start text-lg" onClick={onBack}>
				<IconArrowLeft className="size-6" aria-hidden="true" />
				{t("timeTracking.kiosk.pin.back", "Not you? Back")}
			</Button>
			<div className="space-y-2 text-center">
				<h1 className="text-3xl font-semibold break-words">{name}</h1>
				<p className="text-lg text-muted-foreground">
					{t("timeTracking.kiosk.pin.prompt", "Enter your kiosk PIN")}
				</p>
			</div>
			<output
				aria-label={t("timeTracking.kiosk.pin.entered", "{count} digits entered", {
					count: pin.length,
				})}
				className="flex h-8 items-center justify-center gap-4"
			>
				{Array.from({ length: Math.max(PIN_MIN_LENGTH, pin.length) }, (_, index) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: dots are positions, not items
						key={index}
						aria-hidden="true"
						className={cn(
							"size-5 rounded-full border-2 border-foreground",
							index < pin.length && "bg-foreground",
						)}
					/>
				))}
			</output>
			{error ? (
				<p
					role="alert"
					className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-lg text-destructive"
				>
					{error}
				</p>
			) : null}
			<div className="grid grid-cols-3 gap-3">
				{DIGITS.map((digit) => (
					<Button
						key={digit}
						variant="outline"
						className={keyClass}
						disabled={busy}
						onClick={() => press(digit)}
					>
						{digit}
					</Button>
				))}
				<Button
					variant="outline"
					className={keyClass}
					disabled={busy || pin.length === 0}
					aria-label={t("timeTracking.kiosk.pin.delete", "Delete last digit")}
					onClick={() => setPin((current) => current.slice(0, -1))}
				>
					<IconBackspace className="size-8" aria-hidden="true" />
				</Button>
				<Button variant="outline" className={keyClass} disabled={busy} onClick={() => press("0")}>
					0
				</Button>
				<Button className={keyClass} disabled={!canSubmit} onClick={submit}>
					{busy ? (
						<IconLoader2
							className="size-8 animate-spin motion-reduce:animate-none"
							aria-label={t("timeTracking.kiosk.pin.checking", "Checking…")}
						/>
					) : (
						t("timeTracking.kiosk.pin.submit", "OK")
					)}
				</Button>
			</div>
		</div>
	);
}
