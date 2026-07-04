/**
 * Build a SIPp UAC scenario XML that plays prompt WAVs and records RTP.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getScenario } from "./latency-scenarios.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buildSippScenarioXml(scenarioId) {
  const scenario = getScenario(scenarioId);
  const promptDir = path.join(__dirname, "sipp", "prompts", scenarioId);
  const manifestPath = path.join(promptDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Prompt audio not found for scenario "${scenarioId}". Run: node scripts/generate-latency-prompts.mjs --scenario=${scenarioId}`,
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const pauseMs = manifest.pauseAfterPromptMs || scenario.pauseAfterPromptSec * 1000;

  const playSteps = manifest.prompts
    .map((p) => {
      const wavPath = path.join(promptDir, p.filename);
      return `
  <nop>
    <action>
      <exec rtp_stream="${wavPath},loop=false"/>
    </action>
  </nop>
  <pause milliseconds="${pauseMs}"/>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="ISO-8859-1" ?>
<!DOCTYPE scenario SYSTEM "sipp.dtd">
<scenario name="WiseCall latency ${scenarioId}">
  <send retrans="500">
    <![CDATA[
      INVITE sip:[service]@[remote_ip]:[remote_port] SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: <sip:[field0]@[local_ip]:[local_port]>;tag=[call_number]
      To: <sip:[service]@[remote_ip]:[remote_port]>
      Call-ID: [call_id]
      CSeq: 1 INVITE
      Contact: <sip:[field0]@[local_ip]:[local_port];transport=[transport]>
      Max-Forwards: 70
      Content-Type: application/sdp
      Content-Length: [len]

      v=0
      o=user1 53655765 2353687637 IN IP[local_ip_type] [local_ip]
      s=WiseCall Latency Test
      c=IN IP[media_ip_type] [media_ip]
      t=0 0
      m=audio [media_port] RTP/AVP 0
      a=rtpmap:0 PCMU/8000
    ]]>
  </send>

  <recv response="100" optional="true"/>
  <recv response="180" optional="true"/>
  <recv response="183" optional="true"/>
  <recv response="200" rtd="true" crlf="true"/>
${playSteps}
  <pause milliseconds="3000"/>
  <send>
    <![CDATA[
      BYE sip:[service]@[remote_ip]:[remote_port] SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: <sip:[field0]@[local_ip]:[local_port]>;tag=[call_number]
      To: <sip:[service]@[remote_ip]:[remote_port]>[peer_tag_param]
      Call-ID: [call_id]
      CSeq: 2 BYE
      Contact: <sip:[field0]@[local_ip]:[local_port];transport=[transport]>
      Max-Forwards: 70
      Content-Length: 0
    ]]>
  </send>
  <recv response="200" crlf="true"/>
</scenario>`;
}

export function writeSippScenario(scenarioId, outPath) {
  const xml = buildSippScenarioXml(scenarioId);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, xml);
  return outPath;
}
