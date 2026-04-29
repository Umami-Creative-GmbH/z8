"use client";

import { IconCalendar } from "@tabler/icons-react";
import { DateTime } from "luxon";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DatePickerProps = Omit<React.ComponentProps<typeof Button>, "onChange" | "value"> & {
	value?: string | null;
	onChange: (value: string) => void;
	placeholder?: string;
	min?: string;
	max?: string;
	required?: boolean;
};

function parseDateOnly(value?: string | null) {
	if (!value) return null;

	const date = DateTime.fromFormat(value, "yyyy-MM-dd");
	return date.isValid ? date : null;
}

function formatDateOnly(value?: string | null) {
	const date = parseDateOnly(value);
	return date?.toLocaleString(DateTime.DATE_MED) ?? "";
}

function DatePicker({
	value,
	onChange,
	onBlur,
	placeholder = "Pick a date",
	min,
	max,
	required,
	disabled,
	className,
	...props
}: DatePickerProps) {
	const [open, setOpen] = React.useState(false);
	const selectedDate = parseDateOnly(value);
	const displayValue = formatDateOnly(value);
	const hasValue = Boolean(value);

	function handleSelect(date?: Date) {
		if (!date) return;

		onChange(DateTime.fromJSDate(date).toFormat("yyyy-MM-dd"));
		setOpen(false);
	}

	function handleClear() {
		onChange("");
		setOpen(false);
	}

	function isDateDisabled(date: Date) {
		const dateOnly = DateTime.fromJSDate(date).toFormat("yyyy-MM-dd");
		return Boolean((min && dateOnly < min) || (max && dateOnly > max));
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					aria-required={required || undefined}
					className={cn(
						"w-full justify-start text-left font-normal",
						!displayValue && "text-muted-foreground",
						className,
					)}
					disabled={disabled}
					onBlur={onBlur}
					type="button"
					variant="outline"
					{...props}
				>
					<IconCalendar className="size-4" />
					{displayValue || placeholder}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto p-0">
				<Calendar
					mode="single"
					selected={selectedDate?.toJSDate()}
					onSelect={handleSelect}
					disabled={isDateDisabled}
				/>
				{!required && hasValue ? (
					<div className="border-t p-2">
						<Button
							className="w-full"
							onClick={handleClear}
							size="sm"
							type="button"
							variant="ghost"
						>
							Clear date
						</Button>
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

export { DatePicker, formatDateOnly, parseDateOnly };
