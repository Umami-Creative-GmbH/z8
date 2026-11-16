"use client";

import { useEffect, useRef, useState } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { authClient, useSession } from "@/lib/auth-client";

/** Presentation lifetime only; each server read still resolves canonical admission. */
export function usePersonnelFilesSnapshot(source: {
	readId: string;
	userId: string;
	organizationId: string;
}) {
	const current = useOrganization();
	const session = useSession();
	const admitted = useRef(new Set<string>());
	const [retired, setRetired] = useState<ReadonlySet<string>>(() => new Set());
	const displayMatches =
		current.userId === source.userId && current.activeOrganizationId === source.organizationId;
	const actor = session.data?.user.id;
	const organization = session.data?.session.activeOrganizationId;
	const sessionMatches = actor === source.userId && organization === source.organizationId;
	const ready = displayMatches && sessionMatches && !session.isPending;

	useEffect(() => {
		const retire = () =>
			setRetired((previous) =>
				previous.has(source.readId) ? previous : new Set([...previous, source.readId]),
			);
		if (ready) admitted.current.add(source.readId);
		// Initial session hydration may wait while the server bootstrap is known.
		// A previously displayed read must not survive a later proof interruption.
		if (
			!displayMatches ||
			(actor && !sessionMatches) ||
			(!session.isPending && !actor) ||
			(session.isPending && admitted.current.has(source.readId))
		)
			retire();
		return authClient.$store.atoms.session.subscribe((value) => {
			const next = value.data;
			const changed = next
				? next.user.id !== source.userId ||
					next.session.activeOrganizationId !== source.organizationId
				: !value.isPending;
			if (changed || (value.isPending && admitted.current.has(source.readId))) retire();
		});
	}, [
		ready,
		displayMatches,
		actor,
		sessionMatches,
		session.isPending,
		source.readId,
		source.userId,
		source.organizationId,
	]);

	return { visible: ready && !retired.has(source.readId), pending: session.isPending };
}
