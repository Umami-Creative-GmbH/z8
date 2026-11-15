"use client";

import { useEffect, useRef, useState } from "react";
import { authClient, useSession } from "@/lib/auth-client";

function sessionScope(data: ReturnType<typeof useSession>["data"]) {
	return JSON.stringify([data?.user.id, data?.session.activeOrganizationId]);
}

// The epoch also observes intermediate A→B→A atom changes which React can batch.
// It is presentation lifetime only; the server still owns admission and writes.
export function usePolicyArrival() {
	const session = useSession();
	const scope = sessionScope(session.data);
	const epoch = useRef(0);
	const [arrival, setArrival] = useState(0);
	useEffect(() => {
		let previous = scope;
		return authClient.$store.atoms.session.subscribe((value) => {
			const next = sessionScope(value.data);
			if (next !== previous) {
				previous = next;
				epoch.current += 1;
				setArrival(epoch.current);
			}
		});
	}, [scope]);
	return {
		key: `${scope}:${arrival}`,
		epoch,
		ready: !session.isPending && !!session.data?.user.id,
	};
}
