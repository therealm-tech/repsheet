import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./pwa.config.ts";

export default defineConfig({
	plugins: [react(), VitePWA(pwaOptions)],
	resolve: {
		alias: {
			"@": resolve(import.meta.dirname, "src"),
		},
	},
	server: {
		proxy: {
			"/api": {
				target: "http://localhost:3100",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api/, ""),
			},
		},
	},
});
