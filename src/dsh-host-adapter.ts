/** Narrow adapter around the DSH host API used by the standalone participant. */

import { createRequire } from "node:module";
import type { Context } from "@deepseek-ai/cordis";
import {
	CODING_OAUTH_CORE_ABI,
	type DshHostCapability,
	type OwnerAccessMode,
	resolveCodingOAuthScope,
} from "dsh-coding-oauth-core";
import type {
	CodingOAuthParticipantDiagnosticSource,
	DshCompatibility,
	DshCompatibilityDiagnostic,
} from "./compatibility.ts";
import { incompatibleDiagnostics } from "./compatibility.ts";
import type { OwnerRequestPolicy } from "./web-origin.ts";

const require = createRequire(import.meta.url);

export interface DshHostAdapter extends CodingOAuthParticipantDiagnosticSource {
	readonly context: Context;
	scope(): object;
	ownerRequestPolicy(): OwnerRequestPolicy | undefined;
	compatibility(options?: {
		readonly accessMode?: OwnerAccessMode;
		readonly uiOwner?: "hub" | "standalone" | null;
		readonly diagnostics?: readonly DshCompatibilityDiagnostic[];
	}): DshCompatibility;
	assertCompatible(): void;
}

interface CompatibilityOptions {
	readonly accessMode?: OwnerAccessMode;
	readonly uiOwner?: "hub" | "standalone" | null;
	readonly diagnostics?: readonly DshCompatibilityDiagnostic[];
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && (typeof value === "object" || typeof value === "function")
		? (value as Record<string, unknown>)
		: undefined;
}

function service(context: Context, name: string): unknown {
	try {
		const value = context.get(name);
		if (value !== undefined && value !== null) return value;
	} catch {}
	try {
		return record(context)?.[name];
	} catch {
		return undefined;
	}
}

function capability(value: unknown, contract: string, methods: readonly string[]): DshHostCapability {
	if (value === undefined || value === null) return { state: "missing", contract };
	const candidate = record(value);
	if (candidate === undefined || methods.some((method) => typeof candidate[method] !== "function")) {
		return { state: "incompatible", contract, reason: "service shape does not match the verified contract" };
	}
	return { state: "available", contract };
}

function asOwnerRequestPolicy(value: unknown): OwnerRequestPolicy | undefined {
	const candidate = record(value);
	return candidate !== undefined &&
		typeof candidate["authorize"] === "function" &&
		typeof candidate["diagnostics"] === "function"
		? (value as OwnerRequestPolicy)
		: undefined;
}

function dshVersion(): string | null {
	try {
		const manifest = require("@deepseek-ai/dsh/package.json") as { version?: unknown };
		return typeof manifest.version === "string" ? manifest.version : null;
	} catch {
		return null;
	}
}

export function createDshHostAdapter(context: Context): DshHostAdapter {
	const candidate = context as unknown as Record<string, unknown>;
	const diagnostics: DshCompatibilityDiagnostic[] = [];
	for (const method of ["effect", "inject", "get", "logger"] as const) {
		if (typeof candidate[method] !== "function") {
			diagnostics.push({
				id: `host.api.${method}`,
				component: "host",
				level: "error",
				message: `DSH host Context.${method} is unavailable`,
				expected: "function",
				actual: typeof candidate[method],
			});
		}
	}
	const llm = record(service(context, "llm"));
	if (llm === undefined || typeof llm["registerAdapter"] !== "function") {
		diagnostics.push({
			id: "host.api.llm.registerAdapter",
			component: "host",
			// OAuth account management and its same-origin routes stay usable while
			// Cordis is waiting for the optional LLM registry. The LLM child fiber
			// still treats this as a hard activation requirement before it registers
			// adapters.
			level: "warning",
			message: "DSH host LLM adapter registry is unavailable",
			expected: "function",
			actual: typeof llm?.["registerAdapter"],
		});
	}
	const frozenDiagnostics = Object.freeze([...diagnostics]);

	return Object.freeze({
		participantId: "coding-subscription-oauth" as const,
		context,
		scope: () => resolveCodingOAuthScope(context),
		ownerRequestPolicy: () => asOwnerRequestPolicy(service(context, "ownerRequestPolicy")),
		diagnostics: () => frozenDiagnostics,
		compatibility(options: CompatibilityOptions = {}) {
			const capabilities: Readonly<Record<string, DshHostCapability>> = {
				webServer: capability(service(context, "webServer"), "exact-route-v1", ["register"]),
				settings: capability(service(context, "settings"), "settings-register-v1", ["register"]),
				credentials: capability(service(context, "credentials"), "credential-resolver-v1", ["resolve"]),
				llm: capability(service(context, "llm"), "llm-adapter-registry-v1", ["registerAdapter"]),
				ownerRequestPolicy: capability(service(context, "ownerRequestPolicy"), "owner-request-policy-v1", [
					"authorize",
					"diagnostics",
				]),
			};
			const capabilityDiagnostics: DshCompatibilityDiagnostic[] = Object.entries(capabilities).flatMap(([id, value]) =>
				typeof value === "object" && value !== null && "state" in value && value.state !== "available"
					? [
							{
								id: `host.capability.${id}`,
								component: "host" as const,
								level: value.state === "incompatible" ? ("error" as const) : ("warning" as const),
								message: `${id} is ${value.state}`,
							},
						]
					: [],
			);
			const merged = Object.freeze([...frozenDiagnostics, ...capabilityDiagnostics, ...(options.diagnostics ?? [])]);
			const status: DshCompatibility["status"] = merged.some(
				(item: DshCompatibilityDiagnostic) => item.level === "error",
			)
				? "incompatible"
				: merged.some((item: DshCompatibilityDiagnostic) => item.level === "warning")
					? "degraded"
					: "healthy";
			return {
				coreAbi: CODING_OAUTH_CORE_ABI,
				dshVersion: dshVersion(),
				status,
				uiOwner: options.uiOwner ?? "standalone",
				accessMode: options.accessMode ?? "loopback",
				capabilities,
				diagnostics: merged.map((item: DshCompatibilityDiagnostic) => `${item.id}: ${item.message}`),
			};
		},
		assertCompatible() {
			const incompatible = [
				...incompatibleDiagnostics(diagnostics),
				...diagnostics.filter((item) => item.id === "host.api.llm.registerAdapter"),
			];
			if (incompatible.length > 0) {
				throw new Error(`incompatible DSH host API: ${incompatible.map((item) => item.id).join(", ")}`);
			}
		},
	});
}
