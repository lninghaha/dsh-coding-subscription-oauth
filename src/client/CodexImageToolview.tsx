/** Browser toolview for Codex image generate/edit results. */

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { type CodexImageAttachment, type CodexImageToolState, codexImageToolModel } from "./codexImageToolviewModel.ts";
import type { SlotsApi } from "./dshClientAdapter.ts";
import { bodyStyle, buttonStyle, errorStyle, hintStyle, monoStyle, titleStyle } from "./styles.ts";
import type { GrokBuildSettingsInjected } from "./types.ts";

export const CODEX_IMAGE_TOOLVIEW_NAMES = ["codex_image_generate", "codex_image_edit"] as const;

export type CodexImageLoader = ((attachment: CodexImageAttachment) => Promise<string>) & {
	peek?: (attachment: CodexImageAttachment) => string | undefined;
};

export interface CodexImageToolviewProps {
	block: unknown;
	toolName?: string;
	loadImage?: CodexImageLoader;
	inspect?: (() => void) | undefined;
	t: GrokBuildSettingsInjected["t"];
}

const cardStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 8,
	margin: "6px 0",
	padding: "10px 12px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: 10,
	background: "var(--dsw-alias-bg-layer-1)",
};

const rowButtonStyle: CSSProperties = {
	...buttonStyle,
	display: "flex",
	alignItems: "center",
	justifyContent: "flex-start",
	gap: 8,
	width: "100%",
	minHeight: 32,
	padding: "4px 8px",
	border: "none",
	background: "transparent",
	boxShadow: "none",
	textAlign: "left",
};

const galleryStyle: CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: 10,
	alignItems: "flex-start",
};

const imageStyle: CSSProperties = {
	display: "block",
	maxWidth: 240,
	maxHeight: 240,
	width: "auto",
	height: "auto",
	borderRadius: 8,
	border: "1px solid var(--dsw-alias-border-l2)",
	background: "var(--dsw-alias-bg-layer-2)",
};

const outputStyle: CSSProperties = {
	...bodyStyle,
	whiteSpace: "pre-wrap",
	overflowWrap: "anywhere",
};

const idStyle: CSSProperties = {
	...monoStyle,
	fontSize: 12,
	overflowWrap: "anywhere",
};

function stateDotStyle(state: CodexImageToolState): CSSProperties {
	const color =
		state === "ready"
			? "var(--dsw-alias-state-success-primary, currentColor)"
			: state === "error"
				? "var(--dsw-alias-state-error-primary, currentColor)"
				: state === "running"
					? "var(--dsw-alias-state-warn-primary, currentColor)"
					: "var(--dsw-alias-label-tertiary, currentColor)";
	return {
		flex: "none",
		width: 8,
		height: 8,
		borderRadius: 999,
		background: color,
	};
}

function summaryFor(model: ReturnType<typeof codexImageToolModel>, t: GrokBuildSettingsInjected["t"]): string {
	if (model.state === "ready") return t("toolCodexImageReady", { count: model.images.length });
	if (model.state === "error") return model.error ?? t("toolCodexImageFailed");
	if (model.state === "running") return t("toolCodexImageRunning");
	return model.text.length > 0 ? model.text : t("toolCodexImageEmpty");
}

