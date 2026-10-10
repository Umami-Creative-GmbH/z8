import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { getAuthContext } from "@/lib/auth-helpers";
import type { PersonnelFileAccess } from "./access";
import { resolvePersonnelFileAccess } from "./access-store";

export type CurrentPersonnelFileAccess =
	| { status: "unauthenticated" }
	/** Personnel files are off, or the user has no access in the active organization. */
	| { status: "unavailable" }
	| { status: "resolved"; access: PersonnelFileAccess };

/**
 * The signed-in user's personnel file access in their active organization,
 * once per request. Pages, actions and routes start here.
 */
export const loadCurrentPersonnelFileAccess = cache(
	async (): Promise<CurrentPersonnelFileAccess> => {
		const authContext = await getAuthContext();
		if (!authContext) return { status: "unauthenticated" };
		const organizationId = authContext.session.activeOrganizationId;
		if (!organizationId) return { status: "unavailable" };
		const access = await resolvePersonnelFileAccess(db, {
			userId: authContext.user.id,
			organizationId,
		});
		return access ? { status: "resolved", access } : { status: "unavailable" };
	},
);
