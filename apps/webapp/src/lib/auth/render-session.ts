import "server-only";

import { cache } from "react";
import { getRequestSession } from "./request-session";

/** Reuse authoritative authentication only within the current server render. */
export const getRenderSession = cache(getRequestSession);
