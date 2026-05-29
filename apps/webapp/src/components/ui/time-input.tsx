"use client";

import { IconClock } from "@tabler/icons-react";
import type * as React from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { TimepickerUI } from "timepicker-ui";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { Button } from "@/components/ui/button";
import {
	normalizeTimeFormat,
	type TimeFormat,
	timeFormatToPickerType,
} from "@/lib/user-preferences/time-format";
import { cn } from "@/lib/utils";

type TimeInputProps = Omit<React.ComponentProps<"input">, "readOnly" | "type"> & {
	timeFormat?: TimeFormat | string | null;
};

type PickerConfirmData = {
	hour?: string | null;
	minutes?: string | null;
	type?: string | null;
};

type Period = "AM" | "PM";

function createChangeEvent(value: string): React.ChangeEvent<HTMLInputElement> {
	const changeTarget = { value } as HTMLInputElement;
	return {
		currentTarget: changeTarget,
		target: changeTarget,
		type: "change",
	} as React.ChangeEvent<HTMLInputElement>;
}

function getPeriodFromTime(value: string | number | readonly string[] | undefined): Period {
	if (typeof value !== "string") {
		return "AM";
	}

	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) {
		return "AM";
	}

	return Number(match[1]) >= 12 ? "PM" : "AM";
}

function formatTimeForMaskedInput(
	value: string | number | readonly string[] | undefined,
	timeFormat: TimeFormat,
): string | number | readonly string[] | undefined {
	if (typeof value !== "string") {
		return value;
	}

	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) {
		return value;
	}

	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) {
		return value;
	}

	if (timeFormat === "24h") {
		return value;
	}

	const displayHour = hour % 12 || 12;
	return `${displayHour.toString().padStart(2, "0")}:${match[2]}`;
}

