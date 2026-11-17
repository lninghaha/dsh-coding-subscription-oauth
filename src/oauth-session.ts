/**
 * Persistent OAuth session and static model selection for one subscription provider.
 * @module dsh-coding-subscription-oauth/oauth-session
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import type {
	Api,
	AuthInteraction,
	Credential,
	Model,
	MutableModels,
	OAuthCredential,
	Provider,
} from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai";
import { ModelCacheQueue, writeModelCache } from "./model-cache.ts";
import type { OAuthProviderDefinition } from "./oauth-providers.ts";
import type { LiveModelEntry } from "./qwen-provider.ts";
import { type LoginPersistOptions, OAuthCredentialFileStore, oauthCredentialPath } from "./store.ts";

const MODELS_CACHE_VERSION = 2;
const LIVE_CACHE_VERSION = 1;
/** Live account catalogs are re-fetched at most this often (and a failed fetch retries after a minute). */
const LIVE_MODELS_TTL_MS = 10 * 60 * 1000;
const LIVE_MODELS_RETRY_MS = 60 * 1000;
const LIVE_MODELS_MAX_ENTRIES = 512;

interface ModelsCacheDocument {
	version: typeof MODELS_CACHE_VERSION;
	selectionMode: "default" | "selected";
	selected: string[];
}

function isENOENT(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function parseIdList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function parseCache(text: string): string[] | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const document = value as Record<string, unknown>;
	if (document["version"] !== 1 && document["version"] !== MODELS_CACHE_VERSION) return undefined;
	const selected = parseIdList(document["selected"]);
	if (document["version"] === MODELS_CACHE_VERSION)
		return document["selectionMode"] === "selected" ? selected : undefined;
	return selected.length === 0 ? undefined : selected;
}

function parseLiveCache(text: string): LiveModelEntry[] | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const document = value as Record<string, unknown>;
	if (document["version"] !== LIVE_CACHE_VERSION || !Array.isArray(document["models"])) return undefined;
	const entries: LiveModelEntry[] = [];
	for (const item of document["models"].slice(0, LIVE_MODELS_MAX_ENTRIES)) {
		if (typeof item !== "object" || item === null) continue;
		const entry = item as Record<string, unknown>;
		const input = entry["input"];
		if (
			typeof entry["id"] !== "string" ||
			entry["id"].length === 0 ||
			typeof entry["name"] !== "string" ||
			!Array.isArray(input) ||
			!input.every((kind) => kind === "text" || kind === "image") ||
			!Number.isSafeInteger(entry["contextWindow"]) ||
			!Number.isSafeInteger(entry["maxTokens"])
		) {
			continue;
		}
		entries.push({
			id: entry["id"],
			name: entry["name"],
			input: input as LiveModelEntry["input"],
			contextWindow: entry["contextWindow"] as number,
			maxTokens: entry["maxTokens"] as number,
		});
	}
	return entries.length === 0 ? undefined : entries;
}

export function oauthModelsCachePath(basename: string, dshHome?: string): string {
	return resolve(join(resolveDshHome(dshHome), basename));
}

export interface OAuthProviderStatus {
	authenticated: boolean;
	expiresAt?: number;
}

export class OAuthProviderSession {
	readonly store: OAuthCredentialFileStore;
	readonly models: MutableModels;
	private readonly baseline: readonly Model<Api>[];
	private catalog: readonly Model<Api>[];
	private readonly cacheFile: string;
	private readonly liveCacheFile: string;
	private liveRefreshedAt = 0;
	private liveInFlight: Promise<void> | undefined;
	/** Bumped on logout so an in-flight listing cannot repopulate a signed-out catalog. */
	private liveGeneration = 0;
	private selectedIds: string[] | undefined;
	private readonly cacheQueue = new ModelCacheQueue();

	constructor(
		readonly definition: OAuthProviderDefinition,
		onCatalogChange?: () => void,
		store: OAuthCredentialFileStore = new OAuthCredentialFileStore(
			definition.nativeProviderId,
			oauthCredentialPath(definition.authFilename),
			definition.route,
		),
		cacheFile: string = oauthModelsCachePath(definition.modelsCacheFilename),
	) {
		this.store = store;
		this.cacheFile = resolve(cacheFile);
		this.liveCacheFile = `${this.cacheFile}.live`;
		const provider = definition.providerFactory();
		this.baseline = [...provider.getModels()];
		this.catalog = this.baseline;
		this.models = createModels({ credentials: store });
		this.models.setProvider(provider);
		this.onCatalogChange = onCatalogChange;
	}

	private onCatalogChange: (() => void) | undefined;

	availableModels(): Model<Api>[] {
		return [...this.catalog];
	}

	selectedModelIds(): string[] | undefined {
		return this.selectedIds === undefined ? undefined : [...this.selectedIds];
	}

	visibleModels(): Model<Api>[] {
		if (this.selectedIds === undefined) return this.availableModels();
		const byId = new Map(this.catalog.map((model) => [model.id, model]));
		return this.selectedIds.flatMap((id) => {
			const model = byId.get(id);
			return model === undefined ? [] : [model];
		});
	}

	provider(): Provider {
		return this.definition.requestProvider(
			this.visibleModels().map((model) => model.id),
			this.catalog,
		);
	}

