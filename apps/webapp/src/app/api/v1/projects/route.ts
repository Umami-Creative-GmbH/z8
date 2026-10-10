import { publicApiRoute } from "@/lib/public-api/production";
import { listProjects } from "@/lib/public-api/resources/projects";

/** GET /api/v1/projects (Public API, key scope `projects:read`). */
export const GET = publicApiRoute(listProjects);
