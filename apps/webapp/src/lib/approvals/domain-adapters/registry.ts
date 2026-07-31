import type {
	ApprovalWorkflowSourceMap,
	ApprovalWorkflowType,
} from "../workflow/ports";
import { APPROVAL_WORKFLOW_TYPES } from "../workflow/types";
import type {
	ApprovalDomainAdapter,
	ApprovalDomainAdapterContext,
} from "./types";

declare class ApprovedCancellationAuthorizationBrand {
	private readonly approvedCancellationAuthorizationBrand: never;
}

export interface ApprovedCancellationAuthorization
	extends ApprovedCancellationAuthorizationBrand {}

export interface ApprovedCancellationAuthorizationScope {
	organizationId: string;
	workflowId: string;
	workflowType: ApprovalWorkflowType;
	sourceType: string;
	sourceId: string;
}

export type ApprovalDomainAdapterMap<
	TSourceMap extends {
		[Type in ApprovalWorkflowType]: unknown;
	} = ApprovalWorkflowSourceMap,
> = {
	[Type in ApprovalWorkflowType]: ApprovalDomainAdapter<TSourceMap[Type]>;
};

export interface ApprovalDomainAdapterRegistry<
	TSourceMap extends {
		[Type in ApprovalWorkflowType]: unknown;
	} = ApprovalWorkflowSourceMap,
> {
	get<Type extends ApprovalWorkflowType>(
		workflowType: Type,
	): ApprovalDomainAdapter<TSourceMap[Type]>;
	authorizeApprovedCancellation<Type extends ApprovalWorkflowType>(
		context: ApprovalDomainAdapterContext<TSourceMap[Type]>,
	): Promise<ApprovedCancellationAuthorization>;
}

const authorizationScopes = new WeakMap<
	object,
	Readonly<ApprovedCancellationAuthorizationScope>
>();

function registerApprovedCancellationAuthorization(
	scope: ApprovedCancellationAuthorizationScope,
): ApprovedCancellationAuthorization {
	const token = Object.freeze({});
	authorizationScopes.set(token, Object.freeze({ ...scope }));
	return token as ApprovedCancellationAuthorization;
}

export function isApprovedCancellationAuthorization(
	value: unknown,
	expectedScope: ApprovedCancellationAuthorizationScope,
): value is ApprovedCancellationAuthorization {
	if (typeof value !== "object" || value === null) return false;
	const scope = authorizationScopes.get(value);
	return (
		scope?.organizationId === expectedScope.organizationId &&
		scope.workflowId === expectedScope.workflowId &&
		scope.workflowType === expectedScope.workflowType &&
		scope.sourceType === expectedScope.sourceType &&
		scope.sourceId === expectedScope.sourceId
	);
}

function validateAuthorizationContext(
	adapter: ApprovalDomainAdapter<unknown>,
	context: ApprovalDomainAdapterContext<unknown>,
): void {
	const { workflow, sourceIdentity } = context;
	if (
		context.organizationId !== workflow.organizationId ||
		context.organizationId !== sourceIdentity.organizationId ||
		workflow.workflowType !== sourceIdentity.workflowType ||
		workflow.workflowType !== adapter.workflowType ||
		workflow.sourceType !== sourceIdentity.sourceType ||
		workflow.sourceType !== adapter.sourceType ||
		workflow.sourceId !== sourceIdentity.sourceId
	) {
		throw new Error(
			"Approved cancellation context does not match registry adapter",
		);
	}
}

export function createApprovalDomainAdapterRegistry<
	TSourceMap extends {
		[Type in ApprovalWorkflowType]: unknown;
	} = ApprovalWorkflowSourceMap,
>(
	adapters: ApprovalDomainAdapterMap<TSourceMap>,
): ApprovalDomainAdapterRegistry<TSourceMap> {
	for (const workflowType of APPROVAL_WORKFLOW_TYPES) {
		if (adapters[workflowType]?.workflowType !== workflowType) {
			throw new Error(`Adapter registration mismatch for ${workflowType}`);
		}
	}
	const registered = Object.freeze({ ...adapters });
	return Object.freeze({
		get<Type extends ApprovalWorkflowType>(workflowType: Type) {
			return registered[workflowType];
		},
		async authorizeApprovedCancellation<Type extends ApprovalWorkflowType>(
			context: ApprovalDomainAdapterContext<TSourceMap[Type]>,
		) {
			const workflowType = context.workflow.workflowType;
			if (!APPROVAL_WORKFLOW_TYPES.includes(workflowType)) {
				throw new Error(
					"Approved cancellation context has invalid workflow type",
				);
			}
			const adapter = registered[workflowType];
			validateAuthorizationContext(adapter, context);
			const capabilities = await adapter.getTrustedCapabilities(context);
			if (!capabilities.canCancelAfterApproval) {
				throw new Error(
					"Approved cancellation is not authorized by the registered adapter",
				);
			}
			return registerApprovedCancellationAuthorization({
				organizationId: context.organizationId,
				workflowId: context.workflow.id,
				workflowType: context.workflow.workflowType,
				sourceType: context.workflow.sourceType,
				sourceId: context.workflow.sourceId,
			});
		},
	});
}