	async loadCachedModels(): Promise<void> {
		try {
			this.selectedIds = parseCache(await readFile(this.cacheFile, "utf8"));
		} catch (error) {
			if (!isENOENT(error)) throw error;
		}
		if (this.definition.fetchLiveModels === undefined) return;
		try {
			const cached = parseLiveCache(await readFile(this.liveCacheFile, "utf8"));
			if (cached !== undefined) this.catalog = this.materializeLive(cached);
		} catch (error) {
			if (!isENOENT(error)) throw error;
		}
	}

	/** Live entries inherit transport fields from the baseline template, never from the network/cache. */
	private materializeLive(entries: readonly LiveModelEntry[]): Model<Api>[] {
		const build = this.definition.liveModel;
		if (build !== undefined) return entries.map((entry) => build(entry));
		const template = this.baseline[0];
		if (template === undefined) return [...this.baseline];
		return entries.map((entry) => ({ ...template, ...entry }) as Model<Api>);
	}

	/**
	 * Replace the baseline catalog with the account's live model list. Best effort: any
	 * failure keeps the last good catalog and retries later. De-duplicated and TTL-gated.
	 */
	refreshLiveModels(force = false): Promise<void> {
		const fetchLive = this.definition.fetchLiveModels;
		if (fetchLive === undefined) return Promise.resolve();
		if (this.liveInFlight !== undefined) return this.liveInFlight;
		if (!force && Date.now() - this.liveRefreshedAt < LIVE_MODELS_TTL_MS) return Promise.resolve();
		const generation = this.liveGeneration;
		const run = async (): Promise<void> => {
			try {
				const token = await this.resolveAccessToken();
				if (token === undefined) return;
				const entries = (await fetchLive(token, new AbortController().signal)).slice(0, LIVE_MODELS_MAX_ENTRIES);
				if (entries.length === 0 || generation !== this.liveGeneration) return;
				const next = this.materializeLive(entries);
				const changed = next.map((model) => model.id).join("\n") !== this.catalog.map((model) => model.id).join("\n");
				this.catalog = next;
				this.liveRefreshedAt = Date.now();
				await this.cacheQueue.run(() =>
					writeModelCache(this.liveCacheFile, { version: LIVE_CACHE_VERSION, models: entries }),
				);
				if (changed) this.onCatalogChange?.();
			} catch {
				// Keep the previous catalog; a transient listing failure must not break sign-in or routing.
				this.liveRefreshedAt = Date.now() - LIVE_MODELS_TTL_MS + LIVE_MODELS_RETRY_MS;
			}
		};
		this.liveInFlight = run().finally(() => {
			this.liveInFlight = undefined;
		});
		return this.liveInFlight;
	}

	async setSelectedModels(ids: readonly string[] | undefined): Promise<void> {
		const selected = ids === undefined ? undefined : [...new Set(ids.filter((id) => id.length > 0))];
		await this.cacheQueue.run(async () => {
			await this.writeCache(selected);
			this.selectedIds = selected;
			this.onCatalogChange?.();
		});
	}

	async status(): Promise<OAuthProviderStatus> {
		const credential = await this.store.read(this.definition.nativeProviderId);
		if (credential?.type !== "oauth") return { authenticated: false };
		void this.refreshLiveModels();
		return { authenticated: true, expiresAt: credential.expires };
	}

	async login(interaction: AuthInteraction, persist: LoginPersistOptions = { mode: "add" }): Promise<Credential> {
		const credential = await this.store.runLoginPersist(persist, () =>
			this.models.login(this.definition.nativeProviderId, "oauth", interaction),
		);
		await this.refreshLiveModels(true);
		this.onCatalogChange?.();
		return credential;
	}

	async resolveAccessToken(): Promise<string | undefined> {
		const resolved = await this.models.getAuth(this.definition.nativeProviderId);
		if (resolved === undefined) return undefined;
		const credential = await this.store.read(this.definition.nativeProviderId);
		return credential?.type === "oauth" ? credential.access : undefined;
	}

	/**
	 * Backdate the stored token's expiry so the next `getAuth()` refreshes.
	 * Called after an upstream 401 rejected a locally-valid token.
	 */
	async invalidateAccessToken(): Promise<void> {
		await this.store.invalidate(this.definition.nativeProviderId);
	}

	/** Refresh host discovery after an account switch/remove without a full logout. */
	notifyCredentialChange(): void {
		void this.refreshLiveModels(true);
		this.onCatalogChange?.();
	}

	async storedCredential(): Promise<OAuthCredential | undefined> {
		const credential = await this.store.read(this.definition.nativeProviderId);
		return credential?.type === "oauth" ? credential : undefined;
	}

	async logout(): Promise<void> {
		return this.cacheQueue.run(async () => {
			try {
				await this.models.logout(this.definition.nativeProviderId);
				this.selectedIds = undefined;
				this.liveGeneration += 1;
				this.catalog = this.baseline;
				this.liveRefreshedAt = 0;
				await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 });
				await rm(this.cacheFile, { force: true });
				await rm(this.liveCacheFile, { force: true });
			} finally {
				// Credential deletion may succeed before cache cleanup fails. Always
				// refresh discovery so an open selector cannot retain stale models.
				this.onCatalogChange?.();
			}
		});
	}

	private async writeCache(selected: string[] | undefined): Promise<void> {
		const document: ModelsCacheDocument = {
			version: MODELS_CACHE_VERSION,
			selected: selected === undefined ? [] : [...selected],
			selectionMode: selected === undefined ? "default" : "selected",
		};
		await writeModelCache(this.cacheFile, document);
	}
}
