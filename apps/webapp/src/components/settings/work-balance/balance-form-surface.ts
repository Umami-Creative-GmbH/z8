"use client";

import {
	ActionPanel,
	ActionPanelDescription,
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
import { BalancePanelContent, BalancePanelFooter, BalancePanelHeader } from "./balance-form-panel";

/** Container composition only: existing form validation, values and commands stay with the form. */
export const balanceDialogSurface = {
	Root: Dialog,
	Content: DialogContent,
	Header: DialogHeader,
	Title: DialogTitle,
	Description: DialogDescription,
	Footer: DialogFooter,
};
export const balancePanelSurface = {
	Root: ActionPanel,
	Content: BalancePanelContent,
	Header: BalancePanelHeader,
	Title: ActionPanelTitle,
	Description: ActionPanelDescription,
	Footer: BalancePanelFooter,
};
export type BalanceFormSurface = typeof balanceDialogSurface;
