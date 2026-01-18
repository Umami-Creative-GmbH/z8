"use client";

import { IconCheck, IconSelector } from "@tabler/icons-react";
import { useState } from "react";
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

export interface SearchableSelectOption {
	code: string;
	name: string;
}

export interface SearchableSelectProps {
	options: SearchableSelectOption[];
	value: string;
	onValueChange: (value: string) => void;
	placeholder: string;
	searchPlaceholder: string;
	emptyText: string;
	disabled?: boolean;
	allowEmpty?: boolean;
	emptyLabel?: string;
	className?: string;
}

export function SearchableSelect({
	options,
	value,
	onValueChange,
	placeholder,
	searchPlaceholder,
	emptyText,
	disabled,
	allowEmpty,
	emptyLabel,
	className,
}: SearchableSelectProps) {
	const [open, setOpen] = useState(false);
	const selectedOption = options.find((opt) => opt.code === value);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className={cn("w-full justify-between font-normal", className)}
					disabled={disabled}
				>
					{selectedOption ? selectedOption.name : placeholder}
					<IconSelector className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
				<Command>
					<CommandInput placeholder={searchPlaceholder} />
					<CommandList>
						<CommandEmpty>{emptyText}</CommandEmpty>
						<CommandGroup>
							{allowEmpty && (
								<CommandItem
									value=""
									onSelect={() => {
										onValueChange("");
										setOpen(false);
									}}
								>
									<IconCheck
										className={cn("mr-2 h-4 w-4", value === "" ? "opacity-100" : "opacity-0")}
									/>
									{emptyLabel}
								</CommandItem>
							)}
							{options.map((option) => (
								<CommandItem
									key={option.code}
									value={option.name}
									onSelect={() => {
										onValueChange(option.code);
										setOpen(false);
									}}
								>
									<IconCheck
										className={cn(
											"mr-2 h-4 w-4",
											value === option.code ? "opacity-100" : "opacity-0",
										)}
									/>
									{option.name}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
