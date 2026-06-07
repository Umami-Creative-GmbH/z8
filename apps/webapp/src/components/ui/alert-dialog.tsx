"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type * as React from "react";
import { getAsChildNativeButton, getAsChildRender } from "@/components/ui/base-ui-compat";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

type AlertDialogProps = Omit<AlertDialogPrimitive.Root.Props, "children"> & {
	children?: React.ReactNode;
	"data-slot"?: string;
};

type AlertDialogContentProps = AlertDialogPrimitive.Popup.Props & {
	onEscapeKeyDown?: (event: KeyboardEvent) => void;
	onInteractOutside?: (event: Event) => void;
	onPointerDownOutside?: (event: PointerEvent) => void;
};

function AlertDialog({ ...props }: AlertDialogProps) {
	return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({
	asChild,
	children,
	nativeButton,
	render,
	...props
}: AlertDialogPrimitive.Trigger.Props & { asChild?: boolean }) {
	return (
		<AlertDialogPrimitive.Trigger
			data-slot="alert-dialog-trigger"
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</AlertDialogPrimitive.Trigger>
	);
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
	return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
	return (
		<AlertDialogPrimitive.Backdrop
			data-slot="alert-dialog-overlay"
			className={cn(
				"motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 fixed inset-0 z-50 bg-black/50",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogContent({
	className,
	onEscapeKeyDown: _onEscapeKeyDown,
	onInteractOutside: _onInteractOutside,
	onPointerDownOutside: _onPointerDownOutside,
	...props
}: AlertDialogContentProps) {
	return (
		<AlertDialogPortal>
			<AlertDialogOverlay />
			<AlertDialogPrimitive.Popup
				data-slot="alert-dialog-content"
				className={cn(
					"bg-background motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
					className,
				)}
				{...props}
			/>
		</AlertDialogPortal>
	);
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-header"
			className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
			{...props}
		/>
	);
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-footer"
			className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
			{...props}
		/>
	);
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
	return (
		<AlertDialogPrimitive.Title
			data-slot="alert-dialog-title"
			className={cn("text-lg font-semibold", className)}
			{...props}
		/>
	);
}

function AlertDialogDescription({
	asChild,
	children,
	className,
	render,
	...props
}: AlertDialogPrimitive.Description.Props & { asChild?: boolean }) {
	return (
		<AlertDialogPrimitive.Description
			data-slot="alert-dialog-description"
			className={cn("text-muted-foreground text-sm", className)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</AlertDialogPrimitive.Description>
	);
}

function AlertDialogAction({
	asChild,
	className,
	children,
	nativeButton,
	render,
	...props
}: AlertDialogPrimitive.Close.Props & { asChild?: boolean }) {
	return (
		<AlertDialogPrimitive.Close
			className={cn(buttonVariants(), className)}
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</AlertDialogPrimitive.Close>
	);
}

function AlertDialogCancel({
	asChild,
	className,
	children,
	nativeButton,
	render,
	...props
}: AlertDialogPrimitive.Close.Props & { asChild?: boolean }) {
	return (
		<AlertDialogPrimitive.Close
			className={cn(buttonVariants({ variant: "outline" }), className)}
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</AlertDialogPrimitive.Close>
	);
}

export {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	AlertDialogPortal,
	AlertDialogTitle,
	AlertDialogTrigger,
};