function CodexImageThumb({
	attachment,
	index,
	loadImage,
	t,
}: {
	attachment: CodexImageAttachment;
	index: number;
	loadImage?: CodexImageLoader;
	t: GrokBuildSettingsInjected["t"];
}) {
	const [url, setUrl] = useState<string | undefined>(undefined);
	const [failed, setFailed] = useState(false);
	const load = () => {
		if (loadImage === undefined) return;
		setFailed(false);
		const cached = loadImage.peek?.(attachment);
		if (cached !== undefined) {
			setUrl(cached);
			return;
		}
		setUrl(undefined);
		loadImage(attachment).then(
			(value) => setUrl(value),
			() => setFailed(true),
		);
	};
	useEffect(() => {
		if (loadImage === undefined) return;
		let alive = true;
		setFailed(false);
		const cached = loadImage.peek?.(attachment);
		if (cached !== undefined) {
			setUrl(cached);
			return () => {
				alive = false;
			};
		}
		setUrl(undefined);
		loadImage(attachment).then(
			(value) => {
				if (alive) setUrl(value);
			},
			() => {
				if (alive) setFailed(true);
			},
		);
		return () => {
			alive = false;
		};
	}, [attachment, loadImage]);
	if (url !== undefined) {
		return (
			<a href={url} target="_blank" rel="noreferrer" aria-label={t("toolCodexImageOpen")}>
				<img src={url} alt={t("toolCodexImageAlt", { index })} style={imageStyle} />
			</a>
		);
	}
	if (failed) {
		return (
			<button type="button" style={buttonStyle} onClick={load}>
				{t("retry")}
			</button>
		);
	}
	return (
		<div
			role="img"
			style={{ ...imageStyle, display: "grid", placeItems: "center", minWidth: 120, minHeight: 120 }}
			aria-label={t("toolCodexImageLoading")}
		>
			<span style={hintStyle}>{t("toolCodexImageLoading")}</span>
		</div>
	);
}

/** Atomic tool row that keeps Codex image attachments visible in dsh Web. */
export function CodexImageToolview({ block, toolName, loadImage, inspect, t }: CodexImageToolviewProps) {
	const model = useMemo(() => codexImageToolModel(block), [block]);
	const [open, setOpen] = useState(model.state === "ready" || model.state === "error");
	useEffect(() => {
		if (model.state === "ready" || model.state === "error") setOpen(true);
	}, [model.state]);
	return (
		<section style={cardStyle} data-dsh-coding-oauth data-codex-image-toolview={toolName ?? "codex_image"}>
			<button
				type="button"
				style={rowButtonStyle}
				aria-expanded={open}
				aria-label={t("toolCodexImageToggle")}
				onClick={() => setOpen((value) => !value)}
			>
				<span style={stateDotStyle(model.state)} aria-hidden />
				<span style={{ ...titleStyle, fontSize: 14, lineHeight: "20px" }}>{t("toolCodexImageTitle")}</span>
				<span style={hintStyle}>{summaryFor(model, t)}</span>
			</button>
			{open ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
					{model.state === "error" ? <p style={errorStyle}>{model.error ?? t("toolCodexImageFailed")}</p> : null}
					{model.images.length > 0 && loadImage !== undefined ? (
						<div style={galleryStyle}>
							{model.images.map((attachment, index) => (
								<CodexImageThumb
									key={attachment.attachmentId}
									attachment={attachment}
									index={index + 1}
									loadImage={loadImage}
									t={t}
								/>
							))}
						</div>
					) : null}
					{model.images.length > 0 && loadImage === undefined ? (
						<p style={idStyle}>{model.images.map((image) => image.attachmentId).join("\n")}</p>
					) : null}
					{model.text.length > 0 ? <p style={outputStyle}>{model.text}</p> : null}
					{model.state === "empty" && model.text.length === 0 ? (
						<p style={hintStyle}>{t("toolCodexImageEmpty")}</p>
					) : null}
					{inspect === undefined ? null : (
						<div>
							<button type="button" style={buttonStyle} onClick={inspect}>
								{t("toolCodexImageInspect")}
							</button>
						</div>
					)}
				</div>
			) : null}
		</section>
	);
}

/** Register Codex image toolviews without claiming the shared tool.call.images child slot. */
export function registerCodexImageToolviews(slots: SlotsApi, t: GrokBuildSettingsInjected["t"]): () => void {
	const disposers = CODEX_IMAGE_TOOLVIEW_NAMES.map((toolName) =>
		slots.inject("tool.call.toolview", () =>
			slots.register(
				{
					name: "tool.call.toolview",
					key: toolName,
					locale: "settings.grok-build",
					inject: (): GrokBuildSettingsInjected => ({ t }),
				},
				CodexImageToolview,
			),
		),
	);
	return () => {
		for (const dispose of disposers) dispose();
	};
}
