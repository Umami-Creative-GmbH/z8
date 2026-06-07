"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { IconSearch, IconX } from "@tabler/icons-react";
import { Command as CommandPrimitive } from "cmdk";
import * as React from "react";
import { Dialog, DialogDescription, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const COMMAND_DIALOG_CLOSE_DURATION_MS = 160;

type CommandDialogAnimationState = {
	renderedOpen: boolean;
	visualOpen: boolean;
};

type CommandDialogAnimationAction =
	| { type: "open-start" }
	| { type: "close-start" }
	| { type: "close-end" };

function getInitialCommandDialogAnimationState(open: boolean): CommandDialogAnimationState {
	return { renderedOpen: open, visualOpen: open };
}

function commandDialogAnimationReducer(
	state: CommandDialogAnimationState,
	action: CommandDialogAnimationAction,
): CommandDialogAnimationState {
	switch (action.type) {
		case "open-start":
			return state.renderedOpen && state.visualOpen
				? state
				: { renderedOpen: true, visualOpen: true };
		case "close-start":
			return state.visualOpen ? { ...state, visualOpen: false } : state;
		case "close-end":
			return state.renderedOpen ? { ...state, renderedOpen: false } : state;
	}
}

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
	return (
		<CommandPrimitive
			data-slot="command"
			className={cn(
				"bg-popover text-popover-foreground flex size-full flex-col overflow-hidden rounded-md",
				className,
			)}
			{...props}
		/>
	);
}

function CommandDialog({
	title = "Command Palette",
	description = "IconSearch for a command to run...",
	children,
	className,
	showCloseButton = true,
	open,
	defaultOpen,
	onOpenChange,
	...props
}: React.ComponentProps<typeof Dialog> & {
	title?: string;
	description?: string;
	className?: string;
	showCloseButton?: boolean;
}) {
	const isControlled = open !== undefined;
	const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
	const actualOpen = isControlled ? open : uncontrolledOpen;
	const [{ renderedOpen, visualOpen }, dispatchAnimation] = React.useReducer(
		commandDialogAnimationReducer,
		actualOpen,
		getInitialCommandDialogAnimationState,
	);

	// Keep Base UI mounted until the custom backdrop/content fade finishes.
	React.useEffect(() => {
		if (actualOpen) {
			dispatchAnimation({ type: "open-start" });
			return;
		}

		dispatchAnimation({ type: "close-start" });
		const timeout = window.setTimeout(() => {
			dispatchAnimation({ type: "close-end" });
		}, COMMAND_DIALOG_CLOSE_DURATION_MS);

		return () => window.clearTimeout(timeout);
	}, [actualOpen]);

	const handleOpenChange: React.ComponentProps<typeof Dialog>["onOpenChange"] = (
		nextOpen,
		eventDetails,
	) => {
		if (!isControlled) {
			setUncontrolledOpen(nextOpen);
		}

		onOpenChange?.(nextOpen, eventDetails);
	};

	return (
		<Dialog open={renderedOpen} onOpenChange={handleOpenChange} {...props}>
			<DialogPortal data-slot="command-dialog-portal">
				<DialogPrimitive.Backdrop
					data-slot="command-dialog-overlay"
					data-command-open={visualOpen}
					className="fixed inset-0 z-50 bg-black/50 opacity-0 transition-opacity duration-150 data-[command-open=true]:animate-command-fade-in data-[command-open=true]:opacity-100 motion-reduce:animate-none motion-reduce:transition-none"
				/>
				<DialogPrimitive.Popup
					data-slot="command-dialog-content"
					data-command-open={visualOpen}
					className={cn(
						"bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] scale-95 gap-4 overflow-hidden rounded-lg border p-0 opacity-0 shadow-lg transition-[opacity,transform] duration-150 outline-none data-[command-open=true]:animate-command-dialog-in data-[command-open=true]:scale-100 data-[command-open=true]:opacity-100 motion-reduce:animate-none motion-reduce:transition-none sm:max-w-lg",
						className,
					)}
				>
					<DialogTitle className="sr-only">{title}</DialogTitle>
					<DialogDescription className="sr-only">{description}</DialogDescription>
					<Command className="[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:size-5">
						{children}
					</Command>
					{showCloseButton && (
						<DialogPrimitive.Close
							data-slot="command-dialog-close"
							className="ring-offset-background focus:ring-ring data-[open]:bg-accent data-[open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
						>
							<IconX />
							<span className="sr-only">Close</span>
						</DialogPrimitive.Close>
					)}
				</DialogPrimitive.Popup>
			</DialogPortal>
		</Dialog>
	);
}

function CommandInput({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
	return (
		<div data-slot="command-input-wrapper" className="flex h-9 items-center gap-2 border-b px-3">
			<IconSearch className="size-4 shrink-0 opacity-50" />
			<CommandPrimitive.Input
				data-slot="command-input"
				className={cn(
					"placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
	return (
		<CommandPrimitive.List
			data-slot="command-list"
			className={cn("max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto", className)}
			{...props}
		/>
	);
}

function CommandEmpty({ ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return (
		<CommandPrimitive.Empty
			data-slot="command-empty"
			className="py-6 text-center text-sm"
			{...props}
		/>
	);
}

function CommandGroup({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			data-slot="command-group"
			className={cn(
				"text-foreground [&_[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium",
				className,
			)}
			{...props}
		/>
	);
}

function CommandSeparator({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
	return (
		<CommandPrimitive.Separator
			data-slot="command-separator"
			className={cn("bg-border -mx-1 h-px", className)}
			{...props}
		/>
	);
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
	return (
		<CommandPrimitive.Item
			data-slot="command-item"
			className={cn(
				"data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="command-shortcut"
			className={cn("text-muted-foreground ml-auto text-xs tracking-widest", className)}
			{...props}
		/>
	);
}

export {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
};
