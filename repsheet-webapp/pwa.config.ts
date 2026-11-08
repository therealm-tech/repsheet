import type { VitePWAOptions } from "vite-plugin-pwa";

export const THEME_COLOR = "#111315";

export const pwaOptions: Partial<VitePWAOptions> = {
	registerType: "autoUpdate",
	injectRegister: "script-defer",
	pwaAssets: { config: true },
	manifest: {
		name: "RepSheet",
		short_name: "RepSheet",
		description: "Tes séances, série par série.",
		lang: "fr",
		start_url: "/",
		scope: "/",
		display: "standalone",
		theme_color: THEME_COLOR,
		background_color: THEME_COLOR,
	},
	workbox: {
		globPatterns: ["**/*.{js,css,html,woff2,svg,png,ico}"],
		navigateFallback: "/index.html",
		navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/healthz$/],
	},
};
