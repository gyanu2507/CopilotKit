import { matchingClient, audienceRows } from "./notification-samples.js";
import {
  compilePreview,
  DEFAULT_FIELDS,
  PRESETS,
  presetFields,
} from "./notification-authoring.js";
import type { AuthoringFields } from "./notification-authoring.js";
import {
  emptyNotificationState,
  matchNotification,
  parseNotificationFeed,
  reconcileNotifications,
} from "../src/lib/notifications.js";
import type {
  NotificationCohort,
  NotificationFeed,
} from "../src/lib/notifications.js";
import type { NotificationCatalog } from "./notification-repository.js";
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const draftForm = el<HTMLFormElement>("draft-form");
const clientForm = el<HTMLFormElement>("client-form");
const frame = el<HTMLIFrameElement>("preview-frame");
const view = el<HTMLSelectElement>("preview-view");
const preset = el<HTMLSelectElement>("preset");
const prompt = el<HTMLTextAreaElement>("prompt");
const copy = el<HTMLButtonElement>("copy-prompt");
const create = el<HTMLButtonElement>("create-draft");
const source = el<HTMLSelectElement>("catalog-source");
const STORAGE_KEY = "cpk:workbench:notification-draft:v1";
const EMPTY: NotificationFeed = {
  schemaVersion: 1,
  cohorts: [],
  notifications: [],
};
let catalog: NotificationCatalog = { feed: EMPTY, statuses: {}, source: "" };
let selected: string | undefined;
let savedCohorts: NotificationCohort[] | undefined;
let editing = false;
let current: ReturnType<typeof compilePreview> | undefined;
let previewFeed: NotificationFeed = EMPTY;
let revision = 0;
let loading = 0;
let creating = false;
let repositoryReady = false;
let openNoticeId: string | undefined;
let draftTimestamp = new Date().toISOString();
let draftId = `notice-${crypto.randomUUID()}`;
function fields(): AuthoringFields {
  return {
    publishedAt: draftTimestamp,
    id: draftId,
    ...Object.fromEntries(
      [...new FormData(draftForm), ...new FormData(clientForm)].map(
        ([key, value]) => [key, String(value)],
      ),
    ),
  };
}
function fill(values: AuthoringFields, form?: HTMLFormElement) {
  for (const target of form ? [form] : [draftForm, clientForm])
    for (const input of target.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("[name]"))
      input.value = values[input.name] ?? "";
}
function tab(client: boolean) {
  el("client-panel").hidden = !client;
  el("notifications-panel").hidden = client;
  el("client-tab").setAttribute("aria-pressed", String(client));
  el("notifications-tab").setAttribute("aria-pressed", String(!client));
}
function setEditor(value: boolean) {
  openNoticeId = undefined;
  editing = value;
  el("library").hidden = value;
  el("editor").hidden = !value;
  el("selected-notice").hidden = value || !selected;
  tab(false);
}
function audience() {
  el("audience-fields").hidden = !!savedCohorts;
  el("saved-audience").hidden = !savedCohorts;
  el("saved-conditions").textContent = savedCohorts
    ? JSON.stringify(
        savedCohorts.map((c) => ({ name: c.name, conditions: c.conditions })),
        null,
        2,
      )
    : "";
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fields()));
    localStorage.setItem(
      `${STORAGE_KEY}:cohorts`,
      JSON.stringify(savedCohorts ?? null),
    );
  } catch {
    el("save-status").textContent =
      "Browser storage unavailable. Copy the prompt to keep this draft.";
  }
}
function validate() {
  try {
    current = compilePreview(
      editing
        ? fields()
        : ({
            ...DEFAULT_FIELDS,
            ...Object.fromEntries(new FormData(clientForm).entries()),
          } as AuthoringFields),
      editing ? savedCohorts : undefined,
    );
    const chosen = catalog.feed.notifications.find((n) => n.id === selected);
    const supplement = editing
      ? current.feed
      : chosen && catalog.statuses[chosen.id] !== "withdrawn"
        ? {
            schemaVersion: 1 as const,
            cohorts: catalog.feed.cohorts.filter((c) =>
              chosen.cohorts.includes(c.id),
            ),
            notifications: [chosen],
          }
        : EMPTY;
    const notices = catalog.feed.notifications.filter(
      (n) =>
        catalog.statuses[n.id] === "active" &&
        !supplement.notifications.some((s) => s.id === n.id),
    );
    const cohortMap = new Map(catalog.feed.cohorts.map((c) => [c.id, c]));
    for (const cohort of supplement.cohorts) cohortMap.set(cohort.id, cohort);
    previewFeed =
      parseNotificationFeed({
        schemaVersion: 1,
        cohorts: [...cohortMap.values()],
        notifications: [...notices, ...supplement.notifications],
      }) ??
      (() => {
        throw new Error("Preview exceeds feed limits or has conflicting IDs.");
      })();
    const matching = previewFeed.notifications.filter(
      (n) => matchNotification(n, previewFeed, current!.context).matches,
    );
    const state = reconcileNotifications(
      emptyNotificationState(),
      previewFeed,
      current.context,
    );
    const winner = previewFeed.notifications.find(
      (n) => n.id === state.activeId,
    );
    const result = el("match-result");
    result.replaceChildren();
    result.dataset.matches = String(matching.length > 0);
    const heading = document.createElement("strong");
    heading.textContent = winner
      ? `Bubble: ${winner.title}`
      : "No notification for this client";
    result.append(
      heading,
      `${matching.length} matching update${matching.length === 1 ? "" : "s"} in What's New.`,
    );
    const target = supplement.notifications[0];
    if (target) {
      const match = matchNotification(target, previewFeed, current.context);
      if (!match.matches) {
        const reasons = document.createElement("ul");
        for (const reason of match.reasons) {
          const li = document.createElement("li");
          li.textContent = reason.replace("preview-cohort: ", "");
          reasons.append(li);
        }
        result.append(reasons);
      }
    }
    el("client-summary").textContent =
      `${current.context.framework} ${current.context.sdkVersion} · Intelligence ${current.context.intelligence ?? "unknown"}${current.context.plan ? ` · ${current.context.plan}` : ""}`;
    el("draft-error").hidden = true;
    copy.disabled = false;
    create.disabled = creating || !repositoryReady;
    prompt.value = current.prompt;
    renderList();
    renderAudience();
  } catch (e) {
    current = undefined;
    renderAudience();
    el("draft-error").hidden = false;
    el("draft-error").textContent =
      e instanceof Error ? e.message : "Invalid draft";
    copy.disabled = true;
    create.disabled = true;
    prompt.value = "";
    el("match-result").textContent = el("draft-error").textContent;
    el("match-result").dataset.matches = "false";
    frame.style.clipPath = "inset(100%)";
    frame.src = "about:blank";
    el("preview-status").textContent = "Fix the inputs to preview";
  }
}
function preview() {
  validate();
  if (!current) return;
  save();
  el("preview-status").textContent = "Loading preview…";
  frame.style.clipPath = "inset(100%)";
  frame.src = `/notification-preview.html?revision=${++revision}`;
}
function renderList() {
  const list = el("notice-list");
  list.replaceChildren();
  for (const n of catalog.feed.notifications) {
    const button = document.createElement("button");
    button.className = "notice-item";
    button.setAttribute("aria-pressed", String(n.id === selected));
    const title = document.createElement("strong");
    title.textContent = n.title;
    const meta = document.createElement("span");
    const matches =
      current && matchNotification(n, catalog.feed, current.context).matches;
    meta.textContent = `${source.value === "published" ? "Published" : catalog.statuses[n.id]} · ${matches ? "Matches client" : "Does not match client"}`;
    button.append(title, meta);
    button.addEventListener("click", () => {
      openNoticeId = undefined;
      selected = n.id;
      showSelected();
      preview();
    });
    list.append(button);
  }
}
function renderAudience() {
  const chooser = el<HTMLSelectElement>("sample-cohort");
  const notice = catalog.feed.notifications.find((n) => n.id === selected);
  const cohorts = catalog.feed.cohorts.filter((c) =>
    notice?.cohorts.includes(c.id),
  );
  const previous = chooser.value;
  chooser.replaceChildren(...cohorts.map((c) => new Option(c.name, c.id)));
  if (cohorts.some((c) => c.id === previous)) chooser.value = previous;
  const cohort = cohorts.find((c) => c.id === chooser.value);
  const table = el("audience-check").querySelector("tbody")!;
  table.replaceChildren();
  if (cohort && current)
    for (const row of audienceRows(cohort, current.context)) {
      const tr = document.createElement("tr");
      const rule = document.createElement("td");
      const label = document.createElement("strong");
      label.textContent = row.label;
      const expected = document.createElement("small");
      expected.textContent = row.expected;
      rule.append(label, expected);
      const actual = document.createElement("td");
      actual.textContent = row.actual;
      const status = document.createElement("td");
      status.dataset.match = String(row.matches);
      status.textContent = row.matches ? "Match" : "No match";
      tr.append(rule, actual, status);
      table.append(tr);
    }
  const withdrawn = !!notice && catalog.statuses[notice.id] === "withdrawn";
  const matches =
    !!notice &&
    !!current &&
    matchNotification(notice, catalog.feed, current.context).matches;
  el<HTMLButtonElement>("view-selected").disabled = !matches || withdrawn;
  el<HTMLButtonElement>("load-matching-client").disabled = !cohort || withdrawn;
  if (withdrawn)
    el("sample-status").textContent =
      "Withdrawn notices are excluded. Use as new draft to preview changes.";
}
function showSelected() {
  el("sample-status").textContent = "";
  renderAudience();
  const notice = catalog.feed.notifications.find((n) => n.id === selected);
  el("selected-notice").hidden = !notice || editing;
  if (!notice) return;
  el("selected-title").textContent = notice.title;
  el("selected-status").textContent =
    `${catalog.statuses[notice.id]}${catalog.statuses[notice.id] === "withdrawn" ? " · excluded from delivery" : ""} · ${notice.id}`;
  el("selected-body").textContent = notice.body;
  el("selected-conditions").textContent = JSON.stringify(
    catalog.feed.cohorts.filter((c) => notice.cohorts.includes(c.id)),
    null,
    2,
  );
}
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`/__notifications/${path}`, init);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  return value;
}
async function loadCatalog() {
  const token = ++loading;
  el("catalog-status").textContent = "Loading…";
  catalog = { feed: EMPTY, statuses: {}, source: "" };
  selected = undefined;
  showSelected();
  preview();
  try {
    const value = await request(source.value);
    if (token !== loading) return;
    const feed = parseNotificationFeed(value.feed);
    if (!feed) throw new Error("Invalid catalog.");
    catalog = { ...value, feed };
    if (source.value === "catalog") repositoryReady = true;
    el("catalog-status").textContent =
      source.value === "catalog"
        ? `${feed.notifications.length} in this worktree. Active means configured, not verified published. ${value.source}`
        : `${feed.notifications.length} published. Loaded from ${value.source}`;
  } catch (e) {
    if (token !== loading) return;
    if (source.value === "catalog") repositoryReady = false;
    el("catalog-status").textContent =
      e instanceof Error ? e.message : "Could not load notifications.";
  }
  selected = catalog.feed.notifications[0]?.id;
  showSelected();
  preview();
}
for (const [key, value] of Object.entries(PRESETS))
  preset.add(new Option(value.label, key));
