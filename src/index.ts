#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// How long the actor run itself is allowed to take, in seconds. The suite's
// slowest measured run on 2026-09-22 was 152 s on a seven platform search, so
// 1800 s is roughly twelve times that: headroom for a slow day without letting a
// hung run bill indefinitely.
const ACTOR_RUN_TIMEOUT_SECS = 1800;

// How long this wrapper waits for that run, in milliseconds. The actor's own
// timeout plus two minutes, so the run's own TIMED-OUT status is what the
// caller sees rather than the wrapper giving up first and reporting nothing.
const WRAPPER_WAIT_MS = (ACTOR_RUN_TIMEOUT_SECS + 120) * 1000;
const POLL_INTERVAL_MS = 3000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. Apify's synchronous endpoints carry a platform
// ceiling of 300 seconds on the HTTP wait itself and answer 408 past it whatever
// the timeout parameter says, so a long run reads as a timeout even though the
// actor goes on to finish. Starting the run, polling it to a terminal status and
// then reading the dataset is the only way to wait as long as the actor needs.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const headers = {
    Authorization: `Bearer ${APIFY_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const httpError = async (response: Response): Promise<string> => {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }
    switch (response.status) {
      case 400:
        return `The ${actorLabel} run was rejected as invalid input.${detail}`;
      case 401:
        return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
      case 402:
        return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
      default:
        return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
  };

  // 1. Start the run.
  let started: Response;
  try {
    started = await fetch(
      `https://api.apify.com/v2/acts/${actorPath}/runs?timeout=${ACTOR_RUN_TIMEOUT_SECS}`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }
  if (!started.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
  }

  let run: { id?: string; status?: string; defaultDatasetId?: string };
  try {
    run = ((await started.json()) as { data?: typeof run }).data ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
  }
  const runId = run.id;
  if (!runId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
  }

  // 2. Poll to a terminal status.
  const deadline = Date.now() + WRAPPER_WAIT_MS;
  let status = run.status ?? "READY";
  let datasetId = run.defaultDatasetId;
  while (!TERMINAL.has(status)) {
    if (Date.now() >= deadline) {
      return {
        isError: true,
        content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
      };
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
    }
    if (!poll.ok) {
      return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
    }
    const body = (await poll.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    status = body.data?.status ?? status;
    datasetId = body.data?.defaultDatasetId ?? datasetId;
  }

  // 3. A run that did not succeed is a failure the caller must see, never an
  // empty success. Surfacing it here is what keeps a crashed run from reading
  // as "no results found".
  if (status !== "SUCCEEDED") {
    return {
      isError: true,
      content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
    };
  }
  if (!datasetId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
  }

  // 4. Read the dataset.
  let ds: Response;
  try {
    ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
  }
  if (!ds.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
  }

  let items: unknown;
  try {
    items = await ds.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

const server = new McpServer({
  name: "mamba-job-change-tracker",
  version: pkg.version,
});

// Job Change Tracker (immutable actor ID L8UbEmMJC1XYPSZOb). Every buyer facing input of the live actor
// is exposed; provider keys are the caller's own and go straight to the run.
server.registerTool(
  "track_job_change",
  {
    title: "Track job change",
    description:
      "Check whether one contact, or a list of contacts, still works at the company your records hold. Returns one flat, Clay-ready JSON row per person: current employer, title, start month, role history, status (left, landed, promoted, or still there), how the person was matched, the source of the answer, and that source's date, with a namesake check. Runs on data you send (known_history) and on your own Serper or SerpApi, Prospeo, and BounceBan keys passed as inputs; this tool never fetches LinkedIn and holds no key of its own. Provide person_name with company_domain or company_name, or a people list. A run that does not succeed is returned as an error with its run ID. Read-only; requires an APIFY_TOKEN and consumes Apify credits per call.",
    annotations: {
      title: "Track job change",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      person_name: z.string()
        .optional()
        .describe("Full name of the person to check."),
      company_domain: z.string()
        .optional()
        .describe("Website domain of the company your records place this person at, for example microsoft.com. Left, landed, and promoted are worked out against this company."),
      company_name: z.string()
        .optional()
        .describe("Name of that company. Used with or instead of the domain to match roles in the person's history."),
      last_known_title: z.string()
        .optional()
        .describe("The title your records hold. Echoed on the row as input_title."),
      profile_url: z.string()
        .optional()
        .describe("Optional. The person's LinkedIn profile URL, used as the identity. This actor never opens it. Without it, the run looks the profile up with your search key and charges profile_resolved when it finds and accepts one."),
      email: z.string()
        .optional()
        .describe("Optional. The person's work address at the last known company. With a BounceBan key, an undeliverable answer marks the person as left."),
      company_linkedin_url: z.string()
        .optional()
        .describe("Optional. The strongest company match when a role history carries LinkedIn company URLs."),
      location: z.string()
        .optional()
        .describe("Optional. Echoed for your records."),
      input_id: z.string()
        .optional()
        .describe("Optional. Returned unchanged on the row so you can join it back to your CRM or table."),
      known_history: z.string()
        .optional()
        .describe("Optional. A role history you already have, as JSON: {\"source\": \"heyreach\", \"source_date\": \"2026-10-07\", \"experiences\": [...]} or {\"source\": \"crm\", \"roles\": [{\"company_name\", \"title\", \"start_month\", \"end_month\"}]}. Read before any paid key; a history newer than Max source age skips Prospeo."),
      people: z.array(z.record(z.string(), z.unknown()))
        .optional()
        .describe("Many people at once. Each item takes the same keys as the single person fields: person_name, company_domain, company_name, last_known_title, profile_url, email, company_linkedin_url, location, input_id, and known_history (an object)."),
      serperApiKey: z.string()
        .optional()
        .describe("Optional. Web search (serper.dev): finds profile URLs and reads the search result line for the current role. About 1 to 3 searches per person. Your own key, sent as a run input; never stored by the actor."),
      serpApiKey: z.string()
        .optional()
        .describe("Optional. Used for web search only when no Serper key is set. Your own key, sent as a run input; never stored by the actor."),
      prospeoApiKey: z.string()
        .optional()
        .describe("Optional. Prospeo enrich-person: the person's role history with start and end months. Skipped when you send a fresh history of your own. Your own key, sent as a run input; never stored by the actor."),
      bouncebanApiKey: z.string()
        .optional()
        .describe("Optional. Verifies the old work address only while the person still reads as at the company. Only an undeliverable answer is used. Your own key, sent as a run input; never stored by the actor."),
      maxSourceAgeDays: z.string()
        .optional()
        .describe("A history you send that is older than this is treated as lagging, so the run also reads Prospeo and the search result. Default 30."),
      checkCompanySite: z.enum(["true", "false"])
        .optional()
        .describe("Free. Looks for the person on up to 4 team and about pages of the last known company domain."),
      checkNews: z.enum(["true", "false"])
        .optional()
        .describe("Free. Cites up to 3 headlines from the last year that name the person with a move word. Evidence only; a headline never sets the employer."),
      verifyOldEmail: z.enum(["true", "false"])
        .optional()
        .describe("With a BounceBan key: one check per person who still reads as at the company. Uses the address you send, or one Prospeo returns on the company domain."),
      includeRoleHistory: z.enum(["true", "false"])
        .optional()
        .describe("No keeps role_count and drops the role_history array."),
      cacheTtlDays: z.string()
        .optional()
        .describe("Reuse a reading made in the last N days, uncharged, from a store in your own Apify account. 0 turns it off. Rows with your own history are never cached. Default 7."),
      maxPeople: z.string()
        .optional()
        .describe("Stop after this many people. Default 1000."),
      max_charge_usd: z.string()
        .optional()
        .describe("Optional. The run stops before any row that would take its event charges past this amount."),
    },
  },
  async (args) => runActor("L8UbEmMJC1XYPSZOb", "Job Change Tracker", compact(args as Record<string, unknown>)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
