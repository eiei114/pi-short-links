import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  behaviorAssertions, EXTENSION_LOAD_ERROR_PATTERN, parseJsonLines, SDK_VERSIONS,
  UNHANDLED_ERROR_PATTERN, VERIFICATION_CONTRACT, SMOKE_RESPONSE,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(root, "docs/verification/pi-sdk-smoke.json");
const PROBE_TIMEOUT_MS = 15_000;
const CLEANUP_GRACE_MS = 1_000;
const STATUS_EVENT = (record) => record?.type === "extension_ui_request"
  && record.method === "setStatus" && record.statusKey === "pi-short-links"
  && record.statusText === "short-links: OSC 8 on";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(resolve(root, "package.json"));

for (const [name, version] of Object.entries(SDK_VERSIONS)) {
  const installedVersion = readJson(resolve(root, "node_modules", name, "package.json")).version;
  if (manifest.devDependencies?.[name] !== version || installedVersion !== version) {
    throw new Error(`Smoke requires exact dev/test pin ${name}@${version}; declared=${manifest.devDependencies?.[name]}, installed=${installedVersion}`);
  }
}

const codingAgentRoot = resolve(root, "node_modules/@earendil-works/pi-coding-agent");
const piManifest = readJson(resolve(codingAgentRoot, "package.json"));
const piCli = resolve(codingAgentRoot, piManifest.bin.pi);
const agentDir = mkdtempSync(resolve(tmpdir(), "pi-short-links-sdk-smoke-"));
const providerRequests = [];
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString("utf8");
  let body = null;
  try { body = JSON.parse(bodyText); } catch { /* recorded as a failed provider request below */ }
  providerRequests.push({ method: request.method, url: request.url, body });
  if (request.method !== "POST" || request.url !== "/v1/chat/completions" || body?.model !== "short-links-smoke") {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Unexpected deterministic smoke request" } }));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const chunk = { id: "pi-short-links-smoke", object: "chat.completion.chunk", created: 1, model: body.model };
  response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: SMOKE_RESPONSE }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  response.end("data: [DONE]\n\n");
});

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveListen(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

function runRpc(label, inputLine, shouldClose) {
  const args = [piCli, "--offline", "--no-session", "--no-tools", "--no-extensions", "--no-skills",
    "--no-context-files", "--no-prompt-templates", "--no-mcp", "-e", ".",
    "--provider", "pi-short-links-smoke", "--model", "short-links-smoke", "--mode", "rpc"];
  const hostCommand = `node <installed Pi 1.1.0 CLI> --offline --no-session --no-tools --no-extensions -e . --provider pi-short-links-smoke --model short-links-smoke --mode rpc (${label})`;
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, FORCE_HYPERLINK: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let buffer = "";
    let timedOut = false;
    let closedNormally = false;
    let exitCode = null;
    let exitSignal = null;
    let spawnError = null;
    let finished = false;
    const responses = [];
    let cleanupTimer;
    const operationTimer = setTimeout(() => {
      timedOut = true;
      child.kill();
      cleanupTimer = setTimeout(() => finish(), CLEANUP_GRACE_MS);
    }, PROBE_TIMEOUT_MS);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(operationTimer);
      clearTimeout(cleanupTimer);
      resolveRun({
        label, command: hostCommand, stdout, stderr, responses, exit_code: exitCode,
        signal: exitSignal, processExited: closedNormally, timedOut, spawnError,
      });
    };
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          responses.push(record);
          if (shouldClose(record)) child.stdin.end();
        } catch { /* non-protocol stdout is retained for error checks */ }
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", (error) => { spawnError ??= error.message; });
    child.once("error", (error) => { spawnError = error.message; finish(); });
    child.once("close", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      closedNormally = true;
      finish();
    });
    child.once("spawn", () => {
      child.stdin.write(`${inputLine}\n`);
    });
  });
}