function formatTypedTimeInput(value: string): string {
	const digits = value.replace(/\D/g, "").slice(0, 4);

	if (digits.length <= 2) {
		return value.endsWith(":") && digits.length === 2 ? `${digits}:` : digits;
	}

	return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function parseMaskedTime(value: string, timeFormat: TimeFormat, period: Period): string | null {
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) {
		return null;
	}

	const hour = Number(match[1]);
	const minutes = Number(match[2]);
	const validHour = timeFormat === "12h" ? hour >= 1 && hour <= 12 : hour >= 0 && hour <= 23;
	if (!validHour || minutes < 0 || minutes > 59) {
		return null;
	}

	const storedHour =
		timeFormat === "12h"
			? period === "PM"
				? hour === 12
					? 12
					: hour + 12
				: hour === 12
					? 0
					: hour
			: hour;

	return `${storedHour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function normalizePickerConfirmTime(
	data: PickerConfirmData,
	timeFormat: TimeFormat,
): string | null {
	if (!data.hour || !data.minutes) {
		return null;
	}

	const hour = Number(data.hour);
	const minutes = Number(data.minutes);
	if (!Number.isInteger(hour) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
		return null;
	}

	const storedHour =
		timeFormat === "12h" && (data.type === "AM" || data.type === "PM")
			? data.type === "PM"
				? hour === 12
					? 12
					: hour + 12
				: hour === 12
					? 0
					: hour
			: hour;

	if (storedHour < 0 || storedHour > 23) {
		return null;
	}

	return `${storedHour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function TimeInput({
	className,
	onChange,
	value,
	defaultValue,
	timeFormat,
	...props
}: TimeInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const pickerAnchorRef = useRef<HTMLInputElement>(null);
	const onChangeRef = useRef(onChange);
	const lastEmittedValueRef = useRef<string | null>(null);
	const modalRootId = `time-input-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const contextTimeFormat = useTimeFormat();
	const pickerFormat = normalizeTimeFormat(timeFormat ?? contextTimeFormat);
	const [displayValue, setDisplayValue] = useState(() =>
		formatTimeForMaskedInput(value ?? defaultValue, pickerFormat),
	);
	const [period, setPeriod] = useState<Period>(() => getPeriodFromTime(value ?? defaultValue));
	const pickerAnchorValue =
		typeof displayValue === "string" && displayValue !== "" && pickerFormat === "12h"
			? `${displayValue} ${period}`
			: typeof displayValue === "string"
				? displayValue
				: "";

	useLayoutEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	const emitChange = (value: string) => {
		if (lastEmittedValueRef.current === value) {
			return;
		}

		lastEmittedValueRef.current = value;
		onChangeRef.current?.(createChangeEvent(value));
	};

	useEffect(() => {
		if (value === undefined) {
			return;
		}

		const nextDisplayValue = formatTimeForMaskedInput(value, pickerFormat);
		const nextPeriod = getPeriodFromTime(value);
		const timeout = window.setTimeout(() => {
			setDisplayValue(nextDisplayValue);
			setPeriod(nextPeriod);
			lastEmittedValueRef.current = null;
		}, 0);

		return () => window.clearTimeout(timeout);
	}, [pickerFormat, value]);

	useEffect(() => {
		if (!pickerAnchorRef.current) {
			return;
		}

		const picker = new TimepickerUI(pickerAnchorRef.current, {
			clock: {
				type: timeFormatToPickerType(pickerFormat),
			},
			ui: {
				appendModalSelector: `#${modalRootId}`,
				editable: false,
			},
			callbacks: {
				onConfirm: (data) => {
					const nextValue = normalizePickerConfirmTime(data, pickerFormat);
					if (!nextValue) {
						return;
					}

					flushSync(() => {
						setDisplayValue(formatTimeForMaskedInput(nextValue, pickerFormat));
						setPeriod(getPeriodFromTime(nextValue));
					});
					emitChange(nextValue);
				},
			},
		});

		picker.create();

		return () => picker.destroy({ keepInputValue: true });
	}, [emitChange, modalRootId, pickerFormat]);

	function handleMaskedValueChange(nextRawDisplayValue: string) {
		const nextDisplayValue = formatTypedTimeInput(nextRawDisplayValue);
		setDisplayValue(nextDisplayValue);
		if (nextDisplayValue === "") {
			emitChange("");
			return;
		}

		const nextValue = parseMaskedTime(nextDisplayValue, pickerFormat, period);
		if (nextValue) {
			emitChange(nextValue);
		}
	}

	function handlePeriodToggle() {
		setPeriod((currentPeriod) => {
			const nextPeriod = currentPeriod === "AM" ? "PM" : "AM";
			if (typeof displayValue === "string") {
				const nextValue = parseMaskedTime(displayValue, pickerFormat, nextPeriod);
				if (nextValue) {
					emitChange(nextValue);
				}
			}

			return nextPeriod;
		});
	}

	return (
		<div className="contents" id={modalRootId}>
			<div
				className={cn(
					"flex h-9 w-full min-w-0 overflow-hidden rounded-md border border-input bg-card shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
					"has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-destructive/20 dark:has-[[aria-invalid=true]]:ring-destructive/40",
					props.disabled && "cursor-not-allowed opacity-50",
					className,
				)}
				data-slot="time-input"
			>
				<input
					{...props}
					aria-invalid={props["aria-invalid"]}
					autoComplete={props.autoComplete ?? "off"}
					className="min-w-0 flex-1 border-0 bg-transparent px-3 py-1 text-base outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
					data-slot="time-input-field"
					inputMode={props.inputMode ?? "numeric"}
					onChange={(event) => handleMaskedValueChange(event.currentTarget.value)}
					ref={inputRef}
					type="text"
					value={typeof displayValue === "string" ? displayValue : ""}
				/>
				{pickerFormat === "12h" ? (
					<Button
						aria-label={`Switch to ${period === "AM" ? "PM" : "AM"}`}
						className="h-full rounded-none border-y-0 border-l border-r-0 px-2.5 shadow-none"
						disabled={props.disabled}
						onClick={handlePeriodToggle}
						type="button"
						variant="ghost"
					>
						{period}
					</Button>
				) : null}
				<Button
					aria-label="Open time picker"
					className="h-full rounded-none border-y-0 border-l border-r-0 px-2.5 shadow-none"
					disabled={props.disabled}
					onClick={() => pickerAnchorRef.current?.click()}
					type="button"
					variant="ghost"
				>
					<IconClock aria-hidden="true" />
				</Button>
			</div>
			<input
				aria-hidden="true"
				className="hidden"
				readOnly
				ref={pickerAnchorRef}
				tabIndex={-1}
				type="text"
				value={pickerAnchorValue}
			/>
		</div>
	);
}

export { TimeInput };
