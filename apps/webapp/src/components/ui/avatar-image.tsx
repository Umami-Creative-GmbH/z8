"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type * as React from "react";

import { cn } from "@/lib/utils";

type AvatarImageProps = Omit<React.ComponentProps<typeof AvatarPrimitive.Image>, "className"> & {
	className?: string;
};

function AvatarImage({ className, ...props }: AvatarImageProps) {
	return (
		<AvatarPrimitive.Image
			className={cn("aspect-square size-full", className)}
			data-slot="avatar-image"
			{...props}
		/>
	);
}

export { AvatarImage };
