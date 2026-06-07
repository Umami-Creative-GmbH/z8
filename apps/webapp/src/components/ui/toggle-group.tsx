"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";
import { toggleVariants } from "@/components/ui/toggle-variants";
import { cn } from "@/lib/utils";

type ToggleGroupChangeDetails = Parameters<
	NonNullable<React.ComponentProps<typeof ToggleGroupPrimitive>["onValueChange"]>
>[1];
type ToggleGroupBaseProps = Omit<
	React.ComponentProps<typeof ToggleGroupPrimitive>,
	"defaultValue" | "multiple" | "onValueChange" | "value"
>;
type ToggleGroupSingleProps = {
	type?: "single";
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string, eventDetails: ToggleGroupChangeDetails) => void;
};
type ToggleGroupMultipleProps = {
	type: "multiple";
	value?: readonly string[];
	defaultValue?: readonly string[];
	onValueChange?: (value: string[], eventDetails: ToggleGroupChangeDetails) => void;
};
type ToggleGroupProps = ToggleGroupBaseProps &
	VariantProps<typeof toggleVariants> &
	(ToggleGroupSingleProps | ToggleGroupMultipleProps);

const ToggleGroupContext = React.createContext<
	VariantProps<typeof toggleVariants> & { type: "multiple" | "single" }
>({
	size: "default",
	type: "single",
	variant: "default",
});

function ToggleGroup({
	className,
	variant,
	size,
	children,
	type = "single",
	value,
	defaultValue,
	onValueChange,
	role,
	...props
}: ToggleGroupProps) {
	const isMultiple = type === "multiple";
	const baseValue =
		value === undefined ? undefined : Array.isArray(value) ? value : value ? [value] : [];
	const baseDefaultValue =
		defaultValue === undefined
			? undefined
			: Array.isArray(defaultValue)
				? defaultValue
				: defaultValue
					? [defaultValue]
					: [];

	return (
		<ToggleGroupPrimitive
			className={cn(
				"group/toggle-group flex w-fit items-center rounded-md data-[variant=outline]:shadow-xs",
				className,
			)}
			defaultValue={baseDefaultValue}
			data-size={size}
			data-slot="toggle-group"
			data-variant={variant}
			multiple={isMultiple}
			onValueChange={(nextValue, eventDetails) => {
				if (isMultiple) {
					(onValueChange as ToggleGroupMultipleProps["onValueChange"] | undefined)?.(
						nextValue,
						eventDetails,
					);
					return;
				}

				(onValueChange as ToggleGroupSingleProps["onValueChange"] | undefined)?.(
					nextValue[0] ?? "",
					eventDetails,
				);
			}}
			role={isMultiple ? role : "radiogroup"}
			value={baseValue}
			{...props}
		>
			<ToggleGroupContext.Provider value={{ variant, size, type }}>
				{children}
			</ToggleGroupContext.Provider>
		</ToggleGroupPrimitive>
	);
}

function ToggleGroupItem({
	className,
	children,
	variant,
	size,
	render,
	...props
}: React.ComponentProps<typeof TogglePrimitive> & VariantProps<typeof toggleVariants>) {
	const context = React.use(ToggleGroupContext);
	const renderItem =
		render ??
		((buttonProps, state) => {
			if (context.type !== "single") {
				return <button {...buttonProps} type="button" />;
			}
			const { "aria-pressed": _ariaPressed, ...radioProps } = buttonProps;

			return <button {...radioProps} aria-checked={state.pressed} role="radio" type="button" />;
		});

	return (
		<TogglePrimitive
			className={cn(
				toggleVariants({
					variant: context.variant || variant,
					size: context.size || size,
				}),
				"min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l",
				className,
			)}
			data-size={context.size || size}
			data-slot="toggle-group-item"
			data-variant={context.variant || variant}
			render={renderItem}
			{...props}
		>
			{children}
		</TogglePrimitive>
	);
}

export { ToggleGroup, ToggleGroupItem };
