"use client";

import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu";
import { IconChevronDown } from "@tabler/icons-react";
import { cva } from "class-variance-authority";
import type * as React from "react";

import { getAsChildNativeButton, getAsChildRender } from "@/components/ui/base-ui-compat";
import { cn } from "@/lib/utils";

function NavigationMenu({
	className,
	children,
	viewport = true,
	...props
}: NavigationMenuPrimitive.Root.Props & {
	viewport?: boolean;
}) {
	return (
		<NavigationMenuPrimitive.Root
			className={cn(
				"group/navigation-menu relative flex max-w-max flex-1 items-center justify-center",
				className,
			)}
			data-slot="navigation-menu"
			data-viewport={viewport}
			{...props}
		>
			{children}
			{viewport && <NavigationMenuViewport />}
		</NavigationMenuPrimitive.Root>
	);
}

function NavigationMenuList({ className, ...props }: NavigationMenuPrimitive.List.Props) {
	return (
		<NavigationMenuPrimitive.List
			className={cn("group flex flex-1 list-none items-center justify-center gap-1", className)}
			data-slot="navigation-menu-list"
			{...props}
		/>
	);
}

function NavigationMenuItem({ className, ...props }: NavigationMenuPrimitive.Item.Props) {
	return (
		<NavigationMenuPrimitive.Item
			className={cn("relative", className)}
			data-slot="navigation-menu-item"
			{...props}
		/>
	);
}

const navigationMenuTriggerStyle = cva(
	"group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:hover:bg-accent data-[popup-open]:text-accent-foreground data-[popup-open]:focus:bg-accent data-[popup-open]:bg-accent/50 focus-visible:ring-ring/50 outline-none transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1",
);

function NavigationMenuTrigger({
	asChild,
	className,
	children,
	nativeButton,
	render,
	...props
}: NavigationMenuPrimitive.Trigger.Props & { asChild?: boolean }) {
	return (
		<NavigationMenuPrimitive.Trigger
			className={cn(navigationMenuTriggerStyle(), "group", className)}
			data-slot="navigation-menu-trigger"
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
			{asChild ? null : " "}
			{asChild ? null : (
				<IconChevronDown
					aria-hidden="true"
					className="relative top-[1px] ml-1 size-3 transition duration-300 group-data-[popup-open]:rotate-180"
				/>
			)}
		</NavigationMenuPrimitive.Trigger>
	);
}

function NavigationMenuContent({ className, ...props }: NavigationMenuPrimitive.Content.Props) {
	return (
		<NavigationMenuPrimitive.Content
			className={cn(
				"data-[activation-direction=right]:animate-in data-[activation-direction=left]:animate-in data-[ending-style]:animate-out data-[starting-style]:fade-in data-[ending-style]:fade-out data-[activation-direction=right]:slide-in-from-right-52 data-[activation-direction=left]:slide-in-from-left-52 top-0 left-0 w-full p-2 pr-2.5 md:absolute md:w-auto **:data-[slot=navigation-menu-link]:focus:ring-0 **:data-[slot=navigation-menu-link]:focus:outline-none",
				className,
			)}
			data-slot="navigation-menu-content"
			{...props}
		/>
	);
}

function NavigationMenuViewport({ className, ...props }: NavigationMenuPrimitive.Viewport.Props) {
	return (
		<NavigationMenuPrimitive.Portal>
			<NavigationMenuPrimitive.Positioner
				className="absolute top-full left-0 isolate z-50 flex justify-center"
				data-slot="navigation-menu-positioner"
				sideOffset={6}
			>
				<NavigationMenuPrimitive.Popup
					className="origin-(--transform-origin) bg-popover text-popover-foreground motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-90 relative overflow-hidden rounded-md border shadow outline-hidden"
					data-slot="navigation-menu-popup"
				>
					<NavigationMenuPrimitive.Viewport
						className={cn("relative w-full overflow-hidden md:w-(--anchor-width)", className)}
						data-slot="navigation-menu-viewport"
						{...props}
					/>
				</NavigationMenuPrimitive.Popup>
			</NavigationMenuPrimitive.Positioner>
		</NavigationMenuPrimitive.Portal>
	);
}

function NavigationMenuLink({
	asChild,
	className,
	children,
	render,
	...props
}: NavigationMenuPrimitive.Link.Props & { asChild?: boolean }) {
	return (
		<NavigationMenuPrimitive.Link
			className={cn(
				"data-[active]:focus:bg-accent data-[active]:hover:bg-accent data-[active]:bg-accent/50 data-[active]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:ring-ring/50 [&_svg:not([class*='text-'])]:text-muted-foreground flex flex-col gap-1 rounded-sm p-2 text-sm transition-[color,background-color] outline-none focus-visible:ring-[3px] focus-visible:outline-1 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			data-slot="navigation-menu-link"
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</NavigationMenuPrimitive.Link>
	);
}

function NavigationMenuIndicator({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden",
				className,
			)}
			data-slot="navigation-menu-indicator"
			{...props}
		>
			<div className="bg-border relative top-[60%] size-2 rotate-45 rounded-tl-sm shadow-md" />
		</div>
	);
}

export {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuIndicator,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
	NavigationMenuViewport,
};
