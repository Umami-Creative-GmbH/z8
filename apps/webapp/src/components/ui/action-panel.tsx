"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import type * as React from "react";

import {
	Sheet,
	SheetClose,
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
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
	size?: ActionPanelSize;
	showCloseButton?: boolean;
}) {
	return (
		<DialogPrimitive.Portal data-slot="action-panel-portal">
			<DialogPrimitive.Overlay
				className="data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=open]:animate-in"
				data-slot="action-panel-overlay"
			/>
			<DialogPrimitive.Content
				className={cn(
					"fixed inset-y-0 right-0 z-50 flex h-full w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden border-l bg-background p-0 shadow-lg transition ease-in-out motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=open]:animate-in data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right data-[state=closed]:duration-300 data-[state=open]:duration-500 sm:w-3/4",
					actionPanelSizes[size],
					className,
				)}
				data-slot="action-panel-content"
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close className="absolute right-4 top-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
						<XIcon className="size-4" />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
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
