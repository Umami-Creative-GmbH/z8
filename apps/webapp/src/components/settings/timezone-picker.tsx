"use client";

import { useTranslate } from "@tolgee/react";
import { IconCheck, IconChevronsUpDown, IconWorld } from "@tabler/icons-react";
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
		region: "americas",
		timezones: [
			"America/New_York",
			"America/Chicago",
			"America/Denver",
			"America/Los_Angeles",
			"America/Anchorage",
			"Pacific/Honolulu",
			"America/Toronto",
			"America/Vancouver",
			"America/Mexico_City",
			"America/Sao_Paulo",
			"America/Buenos_Aires",
		],
	},
	{
		region: "europe",
		timezones: [
			"Europe/London",
			"Europe/Paris",
			"Europe/Berlin",
			"Europe/Rome",
			"Europe/Madrid",
			"Europe/Amsterdam",
			"Europe/Brussels",
			"Europe/Vienna",
			"Europe/Warsaw",
			"Europe/Stockholm",
			"Europe/Athens",
			"Europe/Helsinki",
			"Europe/Moscow",
			"Europe/Istanbul",
		],
	},
	{
		region: "asia",
		timezones: [
			"Asia/Dubai",
			"Asia/Kolkata",
			"Asia/Bangkok",
			"Asia/Singapore",
			"Asia/Hong_Kong",
			"Asia/Shanghai",
			"Asia/Tokyo",
			"Asia/Seoul",
		],
	},
	{
		region: "australiaPacific",
		timezones: [
			"Australia/Sydney",
			"Australia/Melbourne",
			"Australia/Brisbane",
			"Australia/Perth",
			"Pacific/Auckland",
		],
	},
	{
		region: "africa",
		timezones: ["Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos", "Africa/Nairobi"],
	},
	{
		region: "utcOther",
		timezones: ["UTC"],
	},
];

interface TimezonePickerProps {
	value?: string;
	onChange: (timezone: string) => void;
	disabled?: boolean;
}