function caseResult(name, run, providerCount = 0) {
  const fullOutput = `${run.stdout}\n${run.stderr}`;
  const assertions = behaviorAssertions(name, {
    responses: run.responses,
    fullOutput,
    exit_code: run.exit_code,
    processExited: run.processExited,
    timedOut: run.timedOut,
    providerRequests: providerCount,
    expectedVersion: piManifest.version,
  });
  const evidenceRecords = run.responses.filter((record) => STATUS_EVENT(record)
    || record?.type === "response"
    || record?.type === "agent_settled"
    || (record?.type === "message_end" && record.message?.role === "assistant"));
  const evidence = JSON.stringify({
    command: run.command,
    exit_code: run.exit_code,
    signal: run.signal,
    process_exit_observed: run.processExited,
    timed_out: run.timedOut,
    spawn_error: run.spawnError,
    provider_requests: providerCount,
    rpc_records: evidenceRecords,
    diagnostics: run.stderr.split(/\r?\n/).filter((line) => UNHANDLED_ERROR_PATTERN.test(line) || EXTENSION_LOAD_ERROR_PATTERN.test(line)),
  });
  return {
    name, command: "npm run smoke:pi", exit_code: run.exit_code,
    passed: run.exit_code === 0 && run.processExited && !run.timedOut && !run.spawnError
      && assertions.every((assertion) => assertion.passed)
      && !UNHANDLED_ERROR_PATTERN.test(fullOutput) && !EXTENSION_LOAD_ERROR_PATTERN.test(fullOutput),
    evidence, assertions, capturedOutput: fullOutput,
  };
}

function runHostShell() {
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
  let executable;
  let args;
  let command;
  if (process.platform === "win32") {
    executable = resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const shellLine = `& ${quote(process.execPath)} ${quote(piCli)} --no-extensions --version; exit $LASTEXITCODE`;
    args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", shellLine];
    command = "PowerShell (native Windows): local node + installed Pi 1.1.0 CLI --no-extensions --version";
  } else {
    executable = "/bin/sh";
    args = ["-c", '"$1" "$2" --no-extensions --version', "pi-host-shell", process.execPath, piCli];
    command = "/bin/sh (native POSIX): local node + installed Pi 1.1.0 CLI --no-extensions --version";
  }
  const result = spawnSync(executable, args, {
    cwd: root, env, encoding: "utf8", timeout: PROBE_TIMEOUT_MS, windowsHide: true,
  });
  const fullOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const timedOut = result.error?.code === "ETIMEDOUT";
  const processExited = result.status !== null && result.status !== undefined && !timedOut && !result.error;
  const assertions = behaviorAssertions("host_shell", {
    fullOutput, exit_code: result.status, processExited, timedOut, expectedVersion: piManifest.version,
  });
  const evidence = JSON.stringify({ command, exit_code: result.status, signal: result.signal ?? null,
    process_exit_observed: processExited, timed_out: timedOut, output: fullOutput.trim() });
  return { name: "host_shell", command, exit_code: result.status,
    passed: assertions.every((assertion) => assertion.passed), evidence, assertions, capturedOutput: fullOutput };
}

