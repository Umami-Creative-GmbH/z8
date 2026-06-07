"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import type * as React from "react";

import { cn } from "@/lib/utils";

type SliderChangeDetails = Parameters<
	NonNullable<React.ComponentProps<typeof SliderPrimitive.Root>["onValueChange"]>
>[1];
type SliderCommitDetails = Parameters<
	NonNullable<React.ComponentProps<typeof SliderPrimitive.Root>["onValueCommitted"]>
>[1];
type SliderProps = Omit<
	React.ComponentProps<typeof SliderPrimitive.Root>,
	"defaultValue" | "onValueChange" | "onValueCommitted" | "value"
> & {
	value?: readonly number[];
	defaultValue?: readonly number[];
	onValueChange?: (value: number[], eventDetails: SliderChangeDetails) => void;
	onValueCommitted?: (value: number[], eventDetails: SliderCommitDetails) => void;
};

function Slider({
	className,
	defaultValue,
	value,
	min = 0,
	max = 100,
	onValueChange,
	onValueCommitted,
	...props
}: SliderProps) {
	const _values = Array.isArray(value)
		? value
		: Array.isArray(defaultValue)
			? defaultValue
			: [min, max];

	return (
		<SliderPrimitive.Root
			data-slot="slider"
			defaultValue={defaultValue}
			value={value}
			min={min}
			max={max}
			onValueChange={
				onValueChange
					? (nextValue, eventDetails) => {
							const values = Array.isArray(nextValue) ? [...nextValue] : [nextValue];
							onValueChange(values, eventDetails);
						}
					: undefined
			}
			onValueCommitted={
				onValueCommitted
					? (nextValue, eventDetails) => {
							const values = Array.isArray(nextValue) ? [...nextValue] : [nextValue];
							onValueCommitted(values, eventDetails);
						}
					: undefined
			}
			className={cn(
				"relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
				className,
			)}
			{...props}
		>
			<SliderPrimitive.Control
				data-slot="slider-control"
				className={cn(
					"relative flex w-full grow items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
				)}
			>
				<SliderPrimitive.Track
					data-slot="slider-track"
					className={cn(
						"bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5",
					)}
				>
					<SliderPrimitive.Indicator
						data-slot="slider-range"
						className={cn(
							"bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
						)}
					/>
				</SliderPrimitive.Track>
				{Array.from({ length: _values.length }, (_, index) => (
					<SliderPrimitive.Thumb
						data-slot="slider-thumb"
						index={index}
						// biome-ignore lint/suspicious/noArrayIndexKey: Thumb position is the stable Base UI identity; values can duplicate.
						key={index}
						className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
					/>
				))}
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	);
}

export { Slider };
