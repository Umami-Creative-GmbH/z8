import { getAllApprovalHandlers, getApprovalHandler } from "@/lib/approvals/domain/registry";
import type { ApprovalTypeHandler } from "@/lib/approvals/domain/types";
import { type ApprovalInboxType, SUPPORTED_APPROVAL_INBOX_TYPES } from "./types";

const supportedTypeSet = new Set<string>(SUPPORTED_APPROVAL_INBOX_TYPES);

export interface ApprovalInboxSource {
	type: ApprovalInboxType;
	displayName: string;
	supportsBulkApprove: boolean;
	handler: ApprovalTypeHandler;
}

export function isSupportedInboxType(value: string): value is ApprovalInboxType {
	return supportedTypeSet.has(value);
}

export function getSupportedInboxSources(
	loadHandlers: () => ApprovalTypeHandler[] = getAllApprovalHandlers,
): ApprovalInboxSource[] {
	return loadHandlers()
		.filter((handler): handler is ApprovalTypeHandler & { type: ApprovalInboxType } =>
			isSupportedInboxType(handler.type),
		)
		.map((handler) => ({
			type: handler.type,
			displayName: handler.displayName,
			supportsBulkApprove: handler.supportsBulkApprove,
			handler,
		}));
}

export function getSupportedInboxHandler(type: string): ApprovalTypeHandler | null {
	if (!isSupportedInboxType(type)) return null;
	return getApprovalHandler(type) ?? null;
}
