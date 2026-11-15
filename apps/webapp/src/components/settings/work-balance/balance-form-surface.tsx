"use client";

import type { ComponentProps, ReactNode } from "react";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

/** Container composition only: existing form validation, values and commands stay with the form. */
export const balanceDialogSurface = {
	Root: Dialog,
	Content: DialogContent,
	Header: DialogHeader,
	Title: DialogTitle,
	Description: DialogDescription,
	Footer: DialogFooter,
};
function PanelContent({ children, ...props }: ComponentProps<typeof DialogContent>) {
	return (
		<ActionPanelContent {...props}>
			<ActionPanelBody>{children}</ActionPanelBody>
		</ActionPanelContent>
	);
}
function PanelHeader({ children }: { children?: ReactNode }) {
	return <ActionPanelHeader className="-mx-6 -mt-5 mb-1">{children}</ActionPanelHeader>;
}
function PanelFooter({ children }: { children?: ReactNode }) {
	return <ActionPanelFooter className="-mx-6 -mb-5 mt-2">{children}</ActionPanelFooter>;
}
export const balancePanelSurface = {
	Root: ActionPanel,
	Content: PanelContent,
	Header: PanelHeader,
	Title: ActionPanelTitle,
	Description: ActionPanelDescription,
	Footer: PanelFooter,
};
export type BalanceFormSurface = typeof balanceDialogSurface;
