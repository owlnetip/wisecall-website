#!/usr/bin/env node
// Flags public tables created after the OWL-120 grants migration when that
// migration does not grant service_role in the same file, and flags anon or
// authenticated write grants on the OWL-121 service-role tables.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const MIGRATION_DIRS = [
  "supabase/migrations",
  "apps/portal/supabase/migrations",
];

const MARKER = "data-api-grants: service_role on existing public relations";

const SENSITIVE_TABLES = [
  "wisecall_outreach_email_events",
  "wisecall_follow_ups",
  "wisecall_agent_memory",
  "wisecall_demo_callback_rate_limits",
  "ofcom_cupid_codes",
];

const PAIRED_GRANTS = [
  "supabase/migrations/20261027120000_data_api_grants.sql",
  "apps/portal/supabase/migrations/0040_data_api_grants.sql",
];

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function normalize(sql) {
  return stripComments(sql).toLowerCase().replace(/\s+/g, " ").trim();
}

function versionOf(filename) {
  const match = path.basename(filename).match(/^(\d+)_/);
  return match ? Number(match[1]) : null;
}

function listMigrations(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql") && !name.includes(" 2.sql"))
    .map((name) => path.join(dir, name))
    .sort((a, b) => {
      const version = versionOf(a) - versionOf(b);
      if (version !== 0) return version;
      return path.basename(a).localeCompare(path.basename(b));
    });
}

function createdPublicTables(sql) {
  const tables = [];
  const re =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(public|private)\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/gi;
  for (const match of sql.matchAll(re)) {
    const schema = (match[1] || "public").toLowerCase();
    if (schema === "public") tables.push(match[2].toLowerCase());
  }
  return tables;
}

