import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import {
	getMaxLabelWidth,
	shortenAssistantText,
	shouldForceHyperlinks,
} from "../lib/shorten.ts";

function enableHyperlinksIfNeeded(): boolean {
	if (!shouldForceHyperlinks()) return false;
	const caps = getCapabilities();
	if (caps.hyperlinks) return false;
	setCapabilities({ ...caps, hyperlinks: true });
	return true;
}

export default function (pi: ExtensionAPI) {
	const forcedAtLoad = enableHyperlinksIfNeeded();

	pi.on("session_start", async (_event, ctx) => {
		const justForced = enableHyperlinksIfNeeded();
		if (!ctx.hasUI || !(forcedAtLoad || justForced) || !getCapabilities().hyperlinks) {
			return;
		}
		ctx.ui.setStatus("pi-short-links", "short-links: OSC 8 on");
		setTimeout(() => {
			try {
				ctx.ui.setStatus("pi-short-links", undefined);
			} catch {
				// session may already be gone
			}
		}, 2500);
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;

		const message = event.message;
		if (!("content" in message) || !Array.isArray(message.content)) return;

		const maxWidth = getMaxLabelWidth();
		let changed = false;
		const content = message.content.map((block) => {
			if (!block || typeof block !== "object" || !("type" in block)) return block;
			if (block.type !== "text" || typeof block.text !== "string") return block;
			const rewritten = shortenAssistantText(block.text, {
				maxWidth,
				cwd: ctx.cwd,
			});
			if (rewritten === block.text) return block;
			changed = true;
			return { ...block, text: rewritten };
		});

		if (!changed) return;

		return {
			message: {
				...message,
				content,
			},
		};
	});
}
