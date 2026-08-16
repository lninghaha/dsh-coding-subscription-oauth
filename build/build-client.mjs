import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

// Mirrors @deepseek-ai/dsh-client-web's public PLATFORM_MODULES contract without
// importing the shell runtime. This plugin only consumes react from it.
const PLATFORM_MODULES = Object.freeze(["react", "react/jsx-runtime"]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (typeof manifest.name !== "string" || manifest.name.length === 0) throw new Error("package.json name is required");
const outdir = resolve(root, ".next/lib");
const watch = process.argv.includes("--watch");

const options = {
	entryPoints: [resolve(root, "src/client/index.tsx")],
	outfile: resolve(outdir, "client.js"),
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	external: [...PLATFORM_MODULES],
	sourcemap: "external",
	sourcesContent: true,
	legalComments: "none",
	minify: !watch,
	metafile: true,
	define: {
		"process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production"),
	},
	banner: {
		js: `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
	},
	footer: {
		js: "return module.exports;}});",
	},
};

await mkdir(outdir, { recursive: true });

if (watch) {
	const buildContext = await context(options);
	await buildContext.watch();
	console.log(`watching ${options.entryPoints[0]} -> ${options.outfile}`);
	await new Promise(() => {});
} else {
	const result = await build(options);
	await writeFile(resolve(outdir, "client.meta.json"), JSON.stringify(result.metafile, null, 2));
	console.log(`built ${options.outfile}`);
}
