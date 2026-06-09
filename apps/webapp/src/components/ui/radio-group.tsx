"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { IconCircleFilled } from "@tabler/icons-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

type RadioGroupChangeDetails = Parameters<
	NonNullable<React.ComponentProps<typeof RadioGroupPrimitive>["onValueChange"]>
>[1];
type RadioGroupProps = Omit<
	React.ComponentProps<typeof RadioGroupPrimitive>,
	"defaultValue" | "onValueChange" | "value"
> & {
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string, eventDetails: RadioGroupChangeDetails) => void;
};

function RadioGroup({ className, ...props }: RadioGroupProps) {
	return (
		<RadioGroupPrimitive
			data-slot="radio-group"
			className={cn("grid gap-3", className)}
			{...props}
		/>
	);
}

function RadioGroupItem({
	className,
	render,
	...props
}: React.ComponentProps<typeof RadioPrimitive.Root>) {
	return (
		<RadioPrimitive.Root
			data-slot="radio-group-item"
			className={cn(
				"border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 inline-flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			nativeButton={render ? undefined : true}
			render={render ?? ((buttonProps) => <button {...buttonProps} type="button" />)}
			{...props}
		>
			<RadioPrimitive.Indicator
				data-slot="radio-group-indicator"
				className="flex items-center justify-center"
			>
				<IconCircleFilled className="size-2 fill-primary" />
			</RadioPrimitive.Indicator>
		</RadioPrimitive.Root>
	);
}

export { RadioGroup, RadioGroupItem };
