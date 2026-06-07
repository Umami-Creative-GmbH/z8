"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type SelectContentProps = SelectPrimitive.Popup.Props &
	Pick<
		SelectPrimitive.Positioner.Props,
		| "align"
		| "alignItemWithTrigger"
		| "alignOffset"
		| "anchor"
		| "arrowPadding"
		| "collisionAvoidance"
		| "collisionBoundary"
		| "collisionPadding"
		| "disableAnchorTracking"
		| "positionMethod"
		| "side"
		| "sideOffset"
		| "sticky"
	> & {
		position?: "item-aligned" | "popper";
	};

type SelectProps<Value = string, Multiple extends boolean | undefined = false> = Omit<
	SelectPrimitive.Root.Props<Value, Multiple>,
	"onValueChange"
> & {
	onValueChange?: BivariantSelectValueChangeHandler<SelectValueChangeValue<Value, Multiple>>;
};

type SelectNonNullChangeProps<Value = string, Multiple extends boolean | undefined = false> = Omit<
	SelectPrimitive.Root.Props<Value, Multiple>,
	"onValueChange"
> & {
	onValueChange?: BivariantSelectValueChangeHandler<
		Multiple extends true ? SelectValueChangeValue<Value, Multiple> : Value
	>;
};

type SelectValueChangeValue<Value, Multiple extends boolean | undefined> = Multiple extends true
	? Value[]
	: Value | null;

type BivariantSelectValueChangeHandler<Value> = {
	bivarianceHack(value: Value, eventDetails: SelectPrimitive.Root.ChangeEventDetails): void;
}["bivarianceHack"];

function collectSelectItems(children: React.ReactNode) {
	const items: Array<{ label: React.ReactNode; value: unknown }> = [];

	React.Children.forEach(children, (child) => {
		if (!React.isValidElement(child)) {
			return;
		}

		const childProps = child.props as { children?: React.ReactNode; value?: unknown };

		if (child.type === SelectItem && "value" in childProps) {
			items.push({ label: childProps.children, value: childProps.value });
		}

		if (childProps.children) {
			items.push(...collectSelectItems(childProps.children));
		}
	});

	return items;
}

function Select<Value = string, Multiple extends boolean | undefined = false>(
	props: SelectNonNullChangeProps<Value, Multiple>,
): React.JSX.Element;
function Select<Value = string, Multiple extends boolean | undefined = false>(
	props: SelectProps<Value, Multiple>,
): React.JSX.Element;
function Select<Value = string, Multiple extends boolean | undefined = false>({
	children,
	items,
	...props
}: SelectProps<Value, Multiple> | SelectNonNullChangeProps<Value, Multiple>) {
	const collectedItems = items ? [] : collectSelectItems(children);
	const rootProps = props as SelectPrimitive.Root.Props<Value, Multiple>;

	return (
		<SelectPrimitive.Root
			data-slot="select"
			items={items ?? (collectedItems.length > 0 ? collectedItems : undefined)}
			{...rootProps}
		>
			{children}
		</SelectPrimitive.Root>
	);
}

