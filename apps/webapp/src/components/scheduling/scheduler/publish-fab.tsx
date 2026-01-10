"use client";

import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface PublishFabProps {
	draftCount: number;
	onPublish: () => void;
	isPublishing: boolean;
}

export function PublishFab({ draftCount, onPublish, isPublishing }: PublishFabProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					size="lg"
					onClick={onPublish}
					disabled={isPublishing}
					className={cn(
						"fixed bottom-6 right-6 h-14 rounded-full shadow-lg",
						"hover:shadow-xl transition-all",
						"bg-primary hover:bg-primary/90",
						draftCount > 0 && "animate-pulse",
					)}
				>
					{isPublishing ? (
						<>
							<Loader2 className="h-5 w-5 mr-2 animate-spin" />
							Publishing...
						</>
					) : (
						<>
							<Send className="h-5 w-5 mr-2" />
							Publish ({draftCount})
						</>
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="left">
				<p>
					Publish {draftCount} draft shift{draftCount !== 1 ? "s" : ""} and notify employees
				</p>
			</TooltipContent>
		</Tooltip>
	);
}
