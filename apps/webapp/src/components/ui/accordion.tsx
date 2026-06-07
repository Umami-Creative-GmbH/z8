"use client";

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { IconChevronDown } from "@tabler/icons-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type BaseAccordionRootProps = Omit<
	ComponentProps<typeof AccordionPrimitive.Root>,
	"defaultValue" | "multiple" | "onValueChange" | "value"
>;

type AccordionSingleProps = BaseAccordionRootProps & {
	collapsible?: boolean;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	type?: "single";
	value?: string;
};

type AccordionMultipleProps = BaseAccordionRootProps & {
	collapsible?: boolean;
	defaultValue?: string[];
	onValueChange?: (value: string[]) => void;
	type: "multiple";
	value?: string[];
};

type AccordionProps = AccordionMultipleProps | AccordionSingleProps;
type BaseAccordionOnValueChange = NonNullable<
	ComponentProps<typeof AccordionPrimitive.Root>["onValueChange"]
>;

function Accordion({
	collapsible = false,
	defaultValue,
	onValueChange,
	type = "single",
	value,
	...props
}: AccordionProps) {
	const isMultiple = type === "multiple";
	const mappedValue = value === undefined ? undefined : Array.isArray(value) ? value : [value];
	const mappedDefaultValue =
		defaultValue === undefined
			? undefined
			: Array.isArray(defaultValue)
				? defaultValue
				: [defaultValue];
	const shouldPreventSingleCollapse = !isMultiple && collapsible === false;
	const handleValueChange: BaseAccordionOnValueChange = (nextValue, eventDetails) => {
		if (shouldPreventSingleCollapse && nextValue.length === 0) {
			eventDetails.cancel();
			return;
		}

		if (!onValueChange) {
			return;
		}

		if (isMultiple) {
			(onValueChange as (value: string[]) => void)(nextValue as string[]);
		} else {
			(onValueChange as (value: string) => void)(String(nextValue[0] ?? ""));
		}
	};

	return (
		<AccordionPrimitive.Root
			data-slot="accordion"
			defaultValue={mappedDefaultValue}
			multiple={isMultiple}
			onValueChange={onValueChange || shouldPreventSingleCollapse ? handleValueChange : undefined}
			value={mappedValue}
			{...props}
		/>
	);
}

function AccordionItem({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Item>) {
	return (
		<AccordionPrimitive.Item
			data-slot="accordion-item"
			className={cn("border-b last:border-b-0", className)}
			{...props}
		/>
	);
}

function AccordionTrigger({
	className,
	children,
	...props
}: ComponentProps<typeof AccordionPrimitive.Trigger>) {
	return (
		<AccordionPrimitive.Header className="flex">
			<AccordionPrimitive.Trigger
				data-slot="accordion-trigger"
				className={cn(
					"focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-[text-decoration-line] outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-panel-open]>svg]:rotate-180",
					className,
				)}
				{...props}
			>
				{children}
				<IconChevronDown
					aria-hidden="true"
					className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200"
				/>
			</AccordionPrimitive.Trigger>
		</AccordionPrimitive.Header>
	);
}

function AccordionContent({
	className,
	children,
	...props
}: ComponentProps<typeof AccordionPrimitive.Panel>) {
	return (
		<AccordionPrimitive.Panel
			data-slot="accordion-content"
			className="overflow-hidden text-sm data-closed:animate-accordion-up data-open:animate-accordion-down"
			{...props}
		>
			<div className={cn("pt-0 pb-4", className)}>{children}</div>
		</AccordionPrimitive.Panel>
	);
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