let restored = { ...DEFAULT_FIELDS };
try {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.values(raw).every((v) => typeof v === "string")
  )
    restored = { ...restored, ...raw };
  const cohorts = JSON.parse(
    localStorage.getItem(`${STORAGE_KEY}:cohorts`) ?? "null",
  );
  if (Array.isArray(cohorts) && cohorts.length) {
    compilePreview(restored, cohorts);
    savedCohorts = cohorts;
  }
} catch {
  el("save-status").textContent = "Previous draft could not be restored.";
}
draftTimestamp = restored.publishedAt || draftTimestamp;
draftId = restored.id || draftId;
fill(restored);
audience();
el("client-tab").addEventListener("click", () => tab(true));
el("edit-client").addEventListener("click", () => tab(true));
el("notifications-tab").addEventListener("click", () => tab(false));
el("new-notice").addEventListener("click", () => {
  setEditor(true);
  audience();
  preview();
});
el("back-library").addEventListener("click", () => {
  setEditor(false);
  showSelected();
  preview();
});
el("change-audience").addEventListener("click", () => {
  savedCohorts = undefined;
  audience();
  preview();
});
el("duplicate-notice").addEventListener("click", () => {
  const n = catalog.feed.notifications.find(
    (candidate) => candidate.id === selected,
  );
  if (!n) return;
  draftTimestamp = new Date().toISOString();
  draftId = `notice-${crypto.randomUUID()}`;
  savedCohorts = catalog.feed.cohorts.filter((c) => n.cohorts.includes(c.id));
  fill(
    {
      ...DEFAULT_FIELDS,
      title: n.title,
      body: n.body,
      priority: n.priority,
      priorityOverride: n.priorityOverride?.toString() ?? "",
    },
    draftForm,
  );
  setEditor(true);
  audience();
  preview();
});
preset.addEventListener("change", () => {
  if (preset.value) {
    savedCohorts = undefined;
    fill(presetFields(preset.value), draftForm);
    audience();
    preview();
  }
});
let timer: ReturnType<typeof setTimeout>;
draftForm.addEventListener("input", () => {
  preset.value = "";
  validate();
  save();
  if (current) {
    el("preview-status").textContent = "Updating preview…";
    clearTimeout(timer);
    timer = setTimeout(preview, 400);
  }
});
clientForm.addEventListener("input", () => {
  clearTimeout(timer);
  preview();
});
for (const form of [draftForm, clientForm])
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(timer);
    preview();
  });
