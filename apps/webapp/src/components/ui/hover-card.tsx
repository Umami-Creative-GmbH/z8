"use client";

import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";

import { HoverCardContent } from "@/components/ui/hover-card-content";
import { HoverCardTrigger } from "@/components/ui/hover-card-trigger";

function HoverCard({ ...props }: HoverCardPrimitive.Root.Props) {
	return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
