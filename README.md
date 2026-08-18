# Pi Short Links

Shorten long URLs and absolute file paths in Pi assistant output so clickable links fit the terminal pane.

## Why

Long bare URLs wrap across lines. Terminals that only detect text URLs (or terminals Pi does not yet mark as OSC 8-capable) open only the first wrapped line. This package:

1. Forces OSC 8 hyperlinks when `FORCE_HYPERLINK=1` or `TERM_PROGRAM=Orca`
2. Rewrites assistant text that exceeds the pane width into short markdown links (`[host/…tail](full-url)`, `[~/dir/…/file](file://…)`)
3. Leaves fenced code blocks untouched

## Install

```bash
pi install npm:pi-short-links
# or local dogfood
pi install /path/to/pi-short-links
```

Add to project `.pi/settings.json` `packages`:

```json
"../../OSS/pi-short-links"
```

## Features

- Pane-width-aware shortening for bare `http(s)` URLs
- Absolute / `~/` path shortening with `file://` targets
- Skips content inside ` ``` ` fences
- Does not rewrite existing markdown links' destinations

## Non-goals

- Orca-specific wrap-join fixes
- Public URL shorteners
- Rewriting tool-result bodies (assistant text only in v0.1)

## Development

```bash
npm install
npm test
npm run typecheck
```
