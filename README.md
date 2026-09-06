# Pi Short Links

[![Join dotfield.xyz on Discord](https://img.shields.io/badge/Join%20dotfield.xyz%20on%20Discord-5865F2?logo=discord&logoColor=white)](https://discord.gg/4945dXZVW5)

[![CI](https://github.com/eiei114/pi-short-links/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-short-links/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/pi-short-links/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-short-links/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/pi-short-links.svg)](https://www.npmjs.com/package/pi-short-links)
[![npm downloads](https://img.shields.io/npm/dm/pi-short-links.svg)](https://www.npmjs.com/package/pi-short-links)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![Trusted Publishing](https://img.shields.io/badge/npm-Trusted%20Publishing-blue.svg)](docs/release.md)
<a href="https://buymeacoffee.com/ekawano114m"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60"></a>

> Shorten long URLs and file paths in Pi assistant output so links fit the pane and stay clickable.

## What this is

Pi Short Links is a TypeScript Pi package that rewrites long bare `http(s)` URLs and absolute/`~/` paths in assistant text into short markdown links (`[host/…tail](full-url)`, `[~/dir/…/file](file://…)`). When `FORCE_HYPERLINK=1` or `TERM_PROGRAM=Orca`, it also forces Pi TUI OSC 8 hyperlinks on. Fenced code blocks are left untouched.

## Features

- Pane-width-aware shortening for bare `http(s)` URLs.
- Absolute / `~/` path shortening with `file://` targets.
- Forces OSC 8 hyperlinks when `FORCE_HYPERLINK=1` or `TERM_PROGRAM=Orca`.
- Skips content inside fenced code blocks.
- Does not rewrite existing markdown links' destinations.

## Install

Install the published npm package with Pi:

```bash
pi install npm:pi-short-links
```

Pin a specific version when you want reproducible installs:

```bash
pi install npm:pi-short-links@0.2.0
```

Install into the current project instead of your user Pi settings:

```bash
pi install npm:pi-short-links -l
```

Or install from GitHub:

```bash
pi install git:github.com/eiei114/pi-short-links
```

Try it without permanently installing:

```bash
pi -e npm:pi-short-links
```

## Quick start

Try the local checkout without permanently installing it:

```bash
FORCE_HYPERLINK=1 pi -e .
```

Then send a message containing a long URL or absolute file path and confirm it renders as a short clickable link.

## Package contents

| Path | Purpose |
|---|---|
| `extensions/short-links.ts` | Assistant-text shortening hook and OSC 8 force |
| `lib/shorten.ts` | URL/path shortening logic |
| `docs/release.md` | Trusted Publishing and release flow |
| `README.md` | GitHub and npm package entrypoint |
| `CHANGELOG.md` | Versioned release notes |
| `LICENSE` | MIT license |

## Development

```bash
npm install
npm run ci
npm pack --dry-run
FORCE_HYPERLINK=1 pi -e .
```

## Release

This package is set up for npm Trusted Publishing, so no `NPM_TOKEN` is required.

```bash
npm version minor
git push
```

See [`docs/release.md`](docs/release.md) for setup details.

## Docs

- [`docs/release.md`](docs/release.md) — Trusted Publishing and automated release details
- [`ROADMAP.md`](ROADMAP.md) — current status and planned work

## Security

Pi packages can execute code with your local permissions. Review extensions before installing third-party packages.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## Links

- npm: https://www.npmjs.com/package/pi-short-links
- GitHub: https://github.com/eiei114/pi-short-links
- Issues: https://github.com/eiei114/pi-short-links/issues

## License

MIT
