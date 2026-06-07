"use client";

import { Menu as DropdownMenuPrimitive } from "@base-ui/react/menu";
import { IconCheck, IconChevronRight, IconCircleFilled } from "@tabler/icons-react";
import * as React from "react";

import { getAsChildNativeButton, getAsChildRender } from "@/components/ui/base-ui-compat";
import { cn } from "@/lib/utils";

type DropdownMenuContentProps = DropdownMenuPrimitive.Popup.Props &
	Pick<
		DropdownMenuPrimitive.Positioner.Props,
		| "align"
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
	>;

type DropdownMenuSelectEvent = React.SyntheticEvent<HTMLElement> & {
	preventBaseUIHandler?: () => void;
};

type BaseUIPreventableEvent = React.SyntheticEvent<HTMLElement> & {
	baseUIHandlerPrevented?: boolean;
	preventBaseUIHandler?: () => void;
};

type DropdownMenuTriggerPointerDownEvent = Parameters<
	NonNullable<DropdownMenuPrimitive.Trigger.Props["onPointerDown"]>
>[0];
type DropdownMenuTriggerMouseDownEvent = Parameters<
	NonNullable<DropdownMenuPrimitive.Trigger.Props["onMouseDown"]>
>[0];
type DropdownMenuTriggerClickEvent = Parameters<
	NonNullable<DropdownMenuPrimitive.Trigger.Props["onClick"]>
>[0];

type DropdownMenuItemProps = Omit<DropdownMenuPrimitive.Item.Props, "onClick"> & {
	asChild?: boolean;
	inset?: boolean;
	onClick?: DropdownMenuPrimitive.Item.Props["onClick"];
	onSelect?: (event: DropdownMenuSelectEvent) => void;
	variant?: "default" | "destructive";
};

