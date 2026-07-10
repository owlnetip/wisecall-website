/**
 * Place an outbound latency test call via MOR SIP using SIPp.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMorSipConfig, loadMorConfig, normaliseUkDid } from "./mor-client.mjs";
import { writeSippScenario } from "./build-sipp-scenario.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function findSippBinary() {
  const fromEnv = process.env.SIPP_BIN?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return "sipp";
}

/**
 * Run one outbound SIP call through MOR to the target WiseCall DID.
 * Returns paths to SIPp logs and optional RTP recording trace.
 */
export async function placeMorSipCall({
  targetNumber,
  scenarioId,
  testRunId,
  callIndex = 0,
}) {
  const config = loadMorConfig();
  assertMorSipConfig(config);

  const service = normaliseUkDid(targetNumber);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `wisecall-latency-${testRunId.slice(0, 8)}-`));
  const scenarioPath = path.join(workDir, `latency-${scenarioId}.xml`);
  writeSippScenario(scenarioId, scenarioPath);

  const logPrefix = path.join(workDir, `call-${callIndex}`);
  const sippBin = findSippBinary();

  const args = [
    "-sf",
    scenarioPath,
    "-s",
    service,
    "-ap",
    config.sipUser,
    "-au",
    config.sipPassword,
    "-m",
    "1",
    "-timeout",
    "180s",
    "-trace_msg",
    "-trace_err",
    "-trace_logs",
    "-log_file",
    logPrefix,
    "-rtp_echo",
    "-r",
    "1",
    `${config.sipHost}:${config.sipPort}`,
  ];

  console.log(`  SIPp → sip:${service}@${config.sipHost}:${config.sipPort} (user ${config.sipUser})`);

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(sippBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "SIPp not found. Install SIPp (apt install sip-tester / brew install sipp) or set SIPP_BIN.",
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => resolve(code ?? 1));
  });

  const messagesLog = `${logPrefix}_messages.log`;
  const errorLog = `${logPrefix}_errors.log`;

  return {
    ok: exitCode === 0,
    exitCode,
    workDir,
    service,
    callerNumber: config.sipUser,
    morSipHost: config.sipHost,
    logs: { messagesLog, errorLog, stdoutPath: `${logPrefix}.log` },
    morCallRef: extractCallId(messagesLog),
  };
}

function extractCallId(messagesLog) {
  if (!fs.existsSync(messagesLog)) return null;
  const content = fs.readFileSync(messagesLog, "utf8");
  const m = content.match(/Call-ID:\s*([^\s]+)/i);
  return m?.[1] || null;
}
