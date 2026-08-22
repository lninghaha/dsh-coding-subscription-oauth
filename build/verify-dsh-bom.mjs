import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const matrix = JSON.parse(await readFile(resolve(root, "compatibility", "dsh-bom.json"), "utf8"));
const bom = manifest?.dsh?.compatibility?.bom;
if (typeof bom !== "object" || bom === null || Array.isArray(bom)) {
	throw new Error("package.json dsh.compatibility.bom is required");
}

const sections = ["dependencies", "peerDependencies", "devDependencies"];
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const failures = [];
if (manifest?.dsh?.compatibility?.coreAbi !== "dsh-coding-oauth-core/v1") {
	failures.push("dsh.compatibility.coreAbi must match the shared OAuth core ABI");
}
if (manifest?.dsh?.compatibility?.verifiedBom !== "./compatibility/dsh-bom.json") {
	failures.push("dsh.compatibility.verifiedBom must point to the packaged matrix");
}
if (matrix?.schemaVersion !== 1 || matrix?.coreAbi !== manifest?.dsh?.compatibility?.coreAbi) {
	failures.push("compatibility matrix schema/core ABI does not match package metadata");
}
if (JSON.stringify(matrix?.verified?.packages) !== JSON.stringify(bom)) {
	failures.push("compatibility matrix verified packages must exactly match dsh.compatibility.bom");
}
if (!Array.isArray(matrix?.candidates) || matrix.candidates.some((candidate) => candidate?.status !== "unverified")) {
	failures.push("every untested DSH candidate must remain explicitly unverified");
}
for (const [name, expected] of Object.entries(bom)) {
	if (typeof expected !== "string" || !exactVersionPattern.test(expected)) {
		failures.push(`${name}: BOM version must be an exact release version`);
		continue;
	}
	let declared = false;
	for (const section of sections) {
		const actual = manifest[section]?.[name];
		if (actual === undefined) continue;
		declared = true;
		if (actual !== expected) failures.push(`${section}.${name}: expected ${expected}, found ${actual}`);
	}
	if (!declared) failures.push(`${name}: missing from dependencies/peerDependencies/devDependencies`);
}

const dshRuntimePackages = new Set(
	sections.flatMap((section) =>
		Object.keys(manifest[section] ?? {}).filter(
			(name) =>
				name.startsWith("@deepseek-ai/") ||
				name === "@earendil-works/pi-ai" ||
				name === "react" ||
				name === "react-dom",
		),
	),
);
for (const name of dshRuntimePackages) {
	if (!(name in bom)) failures.push(`${name}: missing from dsh.compatibility.bom`);
}

if (failures.length > 0) {
	throw new Error(`DSH BOM gate failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}
console.log(`verified exact DSH BOM (${String(Object.keys(bom).length)} packages)`);
