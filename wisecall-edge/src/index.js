const callSession = require("./lib/callSession");
const contactMemory = require("./lib/contactMemory");
const integrationWebhooks = require("./lib/integrationWebhooks");
const emailSummary = require("./lib/emailSummary");
const voicePipeline = require("./lib/voicePipeline");
const { buildSystemPrompt } = require("./prompt");
const { saveCallLog } = require("./saveCallLog");

module.exports = {
  ...callSession,
  ...contactMemory,
  ...integrationWebhooks,
  ...emailSummary,
  ...voicePipeline,
  buildSystemPrompt,
  saveCallLog,
};
