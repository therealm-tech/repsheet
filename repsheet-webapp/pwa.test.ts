import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateHtmlMarkup } from "@vite-pwa/assets-generator/api/generate-html-markup";
import { generateManifestIconsEntry } from "@vite-pwa/assets-generator/api/generate-manifest-icons-entry";
import { instructions } from "@vite-pwa/assets-generator/api/instructions";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { pwaOptions, THEME_COLOR } from "./pwa.config.ts";
import { iconPreset, iconSource } from "./pwa-assets.config.ts";

const iconInstructions = () =>
	instructions({
		imageResolver: () => readFile(resolve(import.meta.dirname, iconSource)),
		imageName: "logo.svg",
		preset: iconPreset,
		faviconPreset: "2023",
		htmlLinks: { xhtml: false, includeId: false },
		basePath: "/",
		resolveSvgName: (name) => name,
	});

async function pixel(png: Buffer, x: number, y: number): Promise<string> {
	const { data, info } = await sharp(png)
		.raw()
		.toBuffer({ resolveWithObject: true });
	const offset = (y * info.width + x) * info.channels;
	return `#${[...data.subarray(offset, offset + 3)]
		.map((channel) => channel.toString(16).padStart(2, "0"))
		.join("")}`;
}

describe("web app manifest", () => {
	it("installs as a standalone French app on the theme colour", () => {
		expect(pwaOptions.manifest).toMatchObject({
			name: "RepSheet",
			short_name: "RepSheet",
			lang: "fr",
			start_url: "/",
			scope: "/",
			display: "standalone",
			theme_color: THEME_COLOR,
			background_color: THEME_COLOR,
		});
	});

	it("lists the installable icon sizes generated from the logo", async () => {
		const { icons } = generateManifestIconsEntry(
			"object",
			await iconInstructions(),
		);
		expect(icons).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ sizes: "192x192", type: "image/png" }),
				expect.objectContaining({ sizes: "512x512", type: "image/png" }),
				expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
			]),
		);
	});

	it("links the apple touch icon", async () => {
		expect(generateHtmlMarkup(await iconInstructions())).toContain(
			'<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png">',
		);
	});

	it("draws the whole logo, light bar and orange plates, on the theme colour", async () => {
		const maskable = (await iconInstructions()).maskable[
			"/maskable-icon-512x512.png"
		];
		if (!maskable) {
			throw new Error("no 512px maskable icon");
		}
		const png = await maskable.buffer();
		expect(await pixel(png, 0, 0)).toBe(THEME_COLOR);
		expect(await pixel(png, 256, 256)).toBe("#edeff1");
		expect(await pixel(png, 145, 266)).toBe("#f26a0a");
	});
});

describe("service worker", () => {
	const denylist = pwaOptions.workbox?.navigateFallbackDenylist ?? [];
	const servesShell = (path: string) =>
		!denylist.some((pattern) => pattern.test(path));

	it("never answers API or health check navigations with the app shell", () => {
		expect(servesShell("/api")).toBe(false);
		expect(servesShell("/api/v1/workouts")).toBe(false);
		expect(servesShell("/healthz")).toBe(false);
	});

	it("answers app routes with the app shell", () => {
		expect(servesShell("/")).toBe(true);
		expect(servesShell("/workouts/42")).toBe(true);
		expect(servesShell("/apiary")).toBe(true);
	});

	it("caches no runtime request, API responses included", () => {
		expect(pwaOptions.workbox?.runtimeCaching).toBeUndefined();
	});

	it("precaches the fonts with the rest of the shell", () => {
		expect(pwaOptions.workbox?.globPatterns).toEqual([
			expect.stringContaining("woff2"),
		]);
	});
});
