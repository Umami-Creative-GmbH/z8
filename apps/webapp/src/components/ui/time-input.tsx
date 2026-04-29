"use client";

import type * as React from "react";
import { useEffect, useRef } from "react";
import { TimepickerUI } from "timepicker-ui";
import { cn } from "@/lib/utils";

type TimeInputProps = Omit<React.ComponentProps<"input">, "type">;

function TimeInput({ className, onChange, value, defaultValue, ...props }: TimeInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const onChangeRef = useRef(onChange);

	onChangeRef.current = onChange;

	useEffect(() => {
		if (!inputRef.current) {
			return;
		}

		const picker = new TimepickerUI(inputRef.current, {
			clock: {
				type: "24h",
			},
			ui: {
				editable: true,
			},
			callbacks: {
				onConfirm: (data) => {
					if (!inputRef.current || !data.hour || !data.minutes) {
						return;
					}

					inputRef.current.value = `${data.hour}:${data.minutes}`;
					onChangeRef.current?.({
						target: inputRef.current,
					} as React.ChangeEvent<HTMLInputElement>);
				},
			},
		});

		picker.create();

		return () => picker.destroy();
	}, []);

	return (
		<input
			className={cn(
				"flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
				"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				className,
			)}
			data-slot="time-input"
			defaultValue={defaultValue}
			onChange={onChange}
			ref={inputRef}
			type="text"
			value={value}
			{...props}
		/>
	);
}

export { TimeInput };
