# Local notification workbench

Start the standalone Nx workbench with an Intelligence **worktree** configured:

```sh
CPK_NOTIFICATION_REPO=/absolute/path/to/Intelligence-worktree \
  pnpm nx run @copilotkit/web-inspector:dev:standalone
```

Open [Notifications](http://127.0.0.1:5177/notifications.html). The authoring modal and test sidebar
are development tools, outside the published Inspector.

## Browse and create

- **Repository** reads `notifications/cohorts.json` and `notifications/messages/*.md`
  from that worktree. Statuses are draft, active, or withdrawn; active in Git does
  not prove deployment. **Published feed** reads the public CDN on demand and
  reports unavailable or invalid content explicitly. It does not provision AWS,
  publish, or fall back to legacy announcements.
- Select a notice to inspect its audience and preview it. **Use as new draft**
  preserves every selected cohort, including OR audiences. **Change audience**
  explicitly replaces those cohorts with one editable AND cohort.
- **New draft** opens a focused modal with a [Tiptap editor](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage) and an expandable audience row. Use the toolbar for formatting, or switch to **Markdown source**. Markdown remains the file and feed format. Templates fill notification fields without changing the test client. Blank audience fields mean unrestricted.
- **Create draft** writes a new Markdown file and adds any new cohort to the
  configured worktree. Existing notices and cohorts are never overwritten. The
  notice always has `status: draft`. Publication date and ID are retained from the
  preview, so saving does not change a priority tie. Duplicate a saved notice to
  create a new ID; editing a working draft does not resend it.
- **Copy agent prompt** supplies exact content and
  cohorts to `author-notification` in Intelligence. After saving, use **Copy PR prompt** on the selected notice to hand over its existing ID and cohorts. The agent reuses those files and prepares the validation report and PR. Review the Git
  diff before merging. Creation itself does not invoke an agent or create a PR.

## Load a notice without guessing

The sidebar follows three steps, all visible together:

1. **Notification**: choose a saved notice. Expand **Source** to switch between
   the repository and published feed. **Content & PR handoff** contains the
   Markdown, cohort definitions, duplication, and prompt export.
2. **Test client**: choose an **Audience to test**, then **Use matching client**
   to fill a sample, or edit the client values yourself. Sampling updates the
   delivery report; it does not open the Inspector.
3. **Delivery**: see the bubble winner and matching count. Expand **Why this
   result?** for the rule-by-rule comparison. **Open notification** opens the
   selected notice (or working draft) with your current client settings, and is
   disabled if it doesn't match. Withdrawn notices remain excluded.

**Preview draft** fills a matching sample client from the first cohort and
opens the exact draft in the Inspector over the modal. Closing the Inspector
returns directly to the editor, preserving the content and selection. **Edit draft**
reopens the modal after you close it. Closing the modal or pressing Escape also keeps the working
draft; **Back to notifications** returns to the saved catalog.

Typing, templates, source changes, and client edits only update validation and
the delivery report. They clear the old preview so it cannot show stale targeting.
The Inspector opens only through **Preview draft**, **Open notification**, or
**Replay**. The view selector chooses what Replay will show; changing it does not
open anything. Each explicit preview starts with fresh acknowledgement state.

Version samples satisfy npm semver but are simulated, not verified published npm
releases. Ranges with no stable example report an error. For multiple cohorts,
choose which OR branch to simulate; the notification itself keeps every cohort.
The bubble winner still reflects all active source notices and priority.

## Test a client

The **Test client** sidebar controls SDK version, framework, Intelligence, plan,
optional runtime version, deployment, and license. Blank client metadata is
unknown and cannot satisfy a required condition. Prerelease SDKs never match.

The real SDK matcher chooses the bubble from all active source notices plus the
selected draft (or the unsaved draft while editing). Withdrawn notices are excluded.
The result shows the winner and matching count; **What's New** shows matching
content rendered in the existing Inspector. Preview priority labels appear only
in authoring controls, never in the Inspector itself.

Each preview is a **fresh client**, with isolated in-memory read/dismissal storage.
Client edits clear the preview; Replay starts it again. This screen tests delivery audiences and initial
selection, not persistence across sessions. Use the Scenarios workbench and the
notification state tests to verify runtime propagation, delayed metadata,
acknowledgement, suppressed backlog, reload persistence, and eligibility changes.

## Failures and recovery

Creation requires a valid configured repository, same-origin JSON, and a fully
valid catalog. Invalid draft or client fields disable creation/export. Missing
browser storage does not block authoring; copy the prompt before closing.

Writes use a create-only lock, exclusive message creation, and an atomic cohort
file replacement. Ordinary write failures remove the new message. If the process
is forcibly killed during saving, inspect the Git diff for a partial new message
or temporary `.cohorts-*.tmp` file before retrying. Remove a stale
`notifications/.notification-authoring.lock` only after confirming no authoring
process is writing. Never commit these recovery files.

No AWS APIs, publishing workflow, Git mutation, or agent execution runs from this
UI. Merging and publishing remain the existing reviewed Git workflow.

## Checks

```sh
pnpm nx run-many -t test check-types -p @copilotkit/web-inspector
pnpm nx run @copilotkit/web-inspector:test:browser -- --grep 'drafts a cohort|preview dismissal|creates a repository|reports unavailable|unfinished draft'
```

Browser tests create drafts in temporary repositories; the HTTP tests cover
origin/host checks, size limits and split Unicode. Repository tests cover invalid
metadata, paths, collisions, cohort reuse, and multi-cohort preservation.
