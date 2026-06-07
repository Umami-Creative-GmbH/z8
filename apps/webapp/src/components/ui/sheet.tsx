"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
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

type SheetSide = "top" | "right" | "bottom" | "left";

const SHEET_CLOSE_DURATION_MS = 200;

type SheetContextValue = {
	dismissHandlersRef: React.RefObject<DismissEventHandlers>;
	visualOpen: boolean;
};

const SheetContext = React.createContext<SheetContextValue | null>(null);

type SheetProps = Omit<SheetPrimitive.Root.Props, "children"> & {
	children?: React.ReactNode;
	"data-slot"?: string;
};

type SheetContentProps = SheetPrimitive.Popup.Props & {
	onEscapeKeyDown?: (event: KeyboardEvent) => void;
	onInteractOutside?: (event: Event) => void;
	onPointerDownOutside?: (event: PointerEvent) => void;
	side?: SheetSide;
	showCloseButton?: boolean;
};

function Sheet({
	children,
	onOpenChange,
	open: openProp,
	defaultOpen,
	modal = "trap-focus",
	...props
}: SheetProps) {
	const dismissHandlersRef = React.useRef<DismissEventHandlers>({});
	const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
	const targetOpen = openProp ?? uncontrolledOpen;
	const [renderedOpen, setRenderedOpen] = React.useState(targetOpen);
	const [visualOpen, setVisualOpen] = React.useState(targetOpen);

	React.useEffect(() => {
		if (targetOpen) {
			setRenderedOpen(true);

			const frame = requestAnimationFrame(() => setVisualOpen(true));

			return () => cancelAnimationFrame(frame);
		}

		setVisualOpen(false);

		const timeout = window.setTimeout(() => {
			setRenderedOpen(false);
		}, SHEET_CLOSE_DURATION_MS);

		return () => window.clearTimeout(timeout);
	}, [targetOpen]);

	const handleOpenChange: SheetPrimitive.Root.Props["onOpenChange"] = (open, eventDetails) => {
		if (cancelDismissIfPrevented(open, eventDetails, dismissHandlersRef.current)) {
			return;
		}

		if (openProp === undefined) {
			setUncontrolledOpen(open);
		}

		onOpenChange?.(open, eventDetails);
	};
	const context = React.useMemo(() => ({ dismissHandlersRef, visualOpen }), [visualOpen]);

	return (
		<SheetContext.Provider value={context}>
			<SheetPrimitive.Root
				data-slot="sheet"
				modal={modal}
				onOpenChange={handleOpenChange}
				open={renderedOpen}
				{...props}
			>
				{children}
			</SheetPrimitive.Root>
		</SheetContext.Provider>
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
	const context = use(SheetContext);

	return (
		<SheetPrimitive.Backdrop
			className={cn(
				"fixed inset-0 z-50 bg-black/50 opacity-0 transition-opacity duration-200 ease-out data-[sheet-open=false]:pointer-events-none data-[sheet-open=true]:opacity-100 motion-reduce:transition-none",
				className,
			)}
			data-sheet-open={String(context?.visualOpen ?? false)}
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
	const context = use(SheetContext);
	const dismissHandlersRef = context?.dismissHandlersRef;

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
					"fixed z-50 flex flex-col gap-4 bg-muted shadow-lg transition-transform duration-200 ease-in-out data-[sheet-open=true]:duration-300 data-[sheet-open=true]:ease-out motion-reduce:transition-none [&_[data-slot=tabs-list]]:bg-border/40",
					side === "right" &&
						"inset-y-0 right-0 h-full w-3/4 translate-x-full border-l data-[sheet-open=true]:translate-x-0 sm:max-w-sm",
					side === "left" &&
						"inset-y-0 left-0 h-full w-3/4 -translate-x-full border-r data-[sheet-open=true]:translate-x-0 sm:max-w-sm",
					side === "top" &&
						"inset-x-0 top-0 h-auto -translate-y-full border-b data-[sheet-open=true]:translate-y-0",
					side === "bottom" &&
						"inset-x-0 bottom-0 h-auto translate-y-full border-t data-[sheet-open=true]:translate-y-0",
					className,
				)}
				data-sheet-open={String(context?.visualOpen ?? false)}
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
