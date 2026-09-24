import { createServer } from "node:http";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";

const servers = new Map();
const REPOSITORY = "Leena1-100/tailspin-toys";
const ISSUE_API_URL = `https://api.github.com/repos/${REPOSITORY}/issues?state=open&per_page=100`;

const priorityRules = [
    {
        test: /concierge|assistant|recommend/i,
        score: 100,
        justification: "This is the broadest user-facing feature and has the largest acceptance surface, so it is likely to benefit from attention before smaller catalog enhancements.",
    },
    {
        test: /filter/i,
        score: 90,
        justification: "Filtering is a core catalog-discovery capability and touches both data helpers and the browsing experience, making it a high-leverage next item.",
    },
    {
        test: /pagination/i,
        score: 80,
        justification: "Pagination addresses catalog scalability and requires coordinated data-layer, page, and end-to-end changes before the catalog grows further.",
    },
];

function priorityFor(issue) {
    const rule = priorityRules.find(({ test }) => test.test(issue.title));
    return rule ?? {
        score: 50,
        justification: "This remains open and is a useful follow-up, but it has a narrower scope than the higher-ranked discovery and scalability work.",
    };
}

function normalizeIssue(issue) {
    const priority = priorityFor(issue);
    return {
        number: issue.number,
        title: issue.title,
        body: issue.body?.trim() || "No description provided.",
        url: issue.html_url,
        updatedAt: issue.updated_at,
        labels: issue.labels.map((label) => label.name),
        score: priority.score,
        justification: priority.justification,
    };
}

async function fetchIssues() {
    const response = await fetch(ISSUE_API_URL, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "tailspin-toys-issue-triage-board",
        },
    });
    if (!response.ok) {
        throw new Error(`GitHub returned ${response.status} while loading issues.`);
    }
    const issues = await response.json();
    return issues
        .filter((issue) => !issue.pull_request)
        .map(normalizeIssue)
        .sort((left, right) => right.score - left.score || right.number - left.number);
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
            body += chunk;
            if (body.length > 20_000) {
                reject(new Error("Request body is too large."));
                request.destroy();
            }
        });
        request.on("end", () => resolve(body));
        request.on("error", reject);
    });
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character]);
}

