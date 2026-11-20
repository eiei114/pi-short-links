import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
	formatPathLabel,
	formatUrlLabel,
	getMaxLabelWidth,
	shortenAssistantText,
	shouldForceHyperlinks,
} from "../lib/shorten.ts";

test("getMaxLabelWidth leaves chrome margin", () => {
	assert.equal(getMaxLabelWidth(80), 72);
	assert.equal(getMaxLabelWidth(20), 24);
});

test("shouldForceHyperlinks respects FORCE_HYPERLINK and Orca", () => {
	assert.equal(shouldForceHyperlinks({ FORCE_HYPERLINK: "1" }), true);
	assert.equal(shouldForceHyperlinks({ TERM_PROGRAM: "Orca" }), true);
	assert.equal(shouldForceHyperlinks({ TERM_PROGRAM: "Apple_Terminal" }), false);
});

test("formatUrlLabel keeps host and tail", () => {
	const url =
		"https://docs.google.com/document/d/1yotrdtXibZ_3RFW_N8FCCwvAa8vIa_sgPbRM8KlBKTg/edit";
	const label = formatUrlLabel(url, 48);
	assert.match(label, /docs\.google\.com/);
	assert.match(label, /…/);
	assert.ok(label.length <= 48);
});

test("formatPathLabel uses home + middle ellipsis", () => {
	const home = "/Users/demo";
	const path = `${home}/IMspace/obsidian-note/very/long/dir/file.ts`;
	const label = formatPathLabel(path, 40, home);
	assert.equal(label, "~/IMspace/…/file.ts");
});

test("shortenAssistantText rewrites long urls outside fences", () => {
	const url =
		"https://docs.google.com/document/d/1yotrdtXibZ_3RFW_N8FCCwvAa8vIa_sgPbRM8KlBKTg/edit";
	const out = shortenAssistantText(`See ${url} please`, {
		maxWidth: 40,
		homeDir: "/Users/demo",
	});
	assert.match(out, /\[docs\.google\.com\/…[^\]]+\]\(/);
	assert.match(out, new RegExp(`\\]\\(${url.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\)`));
});

