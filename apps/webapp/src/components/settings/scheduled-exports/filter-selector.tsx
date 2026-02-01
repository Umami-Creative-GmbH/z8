"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

export interface FilterItem {
	id: string;
	label: string;
	sublabel?: string;
}

interface FilterSelectorProps {
	label: string;
	items: FilterItem[];
	selectedIds: string[];
	onSelectionChange: (ids: string[]) => void;
	allLabel: string;
	selectedLabel: (count: number) => string;
	emptyMessage: string;
	clearLabel: string;
	/** Accessible name for the filter trigger button */
	ariaLabel?: string;
}

export function FilterSelector({
	label,
	items,
	selectedIds,
	onSelectionChange,
	allLabel,
	selectedLabel,
	emptyMessage,
	clearLabel,
	ariaLabel,
}: FilterSelectorProps) {
	const handleToggle = (id: string, checked: boolean) => {
		if (checked) {
			onSelectionChange([...selectedIds, id]);
		} else {
			onSelectionChange(selectedIds.filter((selectedId) => selectedId !== id));
		}
	};

	const handleClear = () => {
		onSelectionChange([]);
	};

	return (
		<div className="space-y-2">
			<Label className="text-sm text-muted-foreground">{label}</Label>
			<Popover>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						className="w-full justify-start"
						aria-label={ariaLabel || `Select ${label.toLowerCase()}`}
					>
						{selectedIds.length === 0 ? allLabel : selectedLabel(selectedIds.length)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-[300px] p-0" align="start">
					<ScrollArea className="h-[200px] p-4">
						{items.map((item) => (
							<div key={item.id} className="flex items-center space-x-2 py-1">
								<Checkbox
									id={`filter-${item.id}`}
									checked={selectedIds.includes(item.id)}
									onCheckedChange={(checked) => handleToggle(item.id, checked === true)}
									aria-describedby={item.sublabel ? `filter-${item.id}-sublabel` : undefined}
								/>
								<label htmlFor={`filter-${item.id}`} className="text-sm cursor-pointer">
									{item.label}
									{item.sublabel && (
										<span id={`filter-${item.id}-sublabel`} className="text-muted-foreground">
											{" "}
											({item.sublabel})
										</span>
									)}
								</label>
							</div>
						))}
						{items.length === 0 && (
							<p className="text-sm text-muted-foreground">{emptyMessage}</p>
						)}
					</ScrollArea>
					{selectedIds.length > 0 && (
						<div className="border-t p-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={handleClear}
								className="w-full"
								aria-label={`${clearLabel} for ${label.toLowerCase()}`}
							>
								{clearLabel}
							</Button>
						</div>
					)}
				</PopoverContent>
			</Popover>
		</div>
	);
}
