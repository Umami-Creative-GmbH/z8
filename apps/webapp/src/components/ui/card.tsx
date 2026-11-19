import type * as React from "react";

import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"flex min-w-0 flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm",
				className,
			)}
			data-slot="card"
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] [.border-b]:pb-6",
				className,
			)}
			data-slot="card-header"
			{...props}
		/>
	);
}

/**
 * A card's title. Pass `as="h2"` (or h3/h4) when the card is a page section, so
 * the title joins the document outline under the page h1. Defaults to a div.
 */
function CardTitle({
	as: Element = "div",
	className,
	...props
}: Omit<React.ComponentProps<"div">, "ref"> & {
	as?: "div" | "h2" | "h3" | "h4";
}) {
	return (
		<Element
			className={cn("min-w-0 break-words font-semibold leading-none", className)}
			data-slot="card-title"
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("text-muted-foreground text-sm", className)}
			data-slot="card-description"
			{...props}
		/>
	);
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
			data-slot="card-action"
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("min-w-0 px-6", className)} data-slot="card-content" {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
			data-slot="card-footer"
			{...props}
		/>
	);
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
