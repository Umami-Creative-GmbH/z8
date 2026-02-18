"use client";

import { Check, ChevronsUpDown, Globe } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Common timezones grouped by region
 * Using IANA timezone identifiers
 */
const TIMEZONE_GROUPS = [
	{
		region: "Americas",
		timezones: [
			{ value: "America/New_York", label: "Eastern Time (New York)" },
			{ value: "America/Chicago", label: "Central Time (Chicago)" },
			{ value: "America/Denver", label: "Mountain Time (Denver)" },
			{ value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
			{ value: "America/Anchorage", label: "Alaska Time (Anchorage)" },
			{ value: "Pacific/Honolulu", label: "Hawaii Time (Honolulu)" },
			{ value: "America/Toronto", label: "Eastern Time (Toronto)" },
			{ value: "America/Vancouver", label: "Pacific Time (Vancouver)" },
			{ value: "America/Mexico_City", label: "Central Time (Mexico City)" },
			{ value: "America/Sao_Paulo", label: "Brasilia Time (São Paulo)" },
			{ value: "America/Buenos_Aires", label: "Argentina Time (Buenos Aires)" },
		],
	},
	{
		region: "Europe",
		timezones: [
			{ value: "Europe/London", label: "GMT/BST (London)" },
			{ value: "Europe/Paris", label: "Central European Time (Paris)" },
			{ value: "Europe/Berlin", label: "Central European Time (Berlin)" },
			{ value: "Europe/Rome", label: "Central European Time (Rome)" },
			{ value: "Europe/Madrid", label: "Central European Time (Madrid)" },
			{ value: "Europe/Amsterdam", label: "Central European Time (Amsterdam)" },
			{ value: "Europe/Brussels", label: "Central European Time (Brussels)" },
			{ value: "Europe/Vienna", label: "Central European Time (Vienna)" },
			{ value: "Europe/Warsaw", label: "Central European Time (Warsaw)" },
			{ value: "Europe/Stockholm", label: "Central European Time (Stockholm)" },
			{ value: "Europe/Athens", label: "Eastern European Time (Athens)" },
			{ value: "Europe/Helsinki", label: "Eastern European Time (Helsinki)" },
			{ value: "Europe/Moscow", label: "Moscow Time (Moscow)" },
			{ value: "Europe/Istanbul", label: "Turkey Time (Istanbul)" },
		],
	},
	{
		region: "Asia",
		timezones: [
			{ value: "Asia/Dubai", label: "Gulf Standard Time (Dubai)" },
			{ value: "Asia/Kolkata", label: "India Standard Time (Kolkata)" },
			{ value: "Asia/Bangkok", label: "Indochina Time (Bangkok)" },
			{ value: "Asia/Singapore", label: "Singapore Time (Singapore)" },
			{ value: "Asia/Hong_Kong", label: "Hong Kong Time (Hong Kong)" },
			{ value: "Asia/Shanghai", label: "China Standard Time (Shanghai)" },
			{ value: "Asia/Tokyo", label: "Japan Standard Time (Tokyo)" },
			{ value: "Asia/Seoul", label: "Korea Standard Time (Seoul)" },
		],
	},
	{
		region: "Australia & Pacific",
		timezones: [
			{ value: "Australia/Sydney", label: "Australian Eastern Time (Sydney)" },
			{ value: "Australia/Melbourne", label: "Australian Eastern Time (Melbourne)" },
			{ value: "Australia/Brisbane", label: "Australian Eastern Time (Brisbane)" },
			{ value: "Australia/Perth", label: "Australian Western Time (Perth)" },
			{ value: "Pacific/Auckland", label: "New Zealand Time (Auckland)" },
		],
	},
	{
		region: "Africa",
		timezones: [
			{ value: "Africa/Cairo", label: "Eastern European Time (Cairo)" },
			{ value: "Africa/Johannesburg", label: "South Africa Time (Johannesburg)" },
			{ value: "Africa/Lagos", label: "West Africa Time (Lagos)" },
			{ value: "Africa/Nairobi", label: "East Africa Time (Nairobi)" },
		],
	},
	{
		region: "UTC/Other",
		timezones: [{ value: "UTC", label: "Coordinated Universal Time (UTC)" }],
	},
];

interface TimezonePickerProps {
	value?: string;
	onChange: (timezone: string) => void;
	disabled?: boolean;
}

export function TimezonePicker({ value = "UTC", onChange, disabled }: TimezonePickerProps) {
	const [open, setOpen] = React.useState(false);
	const listboxId = React.useId();

	// Get current timezone label
	const selectedLabel = React.useMemo(() => {
		for (const group of TIMEZONE_GROUPS) {
			const tz = group.timezones.find((t) => t.value === value);
			if (tz) return tz.label;
		}
		return value;
	}, [value]);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					aria-controls={listboxId}
					className="w-full justify-between"
					disabled={disabled}
				>
					<div className="flex items-center gap-2 truncate">
						<Globe className="h-4 w-4 shrink-0 opacity-50" />
						<span className="truncate">{selectedLabel}</span>
					</div>
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[400px] p-0" align="start">
				<Command>
					<CommandInput placeholder="Search timezone..." />
					<CommandEmpty>No timezone found.</CommandEmpty>
					<CommandList id={listboxId}>
						{TIMEZONE_GROUPS.map((group) => (
							<CommandGroup key={group.region} heading={group.region}>
								{group.timezones.map((tz) => (
									<CommandItem
										key={tz.value}
										value={tz.value}
										onSelect={(currentValue) => {
											onChange(currentValue);
											setOpen(false);
										}}
									>
										<Check
											className={cn(
												"mr-2 h-4 w-4",
												value === tz.value ? "opacity-100" : "opacity-0",
											)}
										/>
										{tz.label}
									</CommandItem>
								))}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