view.addEventListener("change", () => {
  openNoticeId = undefined;
  preview();
});
el("replay").addEventListener("click", preview);
source.addEventListener("change", loadCatalog);
el("refresh-catalog").addEventListener("click", loadCatalog);
copy.addEventListener("click", async () => {
  validate();
  if (!current) return;
  try {
    await navigator.clipboard.writeText(current.prompt);
    el("save-status").textContent =
      "Prompt copied. Paste it into your Intelligence agent.";
  } catch {
    prompt.closest("details")!.open = true;
    prompt.closest(".handoff")!.setAttribute("open", "");
    prompt.select();
    el("save-status").textContent = "Copy the selected prompt.";
  }
});
create.addEventListener("click", async () => {
  validate();
  if (!current || creating || !repositoryReady) return;
  const id = current.feed.notifications[0]!.id;
  const cohortIds = new Map(
    current.feed.cohorts.map((c) => [
      c.id,
      c.id === "preview-cohort" ? `${id}-audience` : c.id,
    ]),
  );
  const feed: NotificationFeed = {
    schemaVersion: 1,
    cohorts: current.feed.cohorts.map((c) => ({
      ...c,
      id: cohortIds.get(c.id)!,
    })),
    notifications: current.feed.notifications.map((n) => ({
      ...n,
      id,
      publishedAt: n.publishedAt,
      cohorts: n.cohorts.map((c) => cohortIds.get(c)!),
    })),
  };
  creating = true;
  create.disabled = true;
  create.textContent = "Saving…";
  try {
    const saved = await request("drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feed),
    });
    el("save-status").textContent = `Draft created: ${saved.path}`;
    draftId = `notice-${crypto.randomUUID()}`;
    draftTimestamp = new Date().toISOString();
    source.value = "catalog";
    setEditor(false);
    await loadCatalog();
    selected = saved.id;
    showSelected();
    preview();
    el("catalog-status").textContent =
      `Draft created in this worktree. Not published. ${saved.path}`;
  } catch (e) {
    el("save-status").textContent =
      e instanceof Error ? e.message : "Could not create draft.";
  } finally {
    creating = false;
    create.textContent = "Create draft";
    validate();
  }
});
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow)
    return;
  if (event.data?.kind === "notification-preview-ready" && current)
    frame.contentWindow?.postMessage(
      {
        kind: "notification-preview",
        feed: previewFeed,
        context: current.context,
        view: view.value,
        notificationId: openNoticeId,
      },
      location.origin,
    );
  if (
    event.data?.kind === "notification-preview-bounds" &&
    typeof event.data.path === "string"
  )
    frame.style.clipPath = event.data.dragging
      ? "inset(0)"
      : event.data.path
        ? `path("${event.data.path}")`
        : "inset(100%)";
  if (event.data?.kind === "notification-preview-mounted")
    el("preview-status").textContent = "Live Inspector · fresh client";
});
void loadCatalog();

