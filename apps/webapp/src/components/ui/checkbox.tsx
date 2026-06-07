"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { IconCheck } from "@tabler/icons-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

type CheckboxProps = Omit<
	React.ComponentProps<typeof CheckboxPrimitive.Root>,
	"checked" | "defaultChecked" | "indeterminate"
> & {
	checked?: boolean | "indeterminate";
	defaultChecked?: boolean | "indeterminate";
	indeterminate?: boolean;
};

function Checkbox({ className, checked, defaultChecked, indeterminate, ...props }: CheckboxProps) {
	const isIndeterminate =
		indeterminate || checked === "indeterminate" || defaultChecked === "indeterminate";

	return (
		<CheckboxPrimitive.Root
			checked={checked === "indeterminate" ? false : checked}
			className={cn(
				"peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:bg-input/30 dark:data-checked:bg-primary dark:aria-invalid:ring-destructive/40",
				className,
			)}
			data-slot="checkbox"
			defaultChecked={defaultChecked === "indeterminate" ? false : defaultChecked}
			indeterminate={isIndeterminate}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				className="flex items-center justify-center text-current transition-none"
				data-slot="checkbox-indicator"
			>
				<IconCheck className="size-3.5" />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
