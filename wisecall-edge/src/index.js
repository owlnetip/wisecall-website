const callSession = require("./lib/callSession");
const contactMemory = require("./lib/contactMemory");
const integrationWebhooks = require("./lib/integrationWebhooks");
const emailSummary = require("./lib/emailSummary");
const { buildSystemPrompt } = require("./prompt");
const { saveCallLog } = require("./saveCallLog");
const latencyInstrumentation = require("./latencyInstrumentation");

module.exports = {
  ...callSession,
  ...contactMemory,
  ...integrationWebhooks,
  ...emailSummary,
  buildSystemPrompt,
  saveCallLog,
  ...latencyInstrumentation,
};
