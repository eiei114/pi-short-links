import assert from "node:assert/strict";
import test from "node:test";
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