function renderHtml() {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Issue triage board</title>
    <style>
      :root { color-scheme: light dark; --surface: color-mix(in srgb, var(--background-color-default, #fff) 94%, var(--text-color-default, #1f2328) 6%); --surface-strong: color-mix(in srgb, var(--background-color-default, #fff) 88%, var(--text-color-default, #1f2328) 12%); }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font: var(--text-body-medium, 14px)/var(--leading-body-medium, 20px) var(--font-sans, system-ui, sans-serif); }
      main { max-width: 1100px; margin: 0 auto; padding: clamp(16px, 3vw, 32px); }
      header { align-items: start; border-bottom: 1px solid var(--border-color-default, #d0d7de); display: flex; gap: 16px; justify-content: space-between; margin-bottom: 24px; padding-bottom: 20px; }
      h1 { font-size: clamp(26px, 4vw, 36px); letter-spacing: -.025em; line-height: 1.1; margin: 0; }
      h2 { font-size: 18px; margin: 0; }
      .lede, .meta, .empty { color: var(--text-color-muted, #59636e); }
      .lede { margin: 8px 0 0; max-width: 70ch; }
      button { appearance: none; background: var(--true-color-blue, #0969da); border: 1px solid var(--true-color-blue, #0969da); border-radius: 7px; color: var(--color-white, #fff); cursor: pointer; font: inherit; font-weight: var(--font-weight-semibold, 600); min-height: 36px; padding: 7px 12px; }
      button:hover:not(:disabled) { filter: brightness(.9); }
      button:disabled { cursor: wait; opacity: .65; }
      button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; }
      .section { margin-top: 24px; }
      .section-heading { align-items: baseline; display: flex; gap: 10px; margin-bottom: 12px; }
      .count { color: var(--text-color-muted, #59636e); font-size: 12px; }
      .cards { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      article { background: var(--surface); border: 1px solid var(--border-color-default, #d0d7de); border-radius: 12px; display: flex; flex-direction: column; gap: 12px; padding: 16px; }
      article.priority { border-color: color-mix(in srgb, var(--true-color-orange, #bf8700) 55%, var(--border-color-default, #d0d7de)); }
      .issue-title { color: inherit; font-size: 16px; font-weight: var(--font-weight-semibold, 600); text-decoration: none; }
      .issue-title:hover { text-decoration: underline; }
      .issue-number { color: var(--text-color-muted, #59636e); font-family: var(--font-mono, monospace); font-size: 12px; }
      .body, .why { margin: 0; white-space: pre-wrap; }
      .body { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 6; }
      .why { background: var(--surface-strong); border-left: 3px solid var(--true-color-orange, #bf8700); border-radius: 4px; padding: 9px 10px; }
      .why strong { display: block; margin-bottom: 4px; }
      .labels { display: flex; flex-wrap: wrap; gap: 5px; }
      .label { background: var(--surface-strong); border: 1px solid var(--border-color-default, #d0d7de); border-radius: 999px; font-size: 11px; padding: 2px 7px; }
      .card-footer { align-items: center; display: flex; gap: 10px; justify-content: space-between; margin-top: auto; }
      .status { color: var(--text-color-muted, #59636e); font-size: 12px; min-height: 20px; }
      .error { color: var(--true-color-red, #cf222e); }
      @media (max-width: 600px) { header { flex-direction: column; } header button { align-self: stretch; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div><h1>Issue triage board</h1><p class="lede">A quick view of open work, ranked by likely impact and coordination needs. Use “Add to context” to start working on an issue in this session.</p></div>
        <button id="refresh" data-testid="refresh-issues" type="button">Refresh issues</button>
      </header>
      <p id="status" class="status" role="status" aria-live="polite"></p>
      <section class="section" aria-labelledby="priority-heading">
        <div class="section-heading"><h2 id="priority-heading">Needs attention now</h2><span id="priority-count" class="count"></span></div>
        <div id="priority" class="cards"></div>
      </section>
      <section class="section" aria-labelledby="remaining-heading">
        <div class="section-heading"><h2 id="remaining-heading">Remaining open issues</h2><span id="remaining-count" class="count"></span></div>
        <div id="remaining" class="cards"></div>
      </section>
    </main>
    <script>
      const priority = document.querySelector("#priority");
      const remaining = document.querySelector("#remaining");
      const status = document.querySelector("#status");
      const refresh = document.querySelector("#refresh");
      const escapeHtml = ${escapeHtml.toString()};
      const card = (issue, isPriority) => \`<article class="\${isPriority ? "priority" : ""}">
        <div><span class="issue-number">#\${issue.number}</span> <a class="issue-title" data-testid="issue-link-\${issue.number}" href="\${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">\${escapeHtml(issue.title)}</a></div>
        <p class="body">\${escapeHtml(issue.body)}</p>
        \${isPriority ? \`<p class="why"><strong>Why it is here</strong>\${escapeHtml(issue.justification)}</p>\` : ""}
        <div class="labels">\${issue.labels.map((label) => \`<span class="label">\${escapeHtml(label)}</span>\`).join("")}</div>
        <div class="card-footer"><span class="status" data-status-for="\${issue.number}"></span><button data-testid="add-issue-\${issue.number}" type="button" data-add-issue="\${issue.number}">Add to context</button></div>
      </article>\`;
      const render = (issues) => {
        const top = issues.slice(0, 3);
        priority.innerHTML = top.length ? top.map((issue) => card(issue, true)).join("") : '<p class="empty">No open issues found.</p>';
        remaining.innerHTML = issues.length > 3 ? issues.slice(3).map((issue) => card(issue, false)).join("") : '<p class="empty">There are no additional open issues.</p>';
        document.querySelector("#priority-count").textContent = top.length + " issue" + (top.length === 1 ? "" : "s");
        document.querySelector("#remaining-count").textContent = Math.max(issues.length - 3, 0) + " issue" + (issues.length - 3 === 1 ? "" : "s");
      };
      const request = async (path, options) => {
        const response = await fetch(path, options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Request failed.");
        return data;
      };
      const load = async () => {
        refresh.disabled = true; status.className = "status"; status.textContent = "Loading open issues...";
        try { render(await request("/api/issues")); status.textContent = ""; }
        catch (error) { status.className = "status error"; status.textContent = error.message; }
        finally { refresh.disabled = false; }
      };
      document.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-add-issue]");
        if (!button) return;
        const number = Number(button.dataset.addIssue);
        const message = document.querySelector("[data-status-for='" + number + "']");
        button.disabled = true; message.textContent = "Adding...";
        try { await request("/api/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number }) }); message.textContent = "Added to context"; }
        catch (error) { message.className = "status error"; message.textContent = error.message; button.disabled = false; }
      });
      refresh.addEventListener("click", load);
      load();
    </script>
  </body>
</html>`;
}

async function startServer() {
    const server = createServer(async (request, response) => {
        try {
            if (request.url === "/api/issues" && request.method === "GET") {
                response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                response.end(JSON.stringify(await fetchIssues()));
                return;
            }
            if (request.url === "/api/context" && request.method === "POST") {
                const payload = JSON.parse(await readRequestBody(request));
                const issue = (await fetchIssues()).find((candidate) => candidate.number === Number(payload.number));
                if (!issue) throw new Error("That issue is no longer open.");
                await session.send({ prompt: `Add GitHub issue #${issue.number} to the current context so we can work on it:\n\n${issue.title}\n\n${issue.body}\n\nIssue URL: ${issue.url}` });
                response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                response.end(JSON.stringify({ added: issue.number }));
                return;
            }
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(renderHtml());
        } catch (error) {
            response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : "The request failed." }));
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "Issue triage board",
            description: "Kanban board that ranks open repository issues and adds selected issues to the current context.",
            actions: [
                {
                    name: "list_open_issues",
                    description: "Load and rank the repository's open issues for triage.",
                    handler: async () => fetchIssues(),
                },
                {
                    name: "add_issue_to_context",
                    description: "Add an open issue's title and description to the current session context.",
                    inputSchema: {
                        type: "object",
                        properties: { number: { type: "integer", minimum: 1 } },
                        required: ["number"],
                        additionalProperties: false,
                    },
                    handler: async (ctx) => {
                        const issue = (await fetchIssues()).find((candidate) => candidate.number === ctx.input?.number);
                        if (!issue) throw new CanvasError("issue_not_found", "That issue is no longer open.");
                        await session.send({ prompt: `Add GitHub issue #${issue.number} to the current context so we can work on it:\n\n${issue.title}\n\n${issue.body}\n\nIssue URL: ${issue.url}` });
                        return { added: issue.number };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer();
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Issue triage board", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(resolve));
                }
            },
        }),
    ],
});
