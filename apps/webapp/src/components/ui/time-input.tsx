"use client";

import type * as React from "react";
import { useEffect, useRef } from "react";
import { TimepickerUI } from "timepicker-ui";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import {
	formatTimeStringForPreference,
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
	type?: "AM" | "PM" | null;
};

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
		timeFormat === "12h" && data.type
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
	const onChangeRef = useRef(onChange);
	const contextTimeFormat = useTimeFormat();
	const pickerFormat = normalizeTimeFormat(timeFormat ?? contextTimeFormat);
	const displayValue =
		typeof value === "string" ? formatTimeStringForPreference(value, pickerFormat) : value;
	const displayDefaultValue =
		typeof defaultValue === "string"
			? formatTimeStringForPreference(defaultValue, pickerFormat)
			: defaultValue;

	onChangeRef.current = onChange;

	useEffect(() => {
		if (!inputRef.current) {
			return;
		}

		const picker = new TimepickerUI(inputRef.current, {
			clock: {
				type: timeFormatToPickerType(pickerFormat),
			},
			ui: {
				editable: false,
			},
			callbacks: {
				onConfirm: (data) => {
					const nextValue = normalizePickerConfirmTime(data, pickerFormat);
					if (!inputRef.current || !nextValue) {
						return;
					}

					const input = inputRef.current;
					input.value = formatTimeStringForPreference(nextValue, pickerFormat);
					const changeTarget = { value: nextValue } as HTMLInputElement;
					onChangeRef.current?.({
						currentTarget: changeTarget,
						target: changeTarget,
						type: "change",
					} as React.ChangeEvent<HTMLInputElement>);
				},
			},
		});

		picker.create();

		return () => picker.destroy({ keepInputValue: true });
	}, [pickerFormat]);

	return (
		<input
			className={cn(
				"flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				className,
			)}
			{...props}
			data-slot="time-input"
			defaultValue={displayDefaultValue}
			readOnly
			ref={inputRef}
			type="text"
			value={displayValue}
		/>
	);
}

export { TimeInput };
