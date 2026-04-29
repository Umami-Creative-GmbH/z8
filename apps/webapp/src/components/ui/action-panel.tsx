"use client";

import type * as React from "react";

import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const actionPanelSizes = {
	compact: "sm:max-w-md",
	default: "sm:max-w-xl",
	wide: "sm:max-w-2xl lg:max-w-3xl",
} as const;

type ActionPanelSize = keyof typeof actionPanelSizes;

function ActionPanel({ ...props }: React.ComponentProps<typeof Sheet>) {
	return <Sheet data-slot="action-panel" {...props} />;
}

function ActionPanelTrigger({ ...props }: React.ComponentProps<typeof SheetTrigger>) {
	return <SheetTrigger data-slot="action-panel-trigger" {...props} />;
}

function ActionPanelClose({ ...props }: React.ComponentProps<typeof SheetClose>) {
	return <SheetClose data-slot="action-panel-close" {...props} />;
}

function ActionPanelContent({
	className,
	children,
	size = "default",
	showCloseButton = true,
	...props
}: React.ComponentProps<typeof SheetContent> & {
	size?: ActionPanelSize;
	showCloseButton?: boolean;
}) {
	return (
		<SheetContent
			className={cn(
				"w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0 sm:w-3/4",
				actionPanelSizes[size],
				className,
			)}
			data-action-panel-hide-close={!showCloseButton ? "true" : undefined}
			data-slot="action-panel-content"
			side="right"
			{...props}
		>
			{children}
			{!showCloseButton && (
				<style>{'[data-action-panel-hide-close="true"] > button:last-child { display: none; }'}</style>
			)}
		</SheetContent>
	);
}

function ActionPanelHeader({ className, ...props }: React.ComponentProps<typeof SheetHeader>) {
	return (
		<SheetHeader
			className={cn("border-b px-6 py-5 pr-12 text-left", className)}
			data-slot="action-panel-header"
			{...props}
		/>
	);
}

function ActionPanelBody({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", className)}
			data-slot="action-panel-body"
			{...props}
		/>
	);
}

function ActionPanelFooter({ className, ...props }: React.ComponentProps<typeof SheetFooter>) {
	return (
		<SheetFooter
			className={cn("mt-0 border-t px-6 py-4 sm:flex-row sm:justify-end", className)}
			data-slot="action-panel-footer"
			{...props}
		/>
	);
}

function ActionPanelTitle({ className, ...props }: React.ComponentProps<typeof SheetTitle>) {
	return (
		<SheetTitle
			className={cn("text-lg font-semibold leading-none", className)}
			data-slot="action-panel-title"
			{...props}
		/>
	);
}

function ActionPanelDescription({
	className,
	...props
}: React.ComponentProps<typeof SheetDescription>) {
	return (
		<SheetDescription
			className={cn("text-sm text-muted-foreground", className)}
			data-slot="action-panel-description"
			{...props}
		/>
	);
}

export {
	ActionPanel,
	ActionPanelBody,
	ActionPanelClose,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
	ActionPanelTrigger,
};
