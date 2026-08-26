"use client";

import { useState, useTransition } from "react";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	createEnterpriseIdentityScimConnectionAction,
	decommissionEnterpriseIdentityScimConnectionAction,
	getEnterpriseIdentityScimStatusAction,
	listEnterpriseIdentityScimEventsAction,
	reconcileEnterpriseIdentityScimCreationAction,
	revokeEnterpriseIdentityScimCredentialAction,
	rotateEnterpriseIdentityScimCredentialAction,
} from "@/app/[locale]/(app)/settings/enterprise/scim-actions";
import type { EnterpriseIdentitySetupResponse } from "@/app/[locale]/(app)/settings/enterprise/actions";

type Status = Awaited<ReturnType<typeof getEnterpriseIdentityScimStatusAction>>;
type Events = Awaited<
	ReturnType<typeof listEnterpriseIdentityScimEventsAction>
>;

function loadScimConnection(connectionId: string) {
	return Promise.all([
		getEnterpriseIdentityScimStatusAction(connectionId),
		listEnterpriseIdentityScimEventsAction(connectionId),
	]);
}

export function useScimAdminController(
	setup: EnterpriseIdentitySetupResponse["state"],
) {
	const { t } = useTranslate();
	const [status, setStatus] = useState<Status | null>(null);
	const [events, setEvents] = useState<Events>([]);
	const [eventsError, setEventsError] = useState(false);
	const [credential, setCredential] = useState<string | null>(null);
	const [destructive, setDestructive] = useState<
		"revoke" | "decommission" | null
	>(null);
	const [credentialId, setCredentialId] = useState<string | null>(null);
	const [lifecycle, setLifecycle] = useState<
		"creating" | "creation_failed" | "decommissioning" | "decommissioned" | null
	>(null);
	const [pendingAction, setPendingAction] = useState<
		"create" | "refresh" | "rotate" | "revoke" | "decommission" | null
	>(null);
	const [isPending, startTransition] = useTransition();
	const connectionId =
		lifecycle === "decommissioned"
			? null
			: (status?.connection.connectionId ??
				setup.scim.connection?.connectionId ??
				null);

	const refresh = () => {
		if (!connectionId) return;
		setPendingAction("refresh");
		startTransition(async () => {
			await loadScimConnection(connectionId).then(
				([nextStatus, nextEvents]) => {
					setStatus(nextStatus);
					setEvents(nextEvents);
					setEventsError(false);
					setPendingAction(null);
				},
				() => {
					setEventsError(true);
					toast.error(
						t(
							"settings.enterprise.identity.scim.toast.refreshError",
							"Unable to refresh SCIM status.",
						),
					);
					setPendingAction(null);
				},
			);
		});
	};

	const reconcileCreation = (defaultRoleTemplateId: string | null) => {
		if (!defaultRoleTemplateId) return;
		setPendingAction("refresh");
		startTransition(async () => {
			await reconcileEnterpriseIdentityScimCreationAction({
				autoActivateUsers: false,
				deprovisionAction: "suspend",
				defaultRoleTemplateId,
			})
				.then((next) => {
					setLifecycle(next.status === "active" ? null : next.status);
					return "connection" in next && next.connection
						? loadScimConnection(next.connection.connectionId).then(
								([nextStatus, nextEvents]) => {
									setStatus(nextStatus);
									setEvents(nextEvents);
								},
							)
						: undefined;
				})
				.then(
					() => setPendingAction(null),
					() => {
						toast.error(
							t(
								"settings.enterprise.identity.scim.toast.reconcileError",
								"Unable to reconcile SCIM creation.",
							),
						);
						setPendingAction(null);
					},
				);
		});
	};

	const create = (defaultRoleTemplateId: string | null) => {
		if (!defaultRoleTemplateId || lifecycle === "creating") return;
		setPendingAction("create");
		startTransition(async () => {
			await createEnterpriseIdentityScimConnectionAction({
				autoActivateUsers: false,
				deprovisionAction: "suspend",
				defaultRoleTemplateId,
			})
				.then((result) => {
					if ("status" in result) setLifecycle(result.status ?? null);
					if ("token" in result) setCredential(result.token ?? null);
					if (!("connection" in result) || !result.connection) return;
					setLifecycle(null);
					return loadScimConnection(result.connection.connectionId).then(
						([nextStatus, nextEvents]) => {
							setStatus(nextStatus);
							setEvents(nextEvents);
						},
					);
				})
				.then(
					() => setPendingAction(null),
					() => {
						toast.error(
							t(
								"settings.enterprise.identity.scim.toast.createError",
								"Unable to create the SCIM connection.",
							),
						);
						setPendingAction(null);
					},
				);
		});
	};

	const rotate = () => {
		if (!connectionId) return;
		setPendingAction("rotate");
		startTransition(async () => {
			await rotateEnterpriseIdentityScimCredentialAction(connectionId)
				.then((result) => {
					setCredential(result.token ?? null);
					return loadScimConnection(connectionId);
				})
				.then(
					([nextStatus, nextEvents]) => {
						setStatus(nextStatus);
						setEvents(nextEvents);
						setPendingAction(null);
					},
					() => {
						toast.error(
							t(
								"settings.enterprise.identity.scim.toast.rotateError",
								"Unable to rotate the SCIM credential.",
							),
						);
						setPendingAction(null);
					},
				);
		});
	};

	const confirm = () => {
		if (!connectionId) return;
		const currentAction = destructive;
		const currentCredential = credentialId;
		setDestructive(null);
		setCredentialId(null);
		if (currentAction) setPendingAction(currentAction);
		startTransition(async () => {
			const operation =
				currentAction === "revoke" && currentCredential
					? revokeEnterpriseIdentityScimCredentialAction(
							connectionId,
							currentCredential,
						).then(() => loadScimConnection(connectionId))
					: currentAction === "decommission"
						? decommissionEnterpriseIdentityScimConnectionAction(
								connectionId,
							).then((result) => {
								setLifecycle(
									result === "completed" ? "decommissioned" : "decommissioning",
								);
								if (result === "completed") {
									setStatus(null);
									return;
								}
								return loadScimConnection(connectionId);
							})
						: loadScimConnection(connectionId);
			await operation.then(
				(result) => {
					if (result) {
						setStatus(result[0]);
						setEvents(result[1]);
					}
					setPendingAction(null);
				},
				() => {
					toast.error(
						t(
							"settings.enterprise.identity.scim.toast.updateError",
							"Unable to update the SCIM connection.",
						),
					);
					setPendingAction(null);
				},
			);
		});
	};

	return {
		connectionId,
		create,
		credential,
		destructive,
		events,
		eventsError,
		isPending,
		lifecycle,
		pendingAction,
		reconcileCreation,
		refresh,
		rotate,
		status,
		clearCredential: () => setCredential(null),
		requestRevoke: (id: string) => {
			setCredentialId(id);
			setDestructive("revoke");
		},
		requestDecommission: () => setDestructive("decommission"),
		cancelDestructive: () => {
			setCredentialId(null);
			setDestructive(null);
		},
		confirm,
	};
}
