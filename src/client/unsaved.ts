import { useCallback, useEffect } from "react";
export const hasUnsavedChanges = (root: HTMLElement | null): boolean =>
	root !== null && (root.matches('[data-unsaved="true"]') || root.querySelector('[data-unsaved="true"]') !== null);

/** 内部导航由调用方处理；宿主关闭、切页与页面刷新在离开前确认。 */
export function useUnsavedChanges(root: { readonly current: HTMLElement | null }, message: string): () => boolean {
	const confirmLeave = useCallback(
		(): boolean => !hasUnsavedChanges(root.current) || window.confirm(message),
		[root, message],
	);
	useEffect(() => {
		const active = (): boolean => root.current !== null && root.current.closest("[inert]") === null;
		const unload = (event: BeforeUnloadEvent): void => {
			if (hasUnsavedChanges(root.current)) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		const click = (event: MouseEvent): void => {
			const target = event.target;
			const dialog = root.current?.closest('[role="dialog"]');
			if (
				active() &&
				target instanceof Node &&
				dialog?.contains(target) &&
				!root.current?.contains(target) &&
				!confirmLeave()
			) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		};
		const key = (event: KeyboardEvent): void => {
			if (active() && event.key === "Escape" && !confirmLeave()) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		};
		window.addEventListener("beforeunload", unload);
		document.addEventListener("click", click, true);
		document.addEventListener("keydown", key, true);
		return () => {
			window.removeEventListener("beforeunload", unload);
			document.removeEventListener("click", click, true);
			document.removeEventListener("keydown", key, true);
		};
	}, [root, confirmLeave]);
	return confirmLeave;
}
