import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync, readdirSync } from "fs";

function copyExtensionFiles() {
  return {
    name: "copy-extension-files",
    closeBundle() {
      // Copy manifest.json
      copyFileSync(
        resolve(__dirname, "manifest.json"),
        resolve(__dirname, "dist/manifest.json")
      );

      // Copy icons
      const iconsDir = resolve(__dirname, "public/icons");
      const distIconsDir = resolve(__dirname, "dist/icons");
      mkdirSync(distIconsDir, { recursive: true });

      for (const file of readdirSync(iconsDir)) {
        copyFileSync(resolve(iconsDir, file), resolve(distIconsDir, file));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionFiles()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyDirBeforeWrite: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        options: resolve(__dirname, "options.html"),
        background: resolve(__dirname, "src/background/background.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
