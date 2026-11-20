import * as os from "node:os";
import { pathToFileURL } from "node:url";

const URL_RE = /https?:\/\/[^\s<>\[\]"`']+/g;
const ABS_PATH_RE = /(?:^|[\s`"'(])((?:[A-Za-z]:[\\/]|\/|~\/)[^\s<>\[\]()"`']+)/g;
const MD_LINK_RE = /\[[^\]]*\]\([^)]+\)/g;
// A quoted absolute path that contains whitespace (for example
// "C:/Program Files/app/file.ts"). Linked as a whole or not at all.
const QUOTED_SPACED_PATH_RE =
	/(["'`])((?:[A-Za-z]:[\\/]|\/|~\/)[^\r\n"'`<>\[\]]*\s[^\r\n"'`<>\[\]]*)\1/g;
const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:[\\/]/;
const SLOT_RE = /\u0000MD(\d+)\u0000/g;

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

/**
 * Split a URL match into its href and prose tail. Balanced parentheses belong
 * to the URL; only closing parens in excess of opening ones are prose punctuation.
 */
function splitUrlTrailing(raw: string): { core: string; trailing: string } {
	// Separate punctuation first so a prose ')' immediately before it is still
	// visible as an unmatched closing delimiter (for example, "url). ok").
	let punctuationStart = raw.length;
	while (
		punctuationStart > 0 &&
		/[.,;:!?\]}'"]/.test(raw[punctuationStart - 1]!)
	) {
		punctuationStart -= 1;
	}
	const punctuation = raw.slice(punctuationStart);
	const candidate = raw.slice(0, punctuationStart);

	let opens = 0;
	let closes = 0;
	for (const char of candidate) {
		if (char === "(") opens += 1;
		else if (char === ")") closes += 1;
	}

	let end = candidate.length;
	while (closes > opens && end > 0 && candidate[end - 1] === ")") {
		end -= 1;
		closes -= 1;
	}

	return {
		core: candidate.slice(0, end),
		trailing: candidate.slice(end) + punctuation,
	};
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
	const isWindowsPath = /^[A-Za-z]:[\\/]/.test(rawPath);
	const normalizedPath = isWindowsPath ? rawPath.replaceAll("\\", "/") : rawPath;
	const isWindowsHome = /^[A-Za-z]:[\\/]/.test(homeDir);
	const normalizedHome = isWindowsHome ? homeDir.replaceAll("\\", "/") : homeDir;
	let display = normalizedPath;
	if (isWindowsHome) {
		const comparablePath = normalizedPath.toLowerCase();
		const comparableHome = normalizedHome.toLowerCase();
		const homePrefix = comparableHome.endsWith("/") ? comparableHome : `${comparableHome}/`;
		if (comparablePath === comparableHome || comparablePath.startsWith(homePrefix)) {
			const relativePath = normalizedPath.slice(normalizedHome.length).replace(/^\/+/, "");
			display = relativePath ? `~/${relativePath}` : "~";
		}
	} else if (normalizedPath.startsWith(normalizedHome)) {
		display = `~${normalizedPath.slice(normalizedHome.length)}`;
	}

	if (display.length <= maxWidth) return display;

	const isHome = display.startsWith("~/");
	const isAbs = display.startsWith("/");
	const drive = display.match(/^([A-Za-z]:)\//)?.[1];
	const isDriveAbs = drive !== undefined;
	const body = isHome
		? display.slice(2)
		: isAbs
			? display.slice(1)
			: isDriveAbs
				? display.slice(3)
				: display;
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
	} else if (isDriveAbs && first && first !== file) {
		candidate = `${drive}/${first}/…/${file}`;
	} else if (isDriveAbs) {
		candidate = `${drive}/…/${file}`;
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
	} else if (!rawPath.startsWith("/") && !WINDOWS_DRIVE_PATH_RE.test(rawPath) && cwd) {
		absolute = `${cwd.replace(/\/+$/, "")}/${rawPath}`;
	}
	const isWindowsDrivePath = WINDOWS_DRIVE_PATH_RE.test(absolute);
	// Encode parentheses so the href stays a single markdown link destination.
	return pathToFileURL(absolute, {
		windows: isWindowsDrivePath || process.platform === "win32",
	})
		.href.replaceAll("(", "%28")
		.replaceAll(")", "%29");
}

function protectMatches(text: string, pattern: RegExp): {
	text: string;
	slots: string[];
} {
	const slots: string[] = [];
	const next = text.replace(pattern, (match) => addSlot(slots, match));
	return { text: next, slots };
}

function addSlot(slots: string[], value: string): string {
	const idx = slots.length;
	slots.push(value);
	return `\u0000MD${idx}\u0000`;
}

function restoreSlots(text: string, slots: string[]): string {
	let restored = text;
	// A slot may contain an earlier slot's placeholder; restore until none remain.
	for (let pass = 0; pass <= slots.length && restored.includes("\u0000MD"); pass += 1) {
		restored = restored.replace(SLOT_RE, (_m, idx) => slots[Number(idx)] ?? "");
	}
	return restored;
}

function isQuote(value: string): boolean {
	return value === '"' || value === "'" || value === "`";
}

function rewritePlainSegment(segment: string, options: ShortenOptions): string {
	const homeDir = options.homeDir ?? os.homedir();
	const maxWidth = options.maxWidth;

	const protectedMd = protectMatches(segment, MD_LINK_RE);
	const slots = protectedMd.slots;
	let text = protectedMd.text;

	// URLs (rewritten or not) are protected so the path passes never link a
	// path-looking fragment inside an http(s) URL.
	text = text.replace(URL_RE, (raw) => {
		const { core, trailing } = splitUrlTrailing(raw);
		if (core.length <= maxWidth) return addSlot(slots, raw);
		const label = formatUrlLabel(core, maxWidth);
		return `${addSlot(slots, `[${label}](${core})`)}${trailing}`;
	});

	// Quoted paths containing spaces are linked as a whole before the
	// whitespace-delimited pass below could link only their first word.
	text = text.replace(QUOTED_SPACED_PATH_RE, (full, quote: string, pathPart: string) => {
		const { core, trailing } = stripTrailingPunctuation(pathPart);
		if (core.length <= maxWidth || /\s$/.test(core)) return full;
		const label = formatPathLabel(core, maxWidth, homeDir);
		const href = toFileHref(core, homeDir, options.cwd);
		return `${quote}${addSlot(slots, `[${label}](${href})`)}${trailing}${quote}`;
	});

	text = text.replace(ABS_PATH_RE, (full, pathPart: string, offset: number, whole: string) => {
		const prefix = full.slice(0, full.length - pathPart.length);
		// A quoted path that continues past whitespace could not be linked as a
		// whole; leave it unchanged rather than linking only its first part.
		const end = offset + full.length;
		if (isQuote(prefix) && /^[ \t]/.test(whole.slice(end, end + 1))) {
			const lineEnd = whole.indexOf("\n", end);
			const rest = whole.slice(end, lineEnd === -1 ? undefined : lineEnd);
			if (rest.includes(prefix)) return full;
		}
		const { core, trailing } = stripTrailingPunctuation(pathPart);
		if (core.length <= maxWidth) return full;
		// Skip URL-looking leftovers.
		if (/^https?:/i.test(core)) return full;
		const label = formatPathLabel(core, maxWidth, homeDir);
		const href = toFileHref(core, homeDir, options.cwd);
		return `${prefix}[${label}](${href})${trailing}`;
	});

	return restoreSlots(text, slots);
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
