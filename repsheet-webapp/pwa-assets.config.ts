import {
	defineConfig,
	minimal2023Preset,
	type Preset,
} from "@vite-pwa/assets-generator/config";
import { THEME_COLOR } from "./pwa.config.ts";

const onTheme = {
	resizeOptions: { fit: "contain", background: THEME_COLOR },
} as const;

export const iconPreset: Preset = {
	...minimal2023Preset,
	maskable: { ...minimal2023Preset.maskable, ...onTheme },
	apple: { ...minimal2023Preset.apple, ...onTheme },
};

export const iconSource = "public/logo.svg";

export default defineConfig({
	headLinkOptions: { preset: "2023" },
	preset: iconPreset,
	images: [iconSource],
});
