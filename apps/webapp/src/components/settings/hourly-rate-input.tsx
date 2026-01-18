"use client";

import { IconCurrencyEuro } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface HourlyRateInputProps {
	value?: string | null;
	onChange: (value: string) => void;
	onBlur?: () => void;
	disabled?: boolean;
	hasError?: boolean;
	currency?: string;
	placeholder?: string;
}

export function HourlyRateInput({
	value,
	onChange,
	onBlur,
	disabled,
	hasError,
	currency = "EUR",
	placeholder = "0.00",
}: HourlyRateInputProps) {
	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const inputValue = e.target.value;
		// Allow empty string, numbers, and decimal point
		if (inputValue === "" || /^\d*\.?\d*$/.test(inputValue)) {
			onChange(inputValue);
		}
	};

	return (
		<div className="relative">
			<div
				className={cn(
					"pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3",
					disabled && "opacity-50",
				)}
			>
				<IconCurrencyEuro className="size-4 text-muted-foreground" />
			</div>
			<Input
				type="text"
				inputMode="decimal"
				value={value || ""}
				onChange={handleChange}
				onBlur={onBlur}
				disabled={disabled}
				placeholder={placeholder}
				className={cn(
					"pl-9 pr-16",
					hasError && "border-destructive focus-visible:ring-destructive",
				)}
			/>
			<div
				className={cn(
					"pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3",
					disabled && "opacity-50",
				)}
			>
				<span className="text-sm text-muted-foreground">{currency}/h</span>
			</div>
		</div>
	);
}
