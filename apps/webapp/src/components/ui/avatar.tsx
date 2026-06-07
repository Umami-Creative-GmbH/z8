"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type * as React from "react";

import { AvatarFallback } from "@/components/ui/avatar-fallback";
import { AvatarImage } from "@/components/ui/avatar-image";
import { cn } from "@/lib/utils";

type AvatarProps = Omit<React.ComponentProps<typeof AvatarPrimitive.Root>, "className"> & {
	className?: string;
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

export { Avatar, AvatarFallback, AvatarImage };
