/** Capability adapter for the unstable DSH browser client surface. */

import type {} from "@deepseek-ai/dsh-client-locale/client";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";

export interface DshClientCompatibilityDiagnostic {
	readonly id: string;
	readonly level: "warning" | "error";
	readonly message: string;
	readonly expected: "function";
	readonly actual: string;
}

type SlotsApi = ClientContext["slots"];

function slotsOf(context: unknown): SlotsApi | undefined {
	if (typeof context !== "object" || context === null) return undefined;
	let slots: unknown;
	try {
		const get = (context as { readonly get?: unknown }).get;
		if (typeof get === "function") slots = get.call(context, "slots");
	} catch {
		// Older client runtimes may not expose the Cordis reflection helper.
	}
	if (slots === undefined) {
		try {
			slots = (context as { readonly slots?: unknown }).slots;
		} catch {
			// Strict Cordis rejects optional service reads outside an inject scope.
		}
	}
	if (
		typeof slots === "object" &&
		slots !== null &&
		typeof (slots as { readonly inject?: unknown }).inject === "function" &&
		typeof (slots as { readonly register?: unknown }).register === "function"
	)
		return slots as SlotsApi;
	return undefined;
}

export interface DshClientAdapter {
	readonly context: ClientContext;
	readonly locale: ClientContext["locale"];
	readonly effect: ClientContext["effect"];
	diagnostics(): readonly DshClientCompatibilityDiagnostic[];
	assertCompatible(): void;
	installSlots(options: {
		readonly register: (slots: SlotsApi) => () => void;
		readonly mountFallback: () => () => void;
	}): void;
}

type InstallSlotsOptions = Parameters<DshClientAdapter["installSlots"]>[0];

export function createDshClientAdapter(context: ClientContext): DshClientAdapter {
	const candidate = context as unknown as Record<string, unknown>;
	const locale = candidate["locale"] as Record<string, unknown> | undefined;
	const slots = slotsOf(context);
	const checks: Array<[string, unknown, DshClientCompatibilityDiagnostic["level"]]> = [
		["client.effect", candidate["effect"], "error"],
		["client.locale.register", locale?.["register"], "error"],
		["client.locale.bind", locale?.["bind"], "error"],
		["client.slots.inject", slots?.inject, "warning"],
	];
	const diagnostics = checks.flatMap(([id, value, level]): DshClientCompatibilityDiagnostic[] =>
		typeof value === "function"
			? []
			: [
					{
						id,
						level,
						message:
							level === "warning"
								? `${id} is unavailable; the independent settings entry remains active`
								: `${id} is unavailable in the DSH client runtime`,
						expected: "function",
						actual: typeof value,
					},
				],
	);
	const frozenDiagnostics = Object.freeze([...diagnostics]);
	return Object.freeze({
		context,
		locale: context.locale,
		effect: context.effect,
		diagnostics: () => frozenDiagnostics,
		assertCompatible() {
			const errors = diagnostics.filter((item) => item.level === "error");
			if (errors.length > 0) {
				throw new Error(`incompatible DSH client API: ${errors.map((item) => item.id).join(", ")}`);
			}
		},
		installSlots(options: InstallSlotsOptions) {
			let disposed = false;
			let installed = false;
			let disposeCurrent: () => void = () => undefined;
			const install = (slotContext: ClientContext): boolean => {
				const slots = slotsOf(slotContext);
				if (disposed || installed || slots === undefined) return false;
				installed = true;
				disposeCurrent();
				disposeCurrent = options.register(slots);
				return true;
			};

			if (!install(context)) {
				disposeCurrent = options.mountFallback();
				const inject = candidate["inject"];
				if (typeof inject === "function") {
					(inject as ClientContext["inject"]).call(context, ["slots"], (slotContext) => {
						install(slotContext);
					});
				}
			}

			context.effect(
				() => () => {
					disposed = true;
					disposeCurrent();
				},
				"dsh-coding-subscription-oauth: independent settings entry",
			);
		},
	});
}
