"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type * as React from "react";

import { cn } from "@/lib/utils";

type AvatarFallbackProps = Omit<
	React.ComponentProps<typeof AvatarPrimitive.Fallback>,
	"className" | "delay"
> & {
	className?: string;
	delay?: number;
	delayMs?: number;
};

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

export { AvatarFallback };