function createdPublicFunctions(sql) {
  const names = [];
  const re =
    /create\s+(?:or\s+replace\s+)?function\s+(?:(public|private)\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/gi;
  for (const match of sql.matchAll(re)) {
    const schema = (match[1] || "public").toLowerCase();
    if (schema === "public") names.push(match[2].toLowerCase());
  }
  return names;
}

function grantsServiceRoleTable(sql, table) {
  const text = normalize(sql);
  const privileges =
    "(?:all(?:\\s+privileges)?|select\\s*,\\s*insert\\s*,\\s*update\\s*,\\s*delete(?:\\s*,\\s*truncate)?)";
  const target = `(?:table\\s+)?(?:only\\s+)?(?:public\\s*\\.\\s*)?"?${table}"?`;
  const specific = new RegExp(
    `grant\\s+${privileges}\\s+on\\s+${target}\\s+to\\s+[^;]*\\bservice_role\\b`,
  );
  const allTables = new RegExp(
    `grant\\s+${privileges}\\s+on\\s+all\\s+tables\\s+in\\s+schema\\s+public\\s+to\\s+[^;]*\\bservice_role\\b`,
  );
  return specific.test(text) || allTables.test(text);
}

function needsSequenceGrant(sql) {
  const text = normalize(sql);
  return (
    /\b(smallserial|serial2|serial|bigserial)\b/.test(text) ||
    /generated\s+(?:always|by default)\s+as\s+identity/.test(text)
  );
}

function grantsServiceRoleSequence(sql) {
  const text = normalize(sql);
  return /grant\s+(?:usage\s*,\s*select|select\s*,\s*usage)\s+on\s+(?:all\s+sequences\s+in\s+schema\s+public|sequence\s+(?:public\s*\.\s*)?"?[a-z_][a-z0-9_]*"?)\s+to\s+[^;]*\bservice_role\b/.test(
    text,
  );
}

function grantsServiceRoleFunction(sql) {
  const text = normalize(sql);
  return /grant\s+execute\s+on\s+(?:function|routine|all\s+functions\s+in\s+schema\s+public)\s+[^;]*\bto\s+[^;]*\bservice_role\b/.test(
    text,
  ) || /grant\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+public\s+to\s+[^;]*\bservice_role\b/.test(text);
}

function clientWriteOnSensitive(sql) {
  const text = normalize(sql);
  const hits = [];
  if (
    /grant\s+(?:all(?:\s+privileges)?|(?:select\s*,\s*)?insert\s*,\s*update\s*,\s*delete)\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+[^;]*\b(anon|authenticated)\b/.test(
      text,
    )
  ) {
    hits.push("grant write on all public tables to anon or authenticated");
  }
  for (const table of SENSITIVE_TABLES) {
    const re = new RegExp(
      `grant\\s+([^;]+?)\\s+on\\s+(?:table\\s+)?(?:only\\s+)?(?:public\\s*\\.\\s*)?"?${table}"?\\s+to\\s+([^;]+)`,
      "g",
    );
    for (const match of text.matchAll(re)) {
      const privileges = match[1];
      const grantees = match[2];
      const write =
        /\ball(?:\s+privileges)?\b/.test(privileges) ||
        /\b(insert|update|delete|truncate)\b/.test(privileges);
      const client = /\b(anon|authenticated)\b/.test(grantees);
      if (write && client) hits.push(`${table}: ${match[0].trim()}`);
    }
  }
  return hits;
}

export function lintMigrationSources(files) {
  const errors = [];
  const ordered = [...files].sort((a, b) => {
    const version = versionOf(a.name) - versionOf(b.name);
    if (version !== 0) return version;
    return a.name.localeCompare(b.name);
  });
  const markers = ordered.filter((file) => file.sql.includes(MARKER));
  if (markers.length !== 1) {
    errors.push(
      `expected exactly one grants migration containing the marker, found ${markers.length}`,
    );
    return errors;
  }
  const marker = markers[0];
  const markerVersion = versionOf(marker.name);
  if (markerVersion == null) {
    errors.push(`${marker.name} is missing a numeric version prefix`);
    return errors;
  }
  for (const table of SENSITIVE_TABLES) {
    if (!marker.sql.includes(table)) {
      errors.push(`${marker.name} does not mention ${table}`);
    }
  }
  if (!marker.sql.includes("from PUBLIC, anon, authenticated")) {
    errors.push(`${marker.name} does not revoke anon/authenticated writes`);
  }

  for (const file of ordered) {
    const sql = stripComments(file.sql);
    for (const hit of clientWriteOnSensitive(sql)) {
      errors.push(`${file.name}: ${hit}`);
    }
    if (file.name === marker.name || versionOf(file.name) < markerVersion) continue;
    for (const table of createdPublicTables(sql)) {
      if (!grantsServiceRoleTable(sql, table)) {
        errors.push(
          `${file.name}: public.${table} is created without a service_role table grant`,
        );
      }
    }
    if (createdPublicTables(sql).length > 0 && needsSequenceGrant(sql) && !grantsServiceRoleSequence(sql)) {
      errors.push(
        `${file.name}: serial or identity column without a service_role sequence grant`,
      );
    }
    if (createdPublicFunctions(sql).length > 0 && !grantsServiceRoleFunction(sql)) {
      errors.push(
        `${file.name}: public function without a service_role execute grant`,
      );
    }
  }
  return errors;
}

function lintDirectory(relativeDir) {
  const dir = path.join(ROOT, relativeDir);
  const files = listMigrations(dir).map((file) => ({
    name: path.basename(file),
    sql: fs.readFileSync(file, "utf8"),
  }));
  return lintMigrationSources(files).map((error) => `${relativeDir}: ${error}`);
}

function selfTest() {
  const marker = {
    name: "0040_data_api_grants.sql",
    sql: `-- ${MARKER}\n${SENSITIVE_TABLES.join("\n")}\nrevoke insert, update, delete, truncate on table public.example from PUBLIC, anon, authenticated;\n`,
  };
  const cases = [
    {
      name: "historical create is covered by the later grants migration",
      files: [
        { name: "0001_old.sql", sql: "create table public.widgets (id uuid);" },
        marker,
      ],
      ok: true,
    },
    {
      name: "new table without a grant fails",
      files: [
        marker,
        { name: "0041_new.sql", sql: "create table public.widgets (id uuid primary key);" },
      ],
      ok: false,
    },
    {
      name: "new table with service_role grant passes",
      files: [
        marker,
        {
          name: "0041_new.sql",
          sql: `create table public.widgets (id bigint generated always as identity primary key);
                grant select, insert, update, delete on table public.widgets to service_role;
                grant usage, select on sequence public.widgets_id_seq to service_role;`,
        },
      ],
      ok: true,
    },
    {
      name: "identity column without a sequence grant fails",
      files: [
        marker,
        {
          name: "0041_new.sql",
          sql: `create table public.widgets (id bigserial primary key);
                grant select, insert, update, delete on public.widgets to service_role;`,
        },
      ],
      ok: false,
    },
    {
      name: "anon write on a locked table fails",
      files: [
        marker,
        {
          name: "0002_bad.sql",
          sql: "grant insert, update on wisecall_follow_ups to anon;",
        },
      ],
      ok: false,
    },
    {
      name: "service_role write on a locked table passes",
      files: [
        {
          name: "0002_ok.sql",
          sql: "grant select, insert, update, delete on table public.wisecall_follow_ups to service_role;",
        },
        marker,
      ],
      ok: true,
    },
  ];

  const failures = [];
  for (const testCase of cases) {
    const errors = lintMigrationSources(testCase.files);
    const passed = testCase.ok ? errors.length === 0 : errors.length > 0;
    if (!passed) {
      failures.push(`${testCase.name}: ${errors.join("; ") || "unexpected pass"}`);
    }
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(`self-test passed (${cases.length} cases)`);
}

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const errors = [];
  const [left, right] = PAIRED_GRANTS.map((file) => fs.readFileSync(path.join(ROOT, file)));
  if (!left.equals(right)) {
    errors.push(`${PAIRED_GRANTS[0]} and ${PAIRED_GRANTS[1]} differ`);
  }
  for (const dir of MIGRATION_DIRS) errors.push(...lintDirectory(dir));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`supabase grants check passed (${MIGRATION_DIRS.length} migration trees)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
