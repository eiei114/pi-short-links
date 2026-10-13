import assert from "node:assert/strict";
import test from "node:test";
import {
  behaviorAssertions, parseJsonLines, SMOKE_PATH, SMOKE_URL, VERIFICATION_CONTRACT,
} from "../scripts/pi-sdk-smoke-contract.mjs";

const status = { type: "extension_ui_request", method: "setStatus", statusKey: "pi-short-links", statusText: "short-links: OSC 8 on" };
const assistant = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text:
  `Long URL: [example.com/…columns](${SMOKE_URL})\nLong path: [/alpha/…/file.ts](file://${SMOKE_PATH})` }] } };
const successfulHost = (responses = [status, assistant], overrides = {}) => ({
  responses, fullOutput: "", exit_code: 0, processExited: true, timedOut: false,
  providerRequests: 1, expectedVersion: "1.1.0", ...overrides,
});

test("behavior contract ID and JSONL parsing support LF/CRLF and ignore malformed lines", () => {
  const prompt = { type: "response", command: "prompt", success: true };
  assert.equal(VERIFICATION_CONTRACT, "pi-sdk-behavior-v2");
  assert.deepEqual(parseJsonLines(`bad-json\r\n${JSON.stringify(prompt)}\n\n`), [prompt]);
});

test("extension registration requires the real package status event", () => {
  assert.deepEqual(behaviorAssertions("extension_load", successfulHost())[0].id, "extension_registered");
  assert.equal(behaviorAssertions("extension_load", successfulHost())[0].passed, true);
  for (const responses of [[], [{ ...status, statusKey: "other" }], [{ ...status, statusText: "failed" }]]) {
    assert.equal(behaviorAssertions("extension_load", successfulHost(responses))[0].passed, false);
  }
});

test("feature response requires the shortened URL and path links with original targets", () => {
  const assertions = behaviorAssertions("happy_path", successfulHost());
  assert.equal(assertions[0].id, "feature_response");
  assert.equal(assertions[0].passed, true);
  for (const responses of [[], [status], [status, { ...assistant, message: { ...assistant.message, content: [{ type: "text", text: `Long URL: [short](https://wrong.example/)\n${SMOKE_PATH}` }] } }]]) {
    assert.equal(behaviorAssertions("happy_path", successfulHost(responses))[0].passed, false);
  }
  for (const target of ["file:///alpha/beta/file.ts", "file:///alpha/beta/gamma/delta/file.ts"]) {
    const wrongTarget = { ...assistant, message: { ...assistant.message, content: [{ type: "text", text:
      `Long URL: [example.com/…columns](${SMOKE_URL})\nLong path: [/alpha/…/file.ts](${target})` }] } };
    assert.equal(behaviorAssertions("happy_path", successfulHost([status, wrongTarget]))[0].passed, false);
  }
  const encodedPath = SMOKE_PATH.replace("/alpha", "/%61lpha");
  const windowsPath = { ...assistant, message: { ...assistant.message, content: [{ type: "text", text:
    `Long URL: [example.com/…columns](${SMOKE_URL})\nLong path: [/alpha/…/file.ts](file:///C:${encodedPath})` }] } };
  assert.equal(behaviorAssertions("happy_path", successfulHost([status, windowsPath]))[0].passed, true);
  assert.equal(behaviorAssertions("happy_path", successfulHost([status, assistant], { providerRequests: 0 }))[0].passed, false);
});

test("handled error requires an observed negative RPC response and clean process exit", () => {
  const parseError = { type: "response", command: "parse", success: false, error: "Invalid JSON" };
  assert.equal(behaviorAssertions("error_path", successfulHost([parseError]))[0].id, "handled_error");
  assert.equal(behaviorAssertions("error_path", successfulHost([parseError]))[0].passed, true);
  for (const responses of [[], [{ ...parseError, success: true }], [{ ...parseError, error: "" }]]) {
    assert.equal(behaviorAssertions("error_path", successfulHost(responses))[0].passed, false);
  }
  assert.equal(behaviorAssertions("error_path", successfulHost([parseError], { exit_code: 1 }))[0].passed, false);
  assert.equal(behaviorAssertions("error_path", successfulHost([parseError], { fullOutput: "shutdown error" }))[0].passed, false);
});

test("reload requires second-host registration, feature response, and clean shutdown", () => {
  const good = behaviorAssertions("reload_cleanup", successfulHost());
  assert.deepEqual(good.map((assertion) => assertion.id), [
    "reloaded_extension_registered", "reloaded_feature_response", "clean_shutdown",
  ]);
  assert.ok(good.every((assertion) => assertion.passed));
  for (const responses of [[], [assistant], [status], [status, { ...assistant, message: { ...assistant.message, content: [] } }]]) {
    assert.ok(behaviorAssertions("reload_cleanup", successfulHost(responses)).some((assertion) => !assertion.passed));
  }
  for (const overrides of [
    { exit_code: 1 }, { processExited: false }, { timedOut: true }, { fullOutput: "UnhandledPromiseRejection" },
  ]) {
    assert.equal(behaviorAssertions("reload_cleanup", successfulHost(undefined, overrides))[2].passed, false);
  }
});

test("native shell must return exactly the pinned Pi CLI version", () => {
  assert.equal(behaviorAssertions("host_shell", successfulHost([], { fullOutput: "1.1.0\r\n" }))[0].id, "native_shell_boundary");
  assert.equal(behaviorAssertions("host_shell", successfulHost([], { fullOutput: "1.1.0\r\n" }))[0].passed, true);
  for (const value of ["", "11.1.0", "1.1.0 extra", "1.0.0"]) {
    assert.equal(behaviorAssertions("host_shell", successfulHost([], { fullOutput: value }))[0].passed, false);
  }
});
