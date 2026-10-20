# Job Change Tracker MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-job-change-tracker)](https://smithery.ai/servers/mambabuilt/mcp-job-change-tracker) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-job-change-tracker/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-job-change-tracker) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-job-change-tracker%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-job-change-tracker&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-job-change-tracker)](https://www.npmjs.com/package/@mambalabsdev/mcp-job-change-tracker) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-job-change-tracker)](https://www.npmjs.com/package/@mambalabsdev/mcp-job-change-tracker) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-job-change-tracker)](https://github.com/mambalabsdev/mcp-job-change-tracker/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-job-change-tracker)

<a href="https://mcprush.com/to/job-change-tracker-mcp?ref=badge"><img width="380" height="200" src="https://mcprush.com/badge/job-change-tracker-mcp/card.svg" alt="Job Change Tracker MCP server" /></a>

An MCP server for the Mamba Labs Job Change Tracker actor on Apify. Send the contacts in your CRM. Get one row back per person: where they work now, their title, when they started, their role history, and whether they left the company you know them at, landed somewhere new, or moved up inside the same company. Every row says how the person was matched, which source the answer came from, and how old that source is.

## What's Inside

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Example prompts](#example-prompts)
- [Tool](#tool)
- [Inputs](#inputs)
- [Pricing](#pricing)
- [Your keys](#your-keys)
- [Full actor documentation](#full-actor-documentation)
- [License](#license)

## What it does

Check whether one contact, or a list of contacts, still works at the company your records hold. Returns one flat, Clay-ready JSON row per person: current employer, title, start month, role history, status (left, landed, promoted, or still there), how the person was matched, the source of the answer, and that source's date, with a namesake check. Runs on data you send (known_history) and on your own Serper or SerpApi, Prospeo, and BounceBan keys passed as inputs; this tool never fetches LinkedIn and holds no key of its own. Provide person_name with company_domain or company_name, or a people list. A run that does not succeed is returned as an error with its run ID. Read-only; requires an APIFY_TOKEN and consumes Apify credits per call.

All of the work runs on Apify. This package is a thin client that starts the actor run, waits for it, and hands back the dataset rows.

## Quick start

You need Node.js 18 or newer and an Apify account with an API token.

Add this to your Claude Desktop config (`claude_desktop_config.json`), Cursor, or any MCP client:

```json
{
  "mcpServers": {
    "mamba-job-change-tracker": {
      "command": "npx",
      "args": [
        "-y",
        "@mambalabsdev/mcp-job-change-tracker"
      ],
      "env": {
        "APIFY_TOKEN": "your-apify-token"
      }
    }
  }
}
```

Restart the client. The `track_job_change` tool appears.

## Prerequisites

- Node.js 18 or newer.
- An Apify API token from [console.apify.com/account/integrations](https://console.apify.com/account/integrations), set as `APIFY_TOKEN`. The server lists its tool without a token; a call needs one.

## Example prompts

- "Check whether Jane Doe still works at example.com and where she went if she left."
- "Run these 20 contacts and tell me who changed jobs in the last 6 months."

## Tool

`track_job_change`. One tool. Example arguments:

```json
{
  "person_name": "Jane Doe",
  "company_domain": "example.com",
  "company_name": "Example Inc"
}
```

## Inputs

Every buyer facing input of the live actor, unchanged. Omitted inputs take the actor's own defaults.

| Input | Type | Required | Description |
|---|---|---|---|
| `person_name` | string | no | Full name of the person to check. |
| `company_domain` | string | no | Website domain of the company your records place this person at, for example microsoft.com. Left, landed, and promoted are worked out against this company. |
| `company_name` | string | no | Name of that company. Used with or instead of the domain to match roles in the person's history. |
| `last_known_title` | string | no | The title your records hold. Echoed on the row as input_title. |
| `profile_url` | string | no | Optional. The person's LinkedIn profile URL, used as the identity. This actor never opens it. Without it, the run looks the profile up with your search key and charges profile_resolved when it finds and accepts one. |
| `email` | string | no | Optional. The person's work address at the last known company. With a BounceBan key, an undeliverable answer marks the person as left. |
| `company_linkedin_url` | string | no | Optional. The strongest company match when a role history carries LinkedIn company URLs. |
| `location` | string | no | Optional. Echoed for your records. |
| `input_id` | string | no | Optional. Returned unchanged on the row so you can join it back to your CRM or table. |
| `known_history` | string | no | Optional. A role history you already have, as JSON: {"source": "heyreach", "source_date": "2026-10-07", "experiences": [...]} or {"source": "crm", "roles": [{"company_name", "title", "start_month", "end_month"}]}. Read before any paid key; a history newer than Max source age skips Prospeo. |
| `people` | array | no | Many people at once. Each item takes the same keys as the single person fields: person_name, company_domain, company_name, last_known_title, profile_url, email, company_linkedin_url, location, input_id, and known_history (an object). |
| `serperApiKey` | string | no | Optional. Web search (serper.dev): finds profile URLs and reads the search result line for the current role. About 1 to 3 searches per person. Your own key, sent as a run input; never stored by the actor. |
| `serpApiKey` | string | no | Optional. Used for web search only when no Serper key is set. Your own key, sent as a run input; never stored by the actor. |
| `prospeoApiKey` | string | no | Optional. Prospeo enrich-person: the person's role history with start and end months. Skipped when you send a fresh history of your own. Your own key, sent as a run input; never stored by the actor. |
| `bouncebanApiKey` | string | no | Optional. Verifies the old work address only while the person still reads as at the company. Only an undeliverable answer is used. Your own key, sent as a run input; never stored by the actor. |
| `maxSourceAgeDays` | string | no | A history you send that is older than this is treated as lagging, so the run also reads Prospeo and the search result. Default 30. |
| `checkCompanySite` | string | no | Free. Looks for the person on up to 4 team and about pages of the last known company domain. |
| `checkNews` | string | no | Free. Cites up to 3 headlines from the last year that name the person with a move word. Evidence only; a headline never sets the employer. |
| `verifyOldEmail` | string | no | With a BounceBan key: one check per person who still reads as at the company. Uses the address you send, or one Prospeo returns on the company domain. |
| `includeRoleHistory` | string | no | No keeps role_count and drops the role_history array. |
| `cacheTtlDays` | string | no | Reuse a reading made in the last N days, uncharged, from a store in your own Apify account. 0 turns it off. Rows with your own history are never cached. Default 7. |
| `maxPeople` | string | no | Stop after this many people. Default 1000. |
| `max_charge_usd` | string | no | Optional. The run stops before any row that would take its event charges past this amount. |

## Pricing

Pay per event on Apify, billed to your Apify account. Prices in USD.

| Event | Free plan | Bronze | Silver | Gold |
|---|---|---|---|---|
| `person_read`, per person read | $0.025 | $0.02375 | $0.0225 | $0.02125 |
| `profile_resolved`, per profile resolved by web search | $0.006 | $0.0057 | $0.0054 | $0.0051 |
| `apify-actor-start`, per run start | $0.001 | $0.001 | $0.001 | $0.001 |

## Your keys

The actor holds no provider key of its own. Every paid provider key is yours, passed as an input and stored by Apify as a secret input. Without a key, the actor skips that step and says so in the run.

## Full actor documentation

[apify.com/mambalabs/job-change-tracker](https://apify.com/mambalabs/job-change-tracker)

## License

MIT. See [LICENSE](LICENSE).
