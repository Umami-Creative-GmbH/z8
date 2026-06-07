"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import * as React from "react";

import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
	return (
		<TabsPrimitive.Root
			className={cn("flex flex-col gap-2", className)}
			data-slot="tabs"
			{...props}
		/>
	);
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
	return (
		<TabsPrimitive.List
			className={cn(
				"inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted-foreground/5 p-[3px] text-muted-foreground",
				className,
			)}
			data-slot="tabs-list"
			{...props}
		/>
	);
}

type TabsTriggerProps = React.ComponentProps<typeof TabsPrimitive.Tab> & { asChild?: boolean };
type PreventableMouseEvent = React.MouseEvent<HTMLElement> & {
	baseUIHandlerPrevented?: boolean;
	preventBaseUIHandler?: () => void;
};

function TabsTrigger({
	asChild,
	children,
	className,
	disabled,
	nativeButton,
	onClick,
	onMouseDown,
	render,
	...props
}: TabsTriggerProps) {
	const suppressNextClickRef = React.useRef(false);
	const baseRender = asChild && React.isValidElement(children) ? children : render;
	const activateOnMouseDown = !asChild && nativeButton !== false;

	function handleClick(event: PreventableMouseEvent) {
		if (suppressNextClickRef.current) {
			suppressNextClickRef.current = false;
			event.preventBaseUIHandler?.();
			return;
		}

		onClick?.(event as Parameters<NonNullable<TabsTriggerProps["onClick"]>>[0]);
	}

	function handleMouseDown(event: PreventableMouseEvent) {
		onMouseDown?.(event as Parameters<NonNullable<TabsTriggerProps["onMouseDown"]>>[0]);

		if (
			!activateOnMouseDown ||
			disabled ||
			event.defaultPrevented ||
			event.baseUIHandlerPrevented ||
			event.button !== 0 ||
			event.ctrlKey
		) {
			return;
		}

		event.currentTarget.click();
		suppressNextClickRef.current = true;
	}

	return (
		<TabsPrimitive.Tab
			className={cn(
				"inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-1 font-medium text-foreground text-sm transition-[color,box-shadow] focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-active:bg-card data-active:shadow-sm dark:text-muted-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			data-slot="tabs-trigger"
			disabled={disabled}
			nativeButton={asChild ? false : nativeButton}
			onClick={handleClick}
			onMouseDown={handleMouseDown}
			render={baseRender}
			{...props}
		>
			{asChild ? null : children}
		</TabsPrimitive.Tab>
	);
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Panel>) {
	return (
		<TabsPrimitive.Panel
			className={cn("flex-1 outline-none", className)}
			data-slot="tabs-content"
			{...props}
		/>
	);
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