let cases = [];
try {
  const providerPort = await listen(provider);
  const modelConfig = {
    providers: {
      "pi-short-links-smoke": {
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        api: "openai-completions",
        apiKey: "offline-smoke-only",
        models: [{ id: "short-links-smoke", name: "Deterministic local smoke", api: "openai-completions",
          contextWindow: 4096, maxTokens: 256, input: ["text"], output: ["text"], reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      },
    },
  };
  writeFileSync(resolve(agentDir, "models.json"), `${JSON.stringify(modelConfig, null, 2)}\n`);

  const extensionRun = await runRpc("load check", JSON.stringify({ type: "get_state" }), STATUS_EVENT);
  cases.push(caseResult("extension_load", extensionRun));

  const errorRun = await runRpc("malformed-input check", "not-json", (record) => record?.type === "response" && record.command === "parse");
  cases.push(caseResult("error_path", errorRun));

  const beforeHappyRequests = providerRequests.length;
  const happyRun = await runRpc("feature check", JSON.stringify({ id: "happy-prompt", type: "prompt", message: "Return the deterministic feature sample." }),
    (record) => record?.type === "agent_settled");
  cases.push(caseResult("happy_path", happyRun, providerRequests.length - beforeHappyRequests));

  // Exercise disposal and a fresh second Pi process: both hosts are real SDK processes.
  const beforeReload = await runRpc("first reload host", JSON.stringify({ type: "get_state" }), STATUS_EVENT);
  const beforeReloadRequests = providerRequests.length;
  const reloadRun = await runRpc("second reload host feature check", JSON.stringify({ id: "reload-prompt", type: "prompt", message: "Return the deterministic feature sample again." }),
    (record) => record?.type === "agent_settled");
  const reloadResult = caseResult("reload_cleanup", reloadRun, providerRequests.length - beforeReloadRequests);
  const firstOutput = `${beforeReload.stdout}\n${beforeReload.stderr}`;
  const firstLoadError = EXTENSION_LOAD_ERROR_PATTERN.test(firstOutput);
  const firstUnhandledError = UNHANDLED_ERROR_PATTERN.test(firstOutput);
  reloadResult.assertions.find((assertion) => assertion.id === "clean_shutdown").observed = JSON.stringify({
    first_host_exit_code: beforeReload.exit_code,
    first_host_process_exit_observed: beforeReload.processExited,
    first_host_timed_out: beforeReload.timedOut,
    second_host_exit_code: reloadRun.exit_code,
    second_host_process_exit_observed: reloadRun.processExited,
    second_host_timed_out: reloadRun.timedOut,
    errors: firstUnhandledError || UNHANDLED_ERROR_PATTERN.test(reloadResult.capturedOutput),
  });
  reloadResult.assertions.find((assertion) => assertion.id === "clean_shutdown").passed
    = reloadResult.assertions.find((assertion) => assertion.id === "clean_shutdown").passed
      && beforeReload.exit_code === 0 && beforeReload.processExited && !beforeReload.timedOut
      && !firstLoadError && !firstUnhandledError;
  reloadResult.evidence = JSON.stringify({
    first_process: { command: beforeReload.command, exit_code: beforeReload.exit_code,
      signal: beforeReload.signal, process_exit_observed: beforeReload.processExited,
      timed_out: beforeReload.timedOut, rpc_records: beforeReload.responses.filter((record) => STATUS_EVENT(record) || record?.type === "response") },
    second_process: JSON.parse(reloadResult.evidence),
  });
  reloadResult.capturedOutput = `${firstOutput}\n${reloadResult.capturedOutput}`;
  reloadResult.passed = reloadResult.passed && beforeReload.exit_code === 0 && beforeReload.processExited
    && !beforeReload.timedOut && !firstLoadError && !firstUnhandledError;
  cases.push(reloadResult);

  cases.push(runHostShell());
  const report = {
    schema_version: 1,
    verification_contract: VERIFICATION_CONTRACT,
    sdk_versions: SDK_VERSIONS,
    platform: process.platform,
    model_inference: "none; real Pi RPC uses an ephemeral local deterministic OpenAI-compatible endpoint; Pi loader, extension lifecycle, and feature hooks are not mocked",
    unhandled_errors: cases.filter((item) => UNHANDLED_ERROR_PATTERN.test(item.capturedOutput)).length,
    extension_load_errors: cases.filter((item) => EXTENSION_LOAD_ERROR_PATTERN.test(item.capturedOutput)
      || (item.name === "extension_load" && !item.assertions.every((assertion) => assertion.passed))).length,
    cases: cases.map(({ capturedOutput, ...item }) => item),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ verification_contract: VERIFICATION_CONTRACT, platform: process.platform,
    unhandled_errors: report.unhandled_errors, extension_load_errors: report.extension_load_errors,
    cases: cases.map(({ name, passed, exit_code }) => ({ name, passed, exit_code })) }));
  if (cases.some((item) => !item.passed) || report.unhandled_errors !== 0 || report.extension_load_errors !== 0) process.exitCode = 1;
} finally {
  await closeServer(provider);
  rmSync(agentDir, { recursive: true, force: true });
}
