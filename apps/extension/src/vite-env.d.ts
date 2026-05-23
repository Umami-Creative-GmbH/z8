/// <reference types="chrome" />
/// <reference types="vite/client" />

declare module "@tabler/icons-react/dist/esm/icons/*.mjs" {
  import type { ComponentType, SVGProps } from "react";

  const Icon: ComponentType<SVGProps<SVGSVGElement> & { size?: string | number; stroke?: string | number; title?: string }>;
  export default Icon;
}

declare module "*.css";
