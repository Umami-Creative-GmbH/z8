import { mcpRoute } from "@/lib/public-api/production";

// The MCP server (#795): stateless streamable HTTP. The SDK answers GET and
// DELETE (session operations) itself; every method is admitted by API key first.
export const POST = mcpRoute;
export const GET = mcpRoute;
export const DELETE = mcpRoute;
