export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_VERSIONS = {
  "@earendil-works/pi-agent-core": "1.1.0",
  "@earendil-works/pi-ai": "1.1.0",
  "@earendil-works/pi-coding-agent": "1.1.0",
  "@earendil-works/pi-tui": "1.1.0",
};
export const UNHANDLED_ERROR_PATTERN = /UnhandledPromiseRejection|uncaught exception|shutdown error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /Failed to load extension|Error loading extension/i;
export const SMOKE_URL = "https://example.com/a/very/long/path/that/should/be/rewritten/without/wrapping/over/terminal/columns";
export const SMOKE_PATH = "/alpha/beta/gamma/delta/epsilon/zeta/eta/theta/iota/kappa/lambda/mu/nu/file.ts";
export const SMOKE_RESPONSE = `Long URL: ${SMOKE_URL}\nLong path: ${SMOKE_PATH}`;

export function parseJsonLines(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function assertion(id, expected, observed, passed) {
  return { id, expected, observed: JSON.stringify(observed), passed: passed === true };
}

function extensionStatus(responses) {
  return responses.find((row) => row?.type === "extension_ui_request"
    && row.method === "setStatus" && row.statusKey === "pi-short-links"
    && row.statusText === "short-links: OSC 8 on");
}

function assistantText(responses) {
  const endings = responses.filter((row) => row?.type === "message_end" && row.message?.role === "assistant");
  const message = endings.at(-1)?.message;
  return Array.isArray(message?.content)
    ? message.content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n")
    : "";
}

export function featureResponse(responses, providerRequests) {
  const text = assistantText(responses);
  const links = [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({ label: match[1], href: match[2] }));
  const urlLink = links.find((link) => link.href === SMOKE_URL);
  const pathLink = links.find((link) => link.href.startsWith("file:") && link.label.includes("file.ts"));
  return {
    text,
    providerRequests,
    url: urlLink ?? null,
    path: pathLink ?? null,
    passed: providerRequests > 0
      && !!urlLink && urlLink.label.includes("example.com") && urlLink.label.includes("…") && urlLink.label.length < SMOKE_URL.length
      && !!pathLink && pathLink.label.includes("…") && pathLink.label.length < SMOKE_PATH.length,
  };
}

export function behaviorAssertions(name, {
  responses = [], fullOutput = "", exit_code = null, processExited = false,
  timedOut = false, providerRequests = 0, expectedVersion = "1.1.0",
}) {
  const status = extensionStatus(responses);
  if (name === "extension_load") {
    return [assertion("extension_registered", "Actual Pi emits the pi-short-links OSC 8 status during session start", status ?? null, !!status)];
  }
  if (name === "happy_path") {
    const feature = featureResponse(responses, providerRequests);
    return [assertion("feature_response", "Actual Pi returns shortened URL and file-path links with their original targets", feature, feature.passed)];
  }
  if (name === "error_path") {
    const parse = responses.find((row) => row?.type === "response" && row.command === "parse");
    const passed = !!parse && parse.success === false && typeof parse.error === "string" && parse.error.length > 0
      && exit_code === 0 && processExited && !timedOut && !UNHANDLED_ERROR_PATTERN.test(fullOutput);
    return [assertion("handled_error", "Malformed RPC JSON returns an observed parse error and Pi shuts down cleanly", {
      response: parse ?? null, exit_code, processExited, timedOut,
    }, passed)];
  }
  if (name === "reload_cleanup") {
    const feature = featureResponse(responses, providerRequests);
    const clean = exit_code === 0 && processExited && !timedOut && !UNHANDLED_ERROR_PATTERN.test(fullOutput);
    return [
      assertion("reloaded_extension_registered", "The second actual Pi host emits the pi-short-links OSC 8 status", status ?? null, !!status),
      assertion("reloaded_feature_response", "The second actual host shortens both feature links and preserves their targets", feature, feature.passed),
      assertion("clean_shutdown", "The second host exits zero without unhandled or shutdown errors", {
        exit_code, processExited, timedOut, errors: UNHANDLED_ERROR_PATTERN.test(fullOutput),
      }, clean),
    ];
  }
  if (name === "host_shell") {
    const output = fullOutput.trim();
    return [assertion("native_shell_boundary", "The native host shell launches the locally pinned Pi CLI and returns exactly its version", {
      exit_code, processExited, output, expectedVersion,
    }, exit_code === 0 && processExited && !timedOut && output === expectedVersion)];
  }
  throw new Error(`Unknown smoke case: ${name}`);
}
