const callSession = require("./lib/callSession");
const contactMemory = require("./lib/contactMemory");
const integrationWebhooks = require("./lib/integrationWebhooks");
const emailSummary = require("./lib/emailSummary");
const voicePipeline = require("./lib/voicePipeline");
const transferRecording = require("./lib/transferRecording");
const { buildSystemPrompt } = require("./prompt");
const { saveCallLog, updateCallLogTranscript } = require("./saveCallLog");

module.exports = {
  ...callSession,
  ...contactMemory,
  ...integrationWebhooks,
  ...emailSummary,
  ...voicePipeline,
  ...transferRecording,
  buildSystemPrompt,
  saveCallLog,
  updateCallLogTranscript,
};
