"use client";

import type { ComponentProps, ReactNode } from "react";
import {
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelFooter,
	ActionPanelHeader,
} from "@/components/ui/action-panel";
import type { DialogContent } from "@/components/ui/dialog";

export function BalancePanelContent({ children, ...props }: ComponentProps<typeof DialogContent>) {
	return (
		<ActionPanelContent {...props}>
			<ActionPanelBody>{children}</ActionPanelBody>
		</ActionPanelContent>
	);
}
export function BalancePanelHeader({ children }: { children?: ReactNode }) {
	return <ActionPanelHeader className="-mx-6 -mt-5 mb-1">{children}</ActionPanelHeader>;
}
export function BalancePanelFooter({ children }: { children?: ReactNode }) {
	return <ActionPanelFooter className="-mx-6 -mb-5 mt-2">{children}</ActionPanelFooter>;
}
