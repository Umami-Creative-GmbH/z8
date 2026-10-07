"use client";

import { IconCalendar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import * as React from "react";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	calendarDateFromPlainDate,
	plainDateFromCalendarDate,
} from "@/lib/datetime/calendar-date";
import { cn } from "@/lib/utils";
import { formatDateOnly, parseDateOnly } from "./date-picker-utils";

type DatePickerProps = Omit<
	React.ComponentProps<typeof Button>,
	"onChange" | "value"
> & {
	value?: string | null;
	onChange: (value: string) => void;
	placeholder?: string;
	min?: string;
	max?: string;
	required?: boolean;
};

function DatePicker({
	value,
	onChange,
	onBlur,
	placeholder,
	min,
	max,
	required,
	disabled,
	className,
	...props
}: DatePickerProps) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const [open, setOpen] = React.useState(false);
	const selectedDate = parseDateOnly(value);
	const displayValue = formatDateOnly(value, locale);
	const hasValue = Boolean(value);

	function handleSelect(date?: Date) {
		if (!date) return;

		onChange(plainDateFromCalendarDate(date).toString());
		setOpen(false);
	}

	function handleClear() {
		onChange("");
		setOpen(false);
	}

	function isDateDisabled(date: Date) {
		const dateOnly = plainDateFromCalendarDate(date).toString();
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
					{displayValue ||
						placeholder ||
						t("common.datePicker.placeholder", "Pick a date")}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto p-0">
				<Calendar
					mode="single"
					selected={selectedDate ? calendarDateFromPlainDate(selectedDate) : undefined}
					defaultMonth={selectedDate ? calendarDateFromPlainDate(selectedDate) : undefined}
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
							{t("common.datePicker.clearDate", "Clear date")}
						</Button>
					</div>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

export { DatePicker };
