export type AccountEntryRole = "hub" | "standalone";
interface Participant {
	readonly role: AccountEntryRole;
	readonly mount: (failed: () => void) => () => void;
	readonly readOwner: () => Promise<AccountEntryRole>;
}

/** 浏览器只协调入口；认证、路由和凭据的所有权仍由服务端原有选举决定。 */
export class AccountEntryCoordinator {
	private participants = new Map<AccountEntryRole, Participant>();
	private failed = new Set<AccountEntryRole>();
	private owner: AccountEntryRole | undefined;
	private active: AccountEntryRole | undefined;
	private release: (() => void) | undefined;
	private generation = 0;
	private refreshing = false;
	join(participant: Participant): () => void {
		if (this.participants.has(participant.role)) throw new Error("account entry participant already registered");
		this.participants.set(participant.role, participant);
		this.failed.delete(participant.role);
		this.generation++;
		this.reconcile();
		void this.refresh();
		return () => {
			if (this.participants.get(participant.role) !== participant) return;
			this.participants.delete(participant.role);
			this.failed.delete(participant.role);
			this.generation++;
			this.reconcile();
		};
	}
	get size(): number {
		return this.participants.size;
	}
	async refresh(): Promise<void> {
		if (this.refreshing) return;
		const reader = this.participants.get(this.active ?? "hub") ?? this.participants.values().next().value;
		if (!reader) return;
		const generation = this.generation;
		this.refreshing = true;
		try {
			const owner = await reader.readOwner();
			if (generation !== this.generation) return;
			this.owner = owner;
			this.reconcile();
		} catch {
			// 网络失败不等于插件退出；保留仍然可见的管理入口。
		} finally {
			this.refreshing = false;
			if (generation !== this.generation) void this.refresh();
		}
	}
	private reconcile(): void {
		const available = (role: AccountEntryRole) => this.participants.has(role) && !this.failed.has(role);
		const next =
			this.owner && available(this.owner)
				? this.owner
				: available("hub")
					? "hub"
					: available("standalone")
						? "standalone"
						: undefined;
		if (next === this.active) return;
		this.release?.();
		this.release = undefined;
		this.active = next;
		if (!next) return;
		let failed = false;
		const onFailure = () => {
			failed = true;
			if (this.active !== next) return;
			this.failed.add(next);
			this.reconcile();
		};
		try {
			const release = this.participants.get(next)!.mount(onFailure);
			if (failed || this.active !== next) release();
			else this.release = release;
		} catch {
			onFailure();
		}
	}
}

const KEY = Symbol.for("dsh.coding-oauth.account-entry/v1");
interface EntryStore {
	roots: WeakMap<object, { coordinator: AccountEntryCoordinator; stop: () => void }>;
}

export function registerAccountEntry(context: object, participant: Participant): () => void {
	const root = (context as { root?: object }).root ?? context;
	const global = globalThis as typeof globalThis & { [KEY]?: EntryStore };
	const store = global[KEY] ?? { roots: new WeakMap() };
	global[KEY] = store;
	let entry = store.roots.get(root);
	if (!entry) {
		const coordinator = new AccountEntryCoordinator();
		const refresh = () => {
			void coordinator.refresh();
		};
		// 沿用现有账户状态查询在非授权阶段的 30 秒刷新周期。
		const timer = setInterval(refresh, 30_000);
		globalThis.addEventListener?.("focus", refresh);
		entry = {
			coordinator,
			stop: () => {
				clearInterval(timer);
				globalThis.removeEventListener?.("focus", refresh);
			},
		};
		store.roots.set(root, entry);
	}
	const release = entry.coordinator.join(participant);
	return () => {
		release();
		if (entry.coordinator.size === 0) {
			entry.stop();
			store.roots.delete(root);
		}
	};
}
