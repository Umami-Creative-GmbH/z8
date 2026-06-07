"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type * as React from "react";

import { cn } from "@/lib/utils";

type AvatarProps = Omit<React.ComponentProps<typeof AvatarPrimitive.Root>, "className"> & {
	className?: string;
};

type AvatarImageProps = Omit<React.ComponentProps<typeof AvatarPrimitive.Image>, "className"> & {
	className?: string;
};

type AvatarFallbackProps = Omit<
	React.ComponentProps<typeof AvatarPrimitive.Fallback>,
	"className" | "delay"
> & {
	className?: string;
	delay?: number;
	delayMs?: number;
};

function Avatar({ className, ...props }: AvatarProps) {
	return (
		<AvatarPrimitive.Root
			className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full", className)}
			data-slot="avatar"
			{...props}
		/>
	);
}

function AvatarImage({ className, ...props }: AvatarImageProps) {
	return (
		<AvatarPrimitive.Image
			className={cn("aspect-square size-full", className)}
			data-slot="avatar-image"
			{...props}
		/>
	);
}

function AvatarFallback({ className, delay, delayMs, ...props }: AvatarFallbackProps) {
	return (
		<AvatarPrimitive.Fallback
			className={cn("flex size-full items-center justify-center rounded-full bg-muted", className)}
			data-slot="avatar-fallback"
			delay={delay ?? delayMs}
			{...props}
		/>
	);
}

export { Avatar, AvatarFallback, AvatarImage };