function DropdownMenu({ ...props }: DropdownMenuPrimitive.Root.Props) {
	return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({ ...props }: DropdownMenuPrimitive.Portal.Props) {
	return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({
	asChild,
	children,
	disabled,
	nativeButton,
	onClick,
	onMouseDown,
	onPointerDown,
	render,
	...props
}: DropdownMenuPrimitive.Trigger.Props & { asChild?: boolean }) {
	const dispatchingPointerMouseDownRef = React.useRef(false);
	const dispatchingPointerClickRef = React.useRef(false);
	const skipNextMouseDownRef = React.useRef(false);
	const skipNextClickRef = React.useRef(false);

	const handlePointerDown: React.PointerEventHandler<HTMLElement> = (event) => {
		onPointerDown?.(event as DropdownMenuTriggerPointerDownEvent);

		if (event.defaultPrevented || disabled || event.button !== 0 || event.ctrlKey) {
			return;
		}

		const element = event.currentTarget;
		const MouseEventCtor = element.ownerDocument.defaultView?.MouseEvent ?? MouseEvent;
		const mouseDownEvent = new MouseEventCtor("mousedown", {
			altKey: event.altKey,
			bubbles: true,
			button: event.button,
			buttons: event.buttons,
			cancelable: true,
			clientX: event.clientX,
			clientY: event.clientY,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			screenX: event.screenX,
			screenY: event.screenY,
			shiftKey: event.shiftKey,
		});

		dispatchingPointerMouseDownRef.current = true;
		element.dispatchEvent(mouseDownEvent);
		dispatchingPointerMouseDownRef.current = false;

		const clickEvent = new MouseEventCtor("click", {
			altKey: event.altKey,
			bubbles: true,
			button: event.button,
			buttons: event.buttons,
			cancelable: true,
			clientX: event.clientX,
			clientY: event.clientY,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			screenX: event.screenX,
			screenY: event.screenY,
			shiftKey: event.shiftKey,
		});

		dispatchingPointerClickRef.current = true;
		element.dispatchEvent(clickEvent);
		dispatchingPointerClickRef.current = false;

		skipNextMouseDownRef.current = true;
		skipNextClickRef.current = true;
		event.preventDefault();
		element.ownerDocument.defaultView?.setTimeout(() => {
			skipNextMouseDownRef.current = false;
			skipNextClickRef.current = false;
		}, 0);
	};

	const handleMouseDown: React.MouseEventHandler<HTMLElement> = (event) => {
		if (skipNextMouseDownRef.current && !dispatchingPointerMouseDownRef.current) {
			skipNextMouseDownRef.current = false;
			event.preventDefault();
			(event as BaseUIPreventableEvent).preventBaseUIHandler?.();
			return;
		}

		onMouseDown?.(event as DropdownMenuTriggerMouseDownEvent);
	};

	const handleClick: React.MouseEventHandler<HTMLElement> = (event) => {
		if (skipNextClickRef.current && !dispatchingPointerClickRef.current) {
			skipNextClickRef.current = false;
			event.preventDefault();
			(event as BaseUIPreventableEvent).preventBaseUIHandler?.();
			return;
		}

		if (dispatchingPointerClickRef.current) {
			return;
		}

		onClick?.(event as DropdownMenuTriggerClickEvent);
	};

	return (
		<DropdownMenuPrimitive.Trigger
			data-slot="dropdown-menu-trigger"
			disabled={disabled}
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			onClick={handleClick}
			onMouseDown={handleMouseDown}
			onPointerDown={handlePointerDown}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</DropdownMenuPrimitive.Trigger>
	);
}

function DropdownMenuContent({
	align,
	alignOffset,
	anchor,
	arrowPadding,
	className,
	collisionAvoidance,
	collisionBoundary,
	collisionPadding,
	disableAnchorTracking,
	positionMethod,
	side,
	sideOffset = 4,
	sticky,
	...props
}: DropdownMenuContentProps) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				anchor={anchor}
				arrowPadding={arrowPadding}
				collisionAvoidance={collisionAvoidance}
				collisionBoundary={collisionBoundary}
				collisionPadding={collisionPadding}
				data-slot="dropdown-menu-positioner"
				disableAnchorTracking={disableAnchorTracking}
				positionMethod={positionMethod}
				side={side}
				sideOffset={sideOffset}
				sticky={sticky}
			>
				<DropdownMenuPrimitive.Popup
					className={cn(
						"motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-hidden",
						className,
					)}
					data-slot="dropdown-menu-content"
					{...props}
				/>
			</DropdownMenuPrimitive.Positioner>
		</DropdownMenuPrimitive.Portal>
	);
}

