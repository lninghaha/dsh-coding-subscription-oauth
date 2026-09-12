import { useEffect, useRef, useState } from "react";

/** 目标账户在打开确认时固定；不把重新授权解释为新增或默认账户切换。 */
export function AccountReauthorization({
	account,
	methods,
	disabled,
	labels,
	onConfirm,
}: {
	readonly account: string;
	readonly methods: readonly { id: string; label: string }[];
	readonly disabled: boolean;
	readonly labels: { action: string; hint: string; cancel: string };
	readonly onConfirm: (method: string) => Promise<unknown>;
}) {
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (open) cancel.current?.focus();
	}, [open]);
	return (
		<div style={{ display: "inline-flex", flexDirection: "column", gap: 8 }}>
			<button
				ref={trigger}
				type="button"
				disabled={disabled || pending}
				aria-expanded={open}
				onClick={() => setOpen(true)}
			>
				{labels.action}
			</button>
			{open ? (
				<fieldset style={{ margin: 0, padding: 12 }}>
					<legend>{account}</legend>
					<p>{labels.hint}</p>
					{methods.map((method) => (
						<button
							key={method.id}
							type="button"
							disabled={pending || disabled}
							onClick={() => {
								if (pending) return;
								setPending(true);
								setError(undefined);
								void onConfirm(method.id)
									.then(
										() => setOpen(false),
										(failure: unknown) => setError(failure instanceof Error ? failure.message : labels.action),
									)
									.finally(() => setPending(false));
							}}
						>
							{labels.action} · {method.label}
						</button>
					))}
					<button
						ref={cancel}
						type="button"
						disabled={pending}
						onClick={() => {
							setOpen(false);
							trigger.current?.focus();
						}}
					>
						{labels.cancel}
					</button>
					{error ? <p role="alert">{error}</p> : null}
				</fieldset>
			) : null}
		</div>
	);
}
