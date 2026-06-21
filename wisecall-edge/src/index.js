const callSession = require("./lib/callSession");
const contactMemory = require("./lib/contactMemory");
const integrationWebhooks = require("./lib/integrationWebhooks");
const { buildSystemPrompt } = require("./prompt");
const { saveCallLog } = require("./saveCallLog");

module.exports = {
  ...callSession,
  ...contactMemory,
  ...integrationWebhooks,
  buildSystemPrompt,
  saveCallLog,
};
