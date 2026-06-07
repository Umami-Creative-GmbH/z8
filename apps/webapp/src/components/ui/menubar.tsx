"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar";
import { IconCheck, IconChevronRight, IconCircleFilled } from "@tabler/icons-react";
import type * as React from "react";

import { getAsChildNativeButton, getAsChildRender } from "@/components/ui/base-ui-compat";
import { cn } from "@/lib/utils";

type MenubarContentProps = MenuPrimitive.Popup.Props &
	Pick<
		MenuPrimitive.Positioner.Props,
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

function Menubar({ className, ...props }: React.ComponentProps<typeof MenubarPrimitive>) {
	return (
		<MenubarPrimitive
			className={cn(
				"bg-background flex h-9 items-center gap-1 rounded-md border p-1 shadow-xs",
				className,
			)}
			data-slot="menubar"
			{...props}
		/>
	);
}

function MenubarMenu({ ...props }: MenuPrimitive.Root.Props) {
	return <MenuPrimitive.Root data-slot="menubar-menu" {...props} />;
}

function MenubarGroup({ ...props }: MenuPrimitive.Group.Props) {
	return <MenuPrimitive.Group data-slot="menubar-group" {...props} />;
}

function MenubarPortal({ ...props }: MenuPrimitive.Portal.Props) {
	return <MenuPrimitive.Portal data-slot="menubar-portal" {...props} />;
}

function MenubarRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
	return <MenuPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />;
}

function MenubarTrigger({
	asChild,
	children,
	className,
	nativeButton,
	render,
	...props
}: MenuPrimitive.Trigger.Props & { asChild?: boolean }) {
	return (
		<MenuPrimitive.Trigger
			className={cn(
				"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground flex items-center rounded-sm px-2 py-1 text-sm font-medium outline-hidden select-none",
				className,
			)}
			data-slot="menubar-trigger"
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</MenuPrimitive.Trigger>
	);
}

function MenubarContent({
	align = "start",
	alignOffset = -4,
	anchor,
	arrowPadding,
	className,
	collisionAvoidance,
	collisionBoundary,
	collisionPadding,
	disableAnchorTracking,
	positionMethod,
	side,
	sideOffset = 8,
	sticky,
	...props
}: MenubarContentProps) {
	return (
		<MenubarPortal>
			<MenuPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				anchor={anchor}
				arrowPadding={arrowPadding}
				collisionAvoidance={collisionAvoidance}
				collisionBoundary={collisionBoundary}
				collisionPadding={collisionPadding}
				data-slot="menubar-positioner"
				disableAnchorTracking={disableAnchorTracking}
				positionMethod={positionMethod}
				side={side}
				sideOffset={sideOffset}
				sticky={sticky}
			>
				<MenuPrimitive.Popup
					className={cn(
						"bg-popover text-popover-foreground motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[12rem] origin-(--transform-origin) overflow-hidden rounded-md border p-1 shadow-md outline-hidden",
						className,
					)}
					data-slot="menubar-content"
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenubarPortal>
	);
}

function MenubarItem({
	className,
	inset,
	variant = "default",
	...props
}: MenuPrimitive.Item.Props & {
	inset?: boolean;
	variant?: "default" | "destructive";
}) {
	return (
		<MenuPrimitive.Item
			className={cn(
				"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 dark:data-[variant=destructive]:data-[highlighted]:bg-destructive/20 data-[variant=destructive]:data-[highlighted]:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			data-inset={inset}
			data-slot="menubar-item"
			data-variant={variant}
			{...props}
		/>
	);
}

function MenubarCheckboxItem({
	className,
	children,
	checked,
	...props
}: MenuPrimitive.CheckboxItem.Props) {
	return (
		<MenuPrimitive.CheckboxItem
			checked={checked}
			className={cn(
				"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-xs py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			data-slot="menubar-checkbox-item"
			{...props}
		>
			<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
				<MenuPrimitive.CheckboxItemIndicator>
					<IconCheck className="size-4" />
				</MenuPrimitive.CheckboxItemIndicator>
			</span>
			{children}
		</MenuPrimitive.CheckboxItem>
	);
}

function MenubarRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
	return (
		<MenuPrimitive.RadioItem
			className={cn(
				"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-xs py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			data-slot="menubar-radio-item"
			{...props}
		>
			<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
				<MenuPrimitive.RadioItemIndicator>
					<IconCircleFilled className="size-2 fill-current" />
				</MenuPrimitive.RadioItemIndicator>
			</span>
			{children}
		</MenuPrimitive.RadioItem>
	);
}

function MenubarLabel({
	className,
	inset,
	...props
}: MenuPrimitive.GroupLabel.Props & {
	inset?: boolean;
}) {
	return (
		<MenuPrimitive.GroupLabel
			className={cn("px-2 py-1.5 text-sm font-medium data-[inset]:pl-8", className)}
			data-inset={inset}
			data-slot="menubar-label"
			{...props}
		/>
	);
}

function MenubarSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
	return (
		<MenuPrimitive.Separator
			className={cn("bg-border -mx-1 my-1 h-px", className)}
			data-slot="menubar-separator"
			{...props}
		/>
	);
}

function MenubarShortcut({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			className={cn("text-muted-foreground ml-auto text-xs tracking-widest", className)}
			data-slot="menubar-shortcut"
			{...props}
		/>
	);
}

function MenubarSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
	return <MenuPrimitive.SubmenuRoot data-slot="menubar-sub" {...props} />;
}

function MenubarSubTrigger({
	className,
	inset,
	children,
	...props
}: MenuPrimitive.SubmenuTrigger.Props & {
	inset?: boolean;
}) {
	return (
		<MenuPrimitive.SubmenuTrigger
			className={cn(
				"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[inset]:pl-8",
				className,
			)}
			data-inset={inset}
			data-slot="menubar-sub-trigger"
			{...props}
		>
			{children}
			<IconChevronRight className="ml-auto size-4" />
		</MenuPrimitive.SubmenuTrigger>
	);
}

function MenubarSubContent({
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
}: MenubarContentProps) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				anchor={anchor}
				arrowPadding={arrowPadding}
				collisionAvoidance={collisionAvoidance}
				collisionBoundary={collisionBoundary}
				collisionPadding={collisionPadding}
				data-slot="menubar-sub-positioner"
				disableAnchorTracking={disableAnchorTracking}
				positionMethod={positionMethod}
				side={side}
				sideOffset={sideOffset}
				sticky={sticky}
			>
				<MenuPrimitive.Popup
					className={cn(
						"bg-popover text-popover-foreground motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--transform-origin) overflow-hidden rounded-md border p-1 shadow-lg outline-hidden",
						className,
					)}
					data-slot="menubar-sub-content"
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

export {
	Menubar,
	MenubarCheckboxItem,
	MenubarContent,
	MenubarGroup,
	MenubarItem,
	MenubarLabel,
	MenubarMenu,
	MenubarPortal,
	MenubarRadioGroup,
	MenubarRadioItem,
	MenubarSeparator,
	MenubarShortcut,
	MenubarSub,
	MenubarSubContent,
	MenubarSubTrigger,
	MenubarTrigger,
};
