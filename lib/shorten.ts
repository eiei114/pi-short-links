import * as os from "node:os";
import { pathToFileURL } from "node:url";

const URL_RE = /https?:\/\/[^\s<>\[\]()"`']+/g;
const ABS_PATH_RE = /(?:^|[\s`"'(])((?:\/|~\/)[^\s<>\[\]()"`']+)/g;
const MD_LINK_RE = /\[[^\]]*\]\([^)]+\)/g;

export type ShortenOptions = {
	maxWidth: number;
	homeDir?: string;
	cwd?: string;
};

export function getMaxLabelWidth(columns: number | undefined = process.stdout.columns): number {
	const cols = typeof columns === "number" && columns > 0 ? columns : 80;
	// Leave room for transcript chrome / markdown punctuation.
	return Math.max(24, cols - 8);
}

export function isTruthyEnv(value: string | undefined): boolean {
	return /^(1|true|yes)$/i.test(value ?? "");
}

export function shouldForceHyperlinks(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (isTruthyEnv(env.FORCE_HYPERLINK)) return true;
	const term = env.TERM_PROGRAM?.toLowerCase() ?? "";
	return term === "orca";
}

function stripTrailingPunctuation(value: string): { core: string; trailing: string } {
	let end = value.length;
	while (end > 0 && /[.,;:!?)\]}'"]/.test(value[end - 1]!)) {
		end -= 1;
	}
	return { core: value.slice(0, end), trailing: value.slice(end) };
}

export function formatUrlLabel(url: string, maxWidth: number): string {
	try {
		const parsed = new URL(url);
		const host = parsed.host;
		const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
		const tailSource = path === "/" ? "" : path.replace(/\/+$/, "");
		const tail = tailSource.slice(-12);
		if (!tail) {
			return host.length <= maxWidth ? host : `${host.slice(0, Math.max(1, maxWidth - 1))}…`;
		}
		const candidate = `${host}/…${tail.replace(/^\//, "")}`;
		if (candidate.length <= maxWidth) return candidate;
		const budget = Math.max(8, maxWidth - 1);
		return `${candidate.slice(0, budget)}…`;
	} catch {
		if (url.length <= maxWidth) return url;
		return `${url.slice(0, Math.max(1, maxWidth - 1))}…`;
	}
}

export function formatPathLabel(
	rawPath: string,
	maxWidth: number,
	homeDir: string = os.homedir(),
): string {
	let display = rawPath;
	if (rawPath.startsWith(homeDir)) {
		display = `~${rawPath.slice(homeDir.length)}`;
	}

	if (display.length <= maxWidth) return display;

	const isHome = display.startsWith("~/");
	const isAbs = display.startsWith("/");
	const body = isHome ? display.slice(2) : isAbs ? display.slice(1) : display;
	const parts = body.split("/").filter(Boolean);
	const file = parts.at(-1) ?? body;
	const first = parts[0];

	let candidate: string;
	if (isHome && first && first !== file) {
		candidate = `~/${first}/…/${file}`;
	} else if (isHome) {
		candidate = `~/…/${file}`;
	} else if (isAbs && first && first !== file) {
		candidate = `/${first}/…/${file}`;
	} else if (isAbs) {
		candidate = `/…/${file}`;
	} else {
		candidate = `…/${file}`;
	}

	if (candidate.length <= maxWidth) return candidate;
	const budget = Math.max(8, maxWidth - 1);
	return `${candidate.slice(0, budget)}…`;
}

function toFileHref(rawPath: string, homeDir: string, cwd?: string): string {
	let absolute = rawPath;
	if (rawPath.startsWith("~/")) {
		absolute = `${homeDir}${rawPath.slice(1)}`;
	} else if (!rawPath.startsWith("/") && cwd) {
		absolute = `${cwd.replace(/\/+$/, "")}/${rawPath}`;
	}
	return pathToFileURL(absolute).href;
}

function protectMatches(text: string, pattern: RegExp): {
	text: string;
	slots: string[];
} {
	const slots: string[] = [];
	const next = text.replace(pattern, (match) => {
		const idx = slots.length;
		slots.push(match);
		return `\u0000MD${idx}\u0000`;
	});
	return { text: next, slots };
}

function restoreSlots(text: string, slots: string[]): string {
	return text.replace(/\u0000MD(\d+)\u0000/g, (_m, idx) => slots[Number(idx)] ?? "");
}

function rewritePlainSegment(segment: string, options: ShortenOptions): string {
	const homeDir = options.homeDir ?? os.homedir();
	const maxWidth = options.maxWidth;

	const protectedMd = protectMatches(segment, MD_LINK_RE);
	let text = protectedMd.text;

	text = text.replace(URL_RE, (raw) => {
		const { core, trailing } = stripTrailingPunctuation(raw);
		if (core.length <= maxWidth) return raw;
		const label = formatUrlLabel(core, maxWidth);
		return `[${label}](${core})${trailing}`;
	});

	text = text.replace(ABS_PATH_RE, (full, pathPart: string) => {
		const prefix = full.slice(0, full.length - pathPart.length);
		const { core, trailing } = stripTrailingPunctuation(pathPart);
		if (core.length <= maxWidth) return full;
		// Skip URL-looking leftovers.
		if (/^https?:/i.test(core)) return full;
		const label = formatPathLabel(core, maxWidth, homeDir);
		const href = toFileHref(core, homeDir, options.cwd);
		return `${prefix}[${label}](${href})${trailing}`;
	});

	return restoreSlots(text, protectedMd.slots);
}

/**
 * Rewrite long bare URLs/paths outside fenced code blocks into short markdown links.
 */
export function shortenAssistantText(input: string, options: ShortenOptions): string {
	if (!input || options.maxWidth < 8) return input;

	const parts: string[] = [];
	let i = 0;
	while (i < input.length) {
		const open = input.indexOf("```", i);
		if (open === -1) {
			parts.push(rewritePlainSegment(input.slice(i), options));
			break;
		}
		parts.push(rewritePlainSegment(input.slice(i, open), options));
		const close = input.indexOf("```", open + 3);
		if (close === -1) {
			parts.push(input.slice(open));
			break;
		}
		parts.push(input.slice(open, close + 3));
		i = close + 3;
	}

	return parts.join("");
}