function DropdownMenuGroup({ ...props }: DropdownMenuPrimitive.Group.Props) {
	return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
	asChild,
	children,
	className,
	disabled,
	inset,
	nativeButton,
	onClick,
	onSelect,
	render,
	variant = "default",
	...props
}: DropdownMenuItemProps) {
	const resolvedNativeButton = getAsChildNativeButton(asChild, children, nativeButton);
	const preserveNativeDisabled = asChild && resolvedNativeButton && disabled;

	const handleClick: DropdownMenuPrimitive.Item.Props["onClick"] = (event) => {
		onClick?.(event);
		onSelect?.(event as DropdownMenuSelectEvent);

		if (event.defaultPrevented) {
			(event as DropdownMenuSelectEvent).preventBaseUIHandler?.();
		}
	};

	return (
		<DropdownMenuPrimitive.Item
			className={cn(
				"data-[variant=destructive]:*:[svg]:!text-destructive relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[disabled]:opacity-50 data-[variant=destructive]:data-[highlighted]:bg-destructive/10 data-[variant=destructive]:data-[highlighted]:text-destructive dark:data-[variant=destructive]:data-[highlighted]:bg-destructive/20 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			aria-disabled={disabled ? true : undefined}
			data-inset={inset}
			data-disabled={disabled ? "" : undefined}
			data-slot="dropdown-menu-item"
			data-variant={variant}
			disabled={preserveNativeDisabled ? undefined : disabled}
			nativeButton={resolvedNativeButton}
			onClick={onClick || onSelect ? handleClick : undefined}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</DropdownMenuPrimitive.Item>
	);
}

function DropdownMenuCheckboxItem({
	className,
	children,
	checked,
	...props
}: DropdownMenuPrimitive.CheckboxItem.Props) {
	return (
		<DropdownMenuPrimitive.CheckboxItem
			checked={checked}
			className={cn(
				"relative flex cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			data-slot="dropdown-menu-checkbox-item"
			{...props}
		>
			<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
				<DropdownMenuPrimitive.CheckboxItemIndicator>
					<IconCheck className="size-4" />
				</DropdownMenuPrimitive.CheckboxItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.CheckboxItem>
	);
}

function DropdownMenuRadioGroup({ ...props }: DropdownMenuPrimitive.RadioGroup.Props) {
	return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
	className,
	children,
	...props
}: DropdownMenuPrimitive.RadioItem.Props) {
	return (
		<DropdownMenuPrimitive.RadioItem
			className={cn(
				"relative flex cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			data-slot="dropdown-menu-radio-item"
			{...props}
		>
			<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
				<DropdownMenuPrimitive.RadioItemIndicator>
					<IconCircleFilled className="size-2 fill-current" />
				</DropdownMenuPrimitive.RadioItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.RadioItem>
	);
}

function DropdownMenuLabel({
	className,
	inset,
	...props
}: React.ComponentProps<"div"> & {
	inset?: boolean;
}) {
	return (
		<div
			className={cn("px-2 py-1.5 font-medium text-sm data-[inset]:pl-8", className)}
			data-inset={inset}
			data-slot="dropdown-menu-label"
			{...props}
		/>
	);
}

function DropdownMenuSeparator({ className, ...props }: DropdownMenuPrimitive.Separator.Props) {
	return (
		<DropdownMenuPrimitive.Separator
			className={cn("-mx-1 my-1 h-px bg-border", className)}
			data-slot="dropdown-menu-separator"
			{...props}
		/>
	);
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			className={cn("ml-auto text-muted-foreground text-xs tracking-widest", className)}
			data-slot="dropdown-menu-shortcut"
			{...props}
		/>
	);
}

function DropdownMenuSub({ ...props }: DropdownMenuPrimitive.SubmenuRoot.Props) {
	return <DropdownMenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
	className,
	inset,
	children,
	...props
}: DropdownMenuPrimitive.SubmenuTrigger.Props & {
	inset?: boolean;
}) {
	return (
		<DropdownMenuPrimitive.SubmenuTrigger
			className={cn(
				"flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[popup-open]:bg-accent data-[inset]:pl-8 data-[popup-open]:text-accent-foreground",
				className,
			)}
			data-inset={inset}
			data-slot="dropdown-menu-sub-trigger"
			{...props}
		>
			{children}
			<IconChevronRight className="ml-auto size-4" />
		</DropdownMenuPrimitive.SubmenuTrigger>
	);
}

function DropdownMenuSubContent({
	align,
	alignOffset,
	anchor,
	arrowPadding,
	className,
	collisionAvoidance,
	collisionBoundary,
	collisionPadding,
	disableAnchorTracking,
	positionMethod,
	side,
	sideOffset,
	sticky,
	...props
}: DropdownMenuContentProps) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				anchor={anchor}
				arrowPadding={arrowPadding}
				collisionAvoidance={collisionAvoidance}
				collisionBoundary={collisionBoundary}
				collisionPadding={collisionPadding}
				data-slot="dropdown-menu-sub-positioner"
				disableAnchorTracking={disableAnchorTracking}
				positionMethod={positionMethod}
				side={side}
				sideOffset={sideOffset}
				sticky={sticky}
			>
				<DropdownMenuPrimitive.Popup
					className={cn(
						"motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--transform-origin) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-hidden",
						className,
					)}
					data-slot="dropdown-menu-sub-content"
					{...props}
				/>
			</DropdownMenuPrimitive.Positioner>
		</DropdownMenuPrimitive.Portal>
	);
}

export {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
};
