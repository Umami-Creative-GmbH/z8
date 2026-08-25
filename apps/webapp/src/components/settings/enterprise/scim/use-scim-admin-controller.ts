"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createEnterpriseIdentityScimConnectionAction, decommissionEnterpriseIdentityScimConnectionAction, getEnterpriseIdentityScimStatusAction, listEnterpriseIdentityScimEventsAction, revokeEnterpriseIdentityScimCredentialAction, rotateEnterpriseIdentityScimCredentialAction } from "@/app/[locale]/(app)/settings/enterprise/scim-actions";
import type { EnterpriseIdentitySetupResponse } from "@/app/[locale]/(app)/settings/enterprise/actions";

type Status = Awaited<ReturnType<typeof getEnterpriseIdentityScimStatusAction>>;
type Events = Awaited<ReturnType<typeof listEnterpriseIdentityScimEventsAction>>;
export function useScimAdminController(initialSetup: EnterpriseIdentitySetupResponse) {
	const [status, setStatus] = useState<Status | null>(null);
	const [events, setEvents] = useState<Events>([]);
	const [eventsError, setEventsError] = useState(false);
	const [credential, setCredential] = useState<string | null>(null);
	const [destructive, setDestructive] = useState<"revoke" | "decommission" | null>(null);
	const [credentialId, setCredentialId] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	const connectionId = status?.connection.connectionId ?? initialSetup.state.scim.connection?.connectionId ?? null;
	const refresh = () => { if (!connectionId) return; startTransition(async () => { try { const [next, nextEvents] = await Promise.all([getEnterpriseIdentityScimStatusAction(connectionId), listEnterpriseIdentityScimEventsAction(connectionId)]); setStatus(next); setEvents(nextEvents); setEventsError(false); } catch { setEventsError(true); toast.error("Unable to refresh SCIM status."); } }); };
	const create = (defaultRoleTemplateId: string | null) => { if (!defaultRoleTemplateId) return; startTransition(async () => { try { const result = await createEnterpriseIdentityScimConnectionAction({ autoActivateUsers: false, deprovisionAction: "suspend", defaultRoleTemplateId }); if ("token" in result) setCredential(result.token ?? null); if ("connection" in result && result.connection) { const next = await getEnterpriseIdentityScimStatusAction(result.connection.connectionId); setStatus(next); setEvents(await listEnterpriseIdentityScimEventsAction(result.connection.connectionId)); } } catch { toast.error("Unable to create the SCIM connection."); } }); };
	const rotate = () => { if (!connectionId) return; startTransition(async () => { try { const result = await rotateEnterpriseIdentityScimCredentialAction(connectionId); setCredential(result.token ?? null); setStatus(await getEnterpriseIdentityScimStatusAction(connectionId)); setEvents(await listEnterpriseIdentityScimEventsAction(connectionId)); } catch { toast.error("Unable to rotate the SCIM credential."); } }); };
	const confirm = () => { if (!connectionId) return; const currentAction = destructive; const currentCredential = credentialId; setDestructive(null); setCredentialId(null); startTransition(async () => { try { if (currentAction === "revoke" && currentCredential) await revokeEnterpriseIdentityScimCredentialAction(connectionId, currentCredential); if (currentAction === "decommission") await decommissionEnterpriseIdentityScimConnectionAction(connectionId); setStatus(currentAction === "decommission" ? null : await getEnterpriseIdentityScimStatusAction(connectionId)); if (currentAction !== "decommission") setEvents(await listEnterpriseIdentityScimEventsAction(connectionId)); } catch { toast.error("Unable to update the SCIM connection."); } }); };
	return { connectionId, create, credential, destructive, events, eventsError, isPending, refresh, rotate, status, clearCredential: () => setCredential(null), requestRevoke: (id: string) => { setCredentialId(id); setDestructive("revoke"); }, requestDecommission: () => setDestructive("decommission"), cancelDestructive: () => { setCredentialId(null); setDestructive(null); }, confirm };
}
