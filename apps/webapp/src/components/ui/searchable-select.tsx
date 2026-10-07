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
	CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
	code: string;
	name: string;
	/** More words the search matches besides the name, such as a currency code. */
	keywords?: string[];
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
	"aria-label"?: string;
	"aria-labelledby"?: string;
	"aria-describedby"?: string;
	/** Options shown above the searchable list, whatever is typed. */
	pinnedOptions?: SearchableSelectOption[];
	/** Called when the list opens or closes, e.g. to mark a form field touched. */
	onOpenChange?: (open: boolean) => void;
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
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledBy,
	"aria-describedby": ariaDescribedBy,
	pinnedOptions,
	onOpenChange,
}: SearchableSelectProps) {
	const [open, setOpen] = useState(false);
	const listboxId = useId();
	const selectedOption =
		pinnedOptions?.find((opt) => opt.code === value) ?? options.find((opt) => opt.code === value);

	const changeOpen = (next: boolean) => {
		setOpen(next);
		onOpenChange?.(next);
	};

	const renderOption = (option: SearchableSelectOption, pinned: boolean) => (
		<CommandItem
			key={option.code}
			value={option.name}
			keywords={option.keywords}
			forceMount={pinned || undefined}
			onSelect={() => {
				onValueChange(option.code);
				changeOpen(false);
			}}
		>
			<IconCheck
				className={cn("mr-2 size-4", value === option.code ? "opacity-100" : "opacity-0")}
			/>
			{option.name}
		</CommandItem>
	);

	return (
		<Popover open={open} onOpenChange={changeOpen}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					variant="field"
					role="combobox"
					aria-expanded={open}
					aria-controls={listboxId}
					aria-invalid={ariaInvalid || undefined}
					aria-label={ariaLabel}
					aria-labelledby={ariaLabelledBy}
					aria-describedby={ariaDescribedBy}
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
						{pinnedOptions && pinnedOptions.length > 0 && (
							<>
								<CommandGroup forceMount>
									{pinnedOptions.map((option) => renderOption(option, true))}
								</CommandGroup>
								<CommandSeparator alwaysRender />
							</>
						)}
						<CommandGroup>
							{allowEmpty && (
								<CommandItem
									value=""
									onSelect={() => {
										onValueChange("");
										changeOpen(false);
									}}
								>
									<IconCheck
										className={cn("mr-2 size-4", value === "" ? "opacity-100" : "opacity-0")}
									/>
									{emptyLabel}
								</CommandItem>
							)}
							{options.map((option) => renderOption(option, false))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