test("shortenAssistantText skips fenced code", () => {
	const url =
		"https://docs.google.com/document/d/1yotrdtXibZ_3RFW_N8FCCwvAa8vIa_sgPbRM8KlBKTg/edit";
	const input = ["before", "```", url, "```", "after"].join("\n");
	const out = shortenAssistantText(input, { maxWidth: 40, homeDir: "/Users/demo" });
	const fence = out.slice(out.indexOf("```"), out.lastIndexOf("```") + 3);
	assert.match(fence, new RegExp(url.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")));
	assert.doesNotMatch(fence, /\[docs\.google\.com/);
});

test("shortenAssistantText leaves short urls alone", () => {
	const url = "https://example.com/a";
	const out = shortenAssistantText(url, { maxWidth: 80, homeDir: "/Users/demo" });
	assert.equal(out, url);
});

test("shortenAssistantText rewrites long absolute paths", () => {
	const home = "/Users/demo";
	const path = `${home}/IMspace/obsidian-note/very/long/dir/file.ts`;
	const out = shortenAssistantText(`open ${path}`, {
		maxWidth: 40,
		homeDir: home,
	});
	assert.match(out, /\[~\/IMspace\/…\/file\.ts\]\(file:\/\//);
});

test("shortenAssistantText preserves literal backslashes in POSIX path segments", () => {
	const posixPath = "/a\\b/some/deep/folder/file.ts";
	const expectedLabel = "/a\\b/…/file.ts";
	const out = shortenAssistantText(`open ${posixPath} ok`, {
		maxWidth: 24,
		homeDir: "/Users/demo",
	});
	assert.equal(formatPathLabel(posixPath, 24, "/Users/demo"), expectedLabel);
	assert.ok(out.startsWith(`open [${expectedLabel}](`));
	assert.ok(out.endsWith(") ok"));
});

test("shortenAssistantText rewrites long Windows home paths with either separator", () => {
	const home = path.win32.join("C:\\", "Users", "demo");
	const windowsPath = path.win32.join(
		home,
		"IMspace",
		"obsidian-note",
		"4_Project",
		"Some",
		"Deep",
		"Folder",
		"file.ts",
	);
	const expected =
		"open [~/IMspace/…/file.ts](file:///C:/Users/demo/IMspace/obsidian-note/4_Project/Some/Deep/Folder/file.ts) ok";

	for (const inputPath of [windowsPath, windowsPath.replaceAll("\\", "/")]) {
		assert.equal(
			shortenAssistantText(`open ${inputPath} ok`, {
				maxWidth: 40,
				homeDir: home,
			}),
			expected,
		);
	}
});

test("shortenAssistantText preserves the drive on long Windows paths outside home", () => {
	const windowsPath = path.win32.join(
		"D:\\",
		"work",
		"some",
		"deep",
		"folder",
		"file.ts",
	);
	const expected =
		"open [D:/work/…/file.ts](file:///D:/work/some/deep/folder/file.ts) ok";

	for (const inputPath of [windowsPath, windowsPath.replaceAll("\\", "/")]) {
		assert.equal(
			shortenAssistantText(`open ${inputPath} ok`, {
				maxWidth: 24,
				homeDir: path.win32.join("C:\\", "Users", "demo"),
			}),
			expected,
		);
	}
});

test("shortenAssistantText does not treat a Windows home prefix as a home path", () => {
	const home = path.win32.join("C:\\", "Users", "demo");
	const windowsPath = path.win32.join(
		home + "-extra",
		"IMspace",
		"obsidian-note",
		"4_Project",
		"Some",
		"Deep",
		"Folder",
		"file.ts",
	);
	const expected =
		"open [C:/Users/…/file.ts](file:///C:/Users/demo-extra/IMspace/obsidian-note/4_Project/Some/Deep/Folder/file.ts) ok";

	for (const inputPath of [windowsPath, windowsPath.replaceAll("\\", "/")]) {
		assert.equal(
			shortenAssistantText(`open ${inputPath} ok`, {
				maxWidth: 40,
				homeDir: home,
			}),
			expected,
		);
	}
});

test("shortenAssistantText does not prefix absolute Windows drive paths with cwd", () => {
	const out = shortenAssistantText("open D:/work/some/deep/folder/file.ts ok", {
		maxWidth: 24,
		homeDir: "/Users/demo",
		cwd: "/repo",
	});
	assert.equal(
		out,
		"open [D:/work/…/file.ts](file:///D:/work/some/deep/folder/file.ts) ok",
	);
	assert.doesNotMatch(out, /repo/);
});

test("shortenAssistantText links quoted paths with spaces as a whole", () => {
	const options = { maxWidth: 24, homeDir: "/Users/demo", cwd: "/repo" };
	assert.equal(
		shortenAssistantText('open "D:/work/My Files/deep/folder/file.ts" ok', options),
		'open "[D:/work/…/file.ts](file:///D:/work/My%20Files/deep/folder/file.ts)" ok',
	);
	assert.equal(
		shortenAssistantText("open '/srv/My Files/deep/folder/file.ts'. ok", options),
		`open '[/srv/…/file.ts](${pathToFileURL("/srv/My Files/deep/folder/file.ts").href})'. ok`,
	);
	assert.equal(
		shortenAssistantText('open "C:/Program Files (x86)/deep/folder/app.exe" ok', options),
		'open "[C:/Program Files (x86)/…](file:///C:/Program%20Files%20%28x86%29/deep/folder/app.exe)" ok',
	);
});

test("shortenAssistantText never partially links a quoted path with spaces", () => {
	const options = { maxWidth: 24, homeDir: "/Users/demo" };
	// The "[" in the second word makes the quoted path unlinkable as a whole.
	const input = 'open "D:/work/some/deep/folder/My [draft] file.ts" ok';
	assert.equal(shortenAssistantText(input, options), input);
});

test("shortenAssistantText does not link paths inside http URLs", () => {
	const longUrl = "https://example.com/show(D:/work/some/deep/folder/file.ts)";
	const longOut = shortenAssistantText(`see ${longUrl} ok`, {
		maxWidth: 40,
		homeDir: "/Users/demo",
		cwd: "/repo",
	});
	assert.match(longOut, /^see \[[^\]]+\]\(https:\/\/example\.com\/show\(D:\/work\/some\/deep\/folder\/file\.ts\)\) ok$/);
	assert.doesNotMatch(longOut, /file:\/\//);

	const nested = shortenAssistantText(`see ${longUrl} ok`, {
		maxWidth: 24,
		homeDir: "/Users/demo",
	});
	assert.doesNotMatch(nested, /file:\/\//);
	assert.ok(nested.includes(`(${longUrl})`));
});

test("shortenAssistantText leaves short Windows paths unchanged", () => {
	for (const pathText of ["C:\\Users\\demo\\a.ts", "C:/Users/demo/a.ts"]) {
		assert.equal(
			shortenAssistantText(`open ${pathText} ok`, {
				maxWidth: 40,
				homeDir: path.win32.join("C:\\", "Users", "demo"),
			}),
			`open ${pathText} ok`,
		);
	}
});

test("shortenAssistantText keeps balanced parentheses in the URL href and label", () => {
	const options = { maxWidth: 40, homeDir: "/Users/demo" };

	const wiki = "https://en.wikipedia.org/wiki/International_Space_Station_(ISS)";
	const wikiOut = shortenAssistantText(`see ${wiki} ok`, options);
	assert.equal(
		wikiOut,
		`see [en.wikipedia.org/…tation_(ISS)](${wiki}) ok`,
	);

	const mdn =
		"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array_(...)";
	const mdnOut = shortenAssistantText(`see ${mdn} ok`, options);
	assert.equal(
		mdnOut,
		`see [developer.mozilla.org/…Array_(...)](${mdn}) ok`,
	);
});

test("shortenAssistantText leaves a prose-wrapping ')' outside the href", () => {
	const url = "https://example.com/a/very/long/path/that/is/certainly/long";
	const out = shortenAssistantText(`see (${url}) ok`, {
		maxWidth: 40,
		homeDir: "/Users/demo",
	});
	assert.equal(
		out,
		`see ([example.com/…rtainly/long](${url})) ok`,
	);
});

test("shortenAssistantText treats an unmatched trailing ')' as prose", () => {
	const url = "https://example.com/a/very/long/path/that/is/certainly/long";
	const out = shortenAssistantText(`see ${url}) ok`, {
		maxWidth: 40,
		homeDir: "/Users/demo",
	});
	assert.equal(
		out,
		`see [example.com/…rtainly/long](${url})) ok`,
	);
});

test("shortenAssistantText keeps a prose ')' outside the link before punctuation", () => {
	const url = "https://example.com/a/very/long/path/that/is/certainly/long";
	const out = shortenAssistantText(`see (${url}). ok`, {
		maxWidth: 40,
		homeDir: "/Users/demo",
	});
	assert.equal(
		out,
		`see ([example.com/…rtainly/long](${url})). ok`,
	);
});