el("copy-saved").addEventListener("click", async () => {
  const notice = catalog.feed.notifications.find((n) => n.id === selected);
  if (!notice) return;
  const text = [
    "Use the author-notification skill in Intelligence to prepare a reviewable PR.",
    `Source: ${catalog.source}. Notification ID: ${notice.id}. Status: ${catalog.statuses[notice.id]}.`,
    "Find the existing notification by ID and reuse its file; do not create a duplicate or activate it. Preserve its title, Markdown, priority and ANY-cohort targeting exactly:",
    JSON.stringify(
      {
        notification: notice,
        cohorts: catalog.feed.cohorts.filter((c) =>
          notice.cohorts.includes(c.id),
        ),
      },
      null,
      2,
    ),
    "Run validation and include matching/nonmatching examples with package names in the PR. Do not merge, publish, release or perform AWS actions.",
  ].join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    el("saved-prompt-status").textContent =
      "Copied. Paste into your Intelligence agent.";
  } catch {
    const output = el<HTMLTextAreaElement>("saved-prompt");
    output.hidden = false;
    output.value = text;
    output.select();
    el("saved-prompt-status").textContent = "Copy the selected prompt.";
  }
});

el("reset-client").addEventListener("click", () => {
  fill(DEFAULT_FIELDS, clientForm);
  preview();
});
el("copy-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    el("preview-status").textContent =
      "Link copied · draft and client settings stay in this browser";
  } catch {
    el("preview-status").textContent =
      "Copy the page address to share this workbench.";
  }
});

function openSelected() {
  openNoticeId = selected;
  view.value = "updates";
  preview();
}
el("sample-cohort").addEventListener("change", renderAudience);
el("view-selected").addEventListener("click", openSelected);
el("load-matching-client").addEventListener("click", () => {
  const cohort = catalog.feed.cohorts.find(
    (c) => c.id === el<HTMLSelectElement>("sample-cohort").value,
  );
  if (!cohort) return;
  try {
    fill(matchingClient(cohort), clientForm);
    el("sample-status").textContent =
      `Loaded a sample client for ${cohort.name}. Change values in Test client to check exclusions.`;
    openSelected();
  } catch (error) {
    el("sample-status").textContent =
      error instanceof Error
        ? error.message
        : "Could not load a matching client.";
  }
});
