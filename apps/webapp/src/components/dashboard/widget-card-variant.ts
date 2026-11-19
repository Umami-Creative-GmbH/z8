import { createContext } from "react";

/**
 * "strip" renders a widget as one segment of a shared summary surface. The segment
 * keeps its icon, title and refresh control but drops the visible description so
 * the summary values sit closer to the top of the page.
 */
export const WidgetCardVariantContext = createContext<"card" | "strip">("card");
