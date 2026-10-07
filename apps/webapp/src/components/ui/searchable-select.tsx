"use client";

import { IconCheck, IconSelector } from "@tabler/icons-react";
import { useId, useState } from "react";
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
	id?: string;
	"aria-invalid"?: boolean;
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
	id,
	"aria-invalid": ariaInvalid,
}: SearchableSelectProps) {
	const [open, setOpen] = useState(false);
	const listboxId = useId();
	const selectedOption = options.find((opt) => opt.code === value);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					variant="field"
					role="combobox"
					aria-expanded={open}
					aria-controls={listboxId}
					aria-invalid={ariaInvalid || undefined}
					className={cn("w-full", className)}
					data-placeholder={selectedOption ? undefined : ""}
					disabled={disabled}
				>
					<span className="truncate">{selectedOption ? selectedOption.name : placeholder}</span>
					<IconSelector className="ml-2 size-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-(--anchor-width) p-0" align="start">
				<Command defaultValue={selectedOption?.name}>
					<CommandInput placeholder={searchPlaceholder} />
					<CommandList id={listboxId}>
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
										className={cn("mr-2 size-4", value === "" ? "opacity-100" : "opacity-0")}
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
											"mr-2 size-4",
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
