"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import * as React from "react";

import {
	cancelDismissIfPrevented,
	type DismissEventHandlers,
	getAsChildNativeButton,
	getAsChildRender,
} from "@/components/ui/base-ui-compat";
import { cn } from "@/lib/utils";

const SheetDismissContext = React.createContext<React.RefObject<DismissEventHandlers> | null>(null);

type SheetProps = Omit<SheetPrimitive.Root.Props, "children"> & {
	children?: React.ReactNode;
	"data-slot"?: string;
};

type SheetContentProps = SheetPrimitive.Popup.Props & {
	onEscapeKeyDown?: (event: KeyboardEvent) => void;
	onInteractOutside?: (event: Event) => void;
	onPointerDownOutside?: (event: PointerEvent) => void;
	side?: "top" | "right" | "bottom" | "left";
	showCloseButton?: boolean;
};

function Sheet({ children, onOpenChange, ...props }: SheetProps) {
	const dismissHandlersRef = React.useRef<DismissEventHandlers>({});
	const handleOpenChange: SheetPrimitive.Root.Props["onOpenChange"] = (open, eventDetails) => {
		if (cancelDismissIfPrevented(open, eventDetails, dismissHandlersRef.current)) {
			return;
		}

		onOpenChange?.(open, eventDetails);
	};

	return (
		<SheetDismissContext value={dismissHandlersRef}>
			<SheetPrimitive.Root data-slot="sheet" onOpenChange={handleOpenChange} {...props}>
				{children}
			</SheetPrimitive.Root>
		</SheetDismissContext>
	);
}

function SheetTrigger({
	asChild,
	children,
	nativeButton,
	render,
	...props
}: SheetPrimitive.Trigger.Props & { asChild?: boolean }) {
	return (
		<SheetPrimitive.Trigger
			data-slot="sheet-trigger"
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</SheetPrimitive.Trigger>
	);
}

function SheetClose({
	asChild,
	children,
	nativeButton,
	render,
	...props
}: SheetPrimitive.Close.Props & { asChild?: boolean }) {
	return (
		<SheetPrimitive.Close
			data-slot="sheet-close"
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</SheetPrimitive.Close>
	);
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
	return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
	return (
		<SheetPrimitive.Backdrop
			className={cn(
				"data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 fixed inset-0 z-50 bg-black/50 motion-safe:data-[ending-style]:animate-out motion-safe:data-[starting-style]:animate-in",
				className,
			)}
			data-slot="sheet-overlay"
			{...props}
		/>
	);
}

function SheetContent({
	className,
	children,
	onEscapeKeyDown,
	onInteractOutside,
	onPointerDownOutside,
	side = "right",
	showCloseButton = true,
	...props
}: SheetContentProps) {
	const dismissHandlersRef = React.useContext(SheetDismissContext);

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
		<SheetPortal>
			<SheetOverlay />
			<SheetPrimitive.Popup
				className={cn(
					"fixed z-50 flex flex-col gap-4 bg-muted shadow-lg transition ease-in-out motion-safe:data-[ending-style]:animate-out motion-safe:data-[starting-style]:animate-in data-[ending-style]:duration-200 data-[starting-style]:duration-300 [&_[data-slot=tabs-list]]:bg-border/40",
					side === "right" &&
						"data-[ending-style]:slide-out-to-right-full data-[starting-style]:slide-in-from-right-full inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
					side === "left" &&
						"data-[ending-style]:slide-out-to-left-full data-[starting-style]:slide-in-from-left-full inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
					side === "top" &&
						"data-[ending-style]:slide-out-to-top-full data-[starting-style]:slide-in-from-top-full inset-x-0 top-0 h-auto border-b",
					side === "bottom" &&
						"data-[ending-style]:slide-out-to-bottom-full data-[starting-style]:slide-in-from-bottom-full inset-x-0 bottom-0 h-auto border-t",
					className,
				)}
				data-slot="sheet-content"
				{...props}
			>
				{children}
				{showCloseButton && (
					<SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[open]:bg-secondary">
						<IconX className="size-4" />
						<span className="sr-only">Close</span>
					</SheetPrimitive.Close>
				)}
			</SheetPrimitive.Popup>
		</SheetPortal>
	);
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("flex flex-col gap-1.5 p-4", className)}
			data-slot="sheet-header"
			{...props}
		/>
	);
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("mt-auto flex flex-col gap-2 p-4", className)}
			data-slot="sheet-footer"
			{...props}
		/>
	);
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
	return (
		<SheetPrimitive.Title
			className={cn("font-semibold text-foreground", className)}
			data-slot="sheet-title"
			{...props}
		/>
	);
}

function SheetDescription({
	asChild,
	children,
	className,
	render,
	...props
}: SheetPrimitive.Description.Props & { asChild?: boolean }) {
	return (
		<SheetPrimitive.Description
			className={cn("text-muted-foreground text-sm", className)}
			data-slot="sheet-description"
			render={getAsChildRender(asChild, children, render)}
			{...props}
		>
			{asChild ? null : children}
		</SheetPrimitive.Description>
	);
}

export {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
};
