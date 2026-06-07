"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import * as React from "react";
import { use } from "react";

import {
	cancelDismissIfPrevented,
	type DismissEventHandlers,
	getAsChildNativeButton,
	getAsChildRender,
} from "@/components/ui/base-ui-compat";
import { cn } from "@/lib/utils";

const DialogDismissContext = React.createContext<React.RefObject<DismissEventHandlers> | null>(
	null,
);

type DialogProps = Omit<DialogPrimitive.Root.Props, "children"> & {
	children?: React.ReactNode;
	"data-slot"?: string;
};

type DialogContentProps = DialogPrimitive.Popup.Props & {
	onEscapeKeyDown?: (event: KeyboardEvent) => void;
	onInteractOutside?: (event: Event) => void;
	onPointerDownOutside?: (event: PointerEvent) => void;
	showCloseButton?: boolean;
};

function Dialog({ children, onOpenChange, ...props }: DialogProps) {
	const dismissHandlersRef = React.useRef<DismissEventHandlers>({});
	const handleOpenChange: DialogPrimitive.Root.Props["onOpenChange"] = (open, eventDetails) => {
		if (cancelDismissIfPrevented(open, eventDetails, dismissHandlersRef.current)) {
			return;
		}

		onOpenChange?.(open, eventDetails);
	};

	return (
		<DialogDismissContext value={dismissHandlersRef}>
			<DialogPrimitive.Root data-slot="dialog" onOpenChange={handleOpenChange} {...props}>
				{children}
			</DialogPrimitive.Root>
		</DialogDismissContext>
	);
}

function DialogTrigger({
	asChild,
	children,
	nativeButton,
	render,
	...props
}: DialogPrimitive.Trigger.Props & { asChild?: boolean }) {
	return (
		<DialogPrimitive.Trigger
			data-slot="dialog-trigger"
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</DialogPrimitive.Trigger>
	);
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
	asChild,
	children,
	nativeButton,
	render,
	...props
}: DialogPrimitive.Close.Props & { asChild?: boolean }) {
	return (
		<DialogPrimitive.Close
			data-slot="dialog-close"
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</DialogPrimitive.Close>
	);
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			data-slot="dialog-overlay"
			className={cn(
				"motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 fixed inset-0 z-50 bg-black/50",
				className,
			)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	onEscapeKeyDown,
	onInteractOutside,
	onPointerDownOutside,
	showCloseButton = true,
	...props
}: DialogContentProps) {
	const dismissHandlersRef = use(DialogDismissContext);

	React.useEffect(() => {
		if (!dismissHandlersRef) {
			return;
		}

		const handlers = { onEscapeKeyDown, onInteractOutside, onPointerDownOutside };
		dismissHandlersRef.current = handlers;

		return () => {
			if (dismissHandlersRef.current === handlers) {
				dismissHandlersRef.current = {};
			}
		};
	}, [dismissHandlersRef, onEscapeKeyDown, onInteractOutside, onPointerDownOutside]);

	return (
		<DialogPortal data-slot="dialog-portal">
			<DialogOverlay />
			<DialogPrimitive.Popup
				data-slot="dialog-content"
				className={cn(
					"bg-background motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 outline-none sm:max-w-lg",
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close
						data-slot="dialog-close"
						className="ring-offset-background focus:ring-ring data-[open]:bg-accent data-[open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
					>
						<IconX />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Popup>
		</DialogPortal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-header"
			className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
			{...props}
		/>
	);
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("text-lg leading-none font-semibold", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	asChild,
	children,
	className,
	render,
	...props
}: DialogPrimitive.Description.Props & { asChild?: boolean }) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn("text-muted-foreground text-sm", className)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</DialogPrimitive.Description>
	);
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