function SelectGroup({ ...props }: SelectPrimitive.Group.Props) {
	return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({ ...props }: SelectPrimitive.Value.Props) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
	className,
	size = "default",
	children,
	...props
}: SelectPrimitive.Trigger.Props & {
	size?: "sm" | "default";
}) {
	return (
		<SelectPrimitive.Trigger
			className={cn(
				"flex w-fit items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[size=default]:h-9 data-[size=sm]:h-8 data-[placeholder]:text-muted-foreground *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:hover:bg-input/50 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			data-size={size}
			data-slot="select-trigger"
			{...props}
		>
			{children}
			<SelectPrimitive.Icon>
				<IconChevronDown className="size-4 opacity-50" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	align,
	alignItemWithTrigger,
	alignOffset,
	anchor,
	arrowPadding,
	className,
	children,
	collisionAvoidance,
	collisionBoundary,
	collisionPadding,
	disableAnchorTracking,
	position = "popper",
	positionMethod,
	side,
	sideOffset,
	sticky,
	...props
}: SelectContentProps) {
	const shouldAlignItemWithTrigger = alignItemWithTrigger ?? position !== "popper";

	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner
				align={align}
				alignItemWithTrigger={shouldAlignItemWithTrigger}
				alignOffset={alignOffset}
				anchor={anchor}
				arrowPadding={arrowPadding}
				collisionAvoidance={collisionAvoidance}
				collisionBoundary={collisionBoundary}
				collisionPadding={collisionPadding}
				data-slot="select-positioner"
				disableAnchorTracking={disableAnchorTracking}
				positionMethod={positionMethod}
				side={side}
				sideOffset={sideOffset}
				sticky={sticky}
			>
				<SelectPrimitive.Popup
					className={cn(
						"motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-hidden",
						position === "popper" &&
							"data-[side=left]:-translate-x-1 data-[side=top]:-translate-y-1 data-[side=right]:translate-x-1 data-[side=bottom]:translate-y-1",
						className,
					)}
					data-slot="select-content"
					{...props}
				>
					<SelectScrollUpButton />
					<SelectPrimitive.List
						className={cn(
							"p-1",
							position === "popper" && "w-full min-w-(--anchor-width) scroll-my-1",
						)}
					>
						{children}
					</SelectPrimitive.List>
					<SelectScrollDownButton />
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
	return (
		<SelectPrimitive.GroupLabel
			className={cn("px-2 py-1.5 text-muted-foreground text-xs", className)}
			data-slot="select-label"
			{...props}
		/>
	);
}

type PreventableBaseUIEvent = React.SyntheticEvent & {
	baseUIHandlerPrevented?: boolean;
};

function maybePrimeClickOnlySelection(event: React.MouseEvent<HTMLElement>) {
	const nativeEvent = event.nativeEvent as MouseEvent & { pointerType?: string };

	if (
		nativeEvent.isTrusted ||
		nativeEvent.detail !== 0 ||
		nativeEvent.pointerType !== undefined ||
		(event as PreventableBaseUIEvent).baseUIHandlerPrevented
	) {
		return;
	}

	const eventWindow = event.currentTarget.ownerDocument.defaultView;
	const PointerEventCtor = eventWindow?.PointerEvent;
	const MouseEventCtor = eventWindow?.MouseEvent;

	if (PointerEventCtor) {
		event.currentTarget.dispatchEvent(
			new PointerEventCtor("pointerdown", {
				bubbles: true,
				button: 0,
				buttons: 1,
				cancelable: true,
				pointerType: "mouse",
			}),
		);
		return;
	}

	if (MouseEventCtor) {
		event.currentTarget.dispatchEvent(
			new MouseEventCtor("pointerdown", {
				bubbles: true,
				button: 0,
				buttons: 1,
				cancelable: true,
			}),
		);
	}
}

function SelectItem({ className, children, onClick, ...props }: SelectPrimitive.Item.Props) {
	return (
		<SelectPrimitive.Item
			className={cn(
				"relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
				className,
			)}
			data-slot="select-item"
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) {
					maybePrimeClickOnlySelection(event);
				}
			}}
			{...props}
		>
			<span className="absolute right-2 flex size-3.5 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<IconCheck className="size-4" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
	return (
		<SelectPrimitive.Separator
			className={cn("-mx-1 pointer-events-none my-1 h-px bg-border", className)}
			data-slot="select-separator"
			{...props}
		/>
	);
}

function SelectScrollUpButton({ className, ...props }: SelectPrimitive.ScrollUpArrow.Props) {
	return (
		<SelectPrimitive.ScrollUpArrow
			className={cn("flex cursor-default items-center justify-center py-1", className)}
			data-slot="select-scroll-up-button"
			{...props}
		>
			<IconChevronUp className="size-4" />
		</SelectPrimitive.ScrollUpArrow>
	);
}

function SelectScrollDownButton({ className, ...props }: SelectPrimitive.ScrollDownArrow.Props) {
	return (
		<SelectPrimitive.ScrollDownArrow
			className={cn("flex cursor-default items-center justify-center py-1", className)}
			data-slot="select-scroll-down-button"
			{...props}
		>
			<IconChevronDown className="size-4" />
		</SelectPrimitive.ScrollDownArrow>
	);
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
