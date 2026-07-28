import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWebsiteKnowledgeUrls, isDentalKnowledgeContext, websiteHomeUrl } from "./website-kb-paths";

test("normalises the homepage URL", () => {
  assert.equal(websiteHomeUrl("thedentalhub.com/fees"), "https://thedentalhub.com/");
  assert.equal(websiteHomeUrl("https://www.example.co.uk/about?x=1#fees"), "https://www.example.co.uk/");
});

test("detects dental agents", () => {
  assert.equal(isDentalKnowledgeContext("dentally", "General"), true);
  assert.equal(isDentalKnowledgeContext("receptionist", "Dental practice"), true);
  assert.equal(isDentalKnowledgeContext("receptionist", "Estate agency"), false);
});

test("includes fees first for dental websites", () => {
  const urls = buildWebsiteKnowledgeUrls("https://www.thedentalhub.com", {
    templateId: "dentally",
  });
  assert.equal(urls[0], "https://www.thedentalhub.com/");
  assert.deepEqual(urls.slice(1, 4), [
    "https://www.thedentalhub.com/fees/",
    "https://www.thedentalhub.com/private-fees/",
    "https://www.thedentalhub.com/treatment-fees/",
  ]);
});

test("deduplicates overlapping paths", () => {
  const urls = buildWebsiteKnowledgeUrls("https://example.com/", { industry: "Dental" });
  const normalized = urls.map((url) => url.replace(/\/+$/, "") || url);
  assert.equal(new Set(normalized).size, normalized.length);
});