export function TimezonePicker({ value = "UTC", onChange, disabled }: TimezonePickerProps) {
	const { t } = useTranslate();
	const [open, setOpen] = React.useState(false);
	const listboxId = React.useId();

	const getGroupHeading = (region: string) => {
		switch (region) {
			case "americas":
				return t("settings.timezone.picker.groups.americas", "Americas");
			case "europe":
				return t("settings.timezone.picker.groups.europe", "Europe");
			case "asia":
				return t("settings.timezone.picker.groups.asia", "Asia");
			case "australiaPacific":
				return t("settings.timezone.picker.groups.australiaPacific", "Australia & Pacific");
			case "africa":
				return t("settings.timezone.picker.groups.africa", "Africa");
			case "utcOther":
				return t("settings.timezone.picker.groups.utcOther", "UTC/Other");
			default:
				return region;
		}
	};

	const getTimezoneLabel = (timezone: string) => {
		switch (timezone) {
			case "America/New_York":
				return t("settings.timezone.picker.labels.americaNewYork", "Eastern Time (New York)");
			case "America/Chicago":
				return t("settings.timezone.picker.labels.americaChicago", "Central Time (Chicago)");
			case "America/Denver":
				return t("settings.timezone.picker.labels.americaDenver", "Mountain Time (Denver)");
			case "America/Los_Angeles":
				return t("settings.timezone.picker.labels.americaLosAngeles", "Pacific Time (Los Angeles)");
			case "America/Anchorage":
				return t("settings.timezone.picker.labels.americaAnchorage", "Alaska Time (Anchorage)");
			case "Pacific/Honolulu":
				return t("settings.timezone.picker.labels.pacificHonolulu", "Hawaii Time (Honolulu)");
			case "America/Toronto":
				return t("settings.timezone.picker.labels.americaToronto", "Eastern Time (Toronto)");
			case "America/Vancouver":
				return t("settings.timezone.picker.labels.americaVancouver", "Pacific Time (Vancouver)");
			case "America/Mexico_City":
				return t("settings.timezone.picker.labels.americaMexicoCity", "Central Time (Mexico City)");
			case "America/Sao_Paulo":
				return t("settings.timezone.picker.labels.americaSaoPaulo", "Brasilia Time (São Paulo)");
			case "America/Buenos_Aires":
				return t(
					"settings.timezone.picker.labels.americaBuenosAires",
					"Argentina Time (Buenos Aires)",
				);
			case "Europe/London":
				return t("settings.timezone.picker.labels.europeLondon", "GMT/BST (London)");
			case "Europe/Paris":
				return t("settings.timezone.picker.labels.europeParis", "Central European Time (Paris)");
			case "Europe/Berlin":
				return t("settings.timezone.picker.labels.europeBerlin", "Central European Time (Berlin)");
			case "Europe/Rome":
				return t("settings.timezone.picker.labels.europeRome", "Central European Time (Rome)");
			case "Europe/Madrid":
				return t("settings.timezone.picker.labels.europeMadrid", "Central European Time (Madrid)");
			case "Europe/Amsterdam":
				return t(
					"settings.timezone.picker.labels.europeAmsterdam",
					"Central European Time (Amsterdam)",
				);
			case "Europe/Brussels":
				return t(
					"settings.timezone.picker.labels.europeBrussels",
					"Central European Time (Brussels)",
				);
			case "Europe/Vienna":
				return t("settings.timezone.picker.labels.europeVienna", "Central European Time (Vienna)");
			case "Europe/Warsaw":
				return t("settings.timezone.picker.labels.europeWarsaw", "Central European Time (Warsaw)");
			case "Europe/Stockholm":
				return t(
					"settings.timezone.picker.labels.europeStockholm",
					"Central European Time (Stockholm)",
				);
			case "Europe/Athens":
				return t("settings.timezone.picker.labels.europeAthens", "Eastern European Time (Athens)");
			case "Europe/Helsinki":
				return t(
					"settings.timezone.picker.labels.europeHelsinki",
					"Eastern European Time (Helsinki)",
				);
			case "Europe/Moscow":
				return t("settings.timezone.picker.labels.europeMoscow", "Moscow Time (Moscow)");
			case "Europe/Istanbul":
				return t("settings.timezone.picker.labels.europeIstanbul", "Turkey Time (Istanbul)");
			case "Asia/Dubai":
				return t("settings.timezone.picker.labels.asiaDubai", "Gulf Standard Time (Dubai)");
			case "Asia/Kolkata":
				return t("settings.timezone.picker.labels.asiaKolkata", "India Standard Time (Kolkata)");
			case "Asia/Bangkok":
				return t("settings.timezone.picker.labels.asiaBangkok", "Indochina Time (Bangkok)");
			case "Asia/Singapore":
				return t("settings.timezone.picker.labels.asiaSingapore", "Singapore Time (Singapore)");
			case "Asia/Hong_Kong":
				return t("settings.timezone.picker.labels.asiaHongKong", "Hong Kong Time (Hong Kong)");
			case "Asia/Shanghai":
				return t("settings.timezone.picker.labels.asiaShanghai", "China Standard Time (Shanghai)");
			case "Asia/Tokyo":
				return t("settings.timezone.picker.labels.asiaTokyo", "Japan Standard Time (Tokyo)");
			case "Asia/Seoul":
				return t("settings.timezone.picker.labels.asiaSeoul", "Korea Standard Time (Seoul)");
			case "Australia/Sydney":
				return t(
					"settings.timezone.picker.labels.australiaSydney",
					"Australian Eastern Time (Sydney)",
				);
			case "Australia/Melbourne":
				return t(
					"settings.timezone.picker.labels.australiaMelbourne",
					"Australian Eastern Time (Melbourne)",
				);
			case "Australia/Brisbane":
				return t(
					"settings.timezone.picker.labels.australiaBrisbane",
					"Australian Eastern Time (Brisbane)",
				);
			case "Australia/Perth":
				return t(
					"settings.timezone.picker.labels.australiaPerth",
					"Australian Western Time (Perth)",
				);
			case "Pacific/Auckland":
				return t("settings.timezone.picker.labels.pacificAuckland", "New Zealand Time (Auckland)");
			case "Africa/Cairo":
				return t("settings.timezone.picker.labels.africaCairo", "Eastern European Time (Cairo)");
			case "Africa/Johannesburg":
				return t(
					"settings.timezone.picker.labels.africaJohannesburg",
					"South Africa Time (Johannesburg)",
				);
			case "Africa/Lagos":
				return t("settings.timezone.picker.labels.africaLagos", "West Africa Time (Lagos)");
			case "Africa/Nairobi":
				return t("settings.timezone.picker.labels.africaNairobi", "East Africa Time (Nairobi)");
			case "UTC":
				return t("settings.timezone.picker.labels.utc", "Coordinated Universal Time (UTC)");
			default:
				return timezone;
		}
	};

	const selectedLabel = getTimezoneLabel(value);

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
						<IconWorld className="h-4 w-4 shrink-0 opacity-50" />
						<span className="truncate">{selectedLabel}</span>
					</div>
					<IconChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[400px] p-0" align="start">
				<Command>
					<CommandInput placeholder={t("settings.timezone.picker.search", "IconSearch timezone…")} />
					<CommandEmpty>{t("settings.timezone.picker.empty", "No timezone found.")}</CommandEmpty>
					<CommandList id={listboxId}>
						{TIMEZONE_GROUPS.map((group) => (
							<CommandGroup key={group.region} heading={getGroupHeading(group.region)}>
								{group.timezones.map((timezone) => (
									<CommandItem
										key={timezone}
										value={timezone}
										onSelect={(currentValue) => {
											onChange(currentValue);
											setOpen(false);
										}}
									>
										<IconCheck
											className={cn(
												"mr-2 h-4 w-4",
												value === timezone ? "opacity-100" : "opacity-0",
											)}
										/>
										{getTimezoneLabel(timezone)}
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
