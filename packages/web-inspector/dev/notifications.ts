import { createNotificationEditor } from "./notification-editor.js";
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
const dialog = el<HTMLDialogElement>("editor");
let bodyEditor: ReturnType<typeof createNotificationEditor> | undefined;
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
  if (!form || form === draftForm) bodyEditor?.setMarkdown();
}
function setEditor(value: boolean) {
  openNoticeId = undefined;
  editing = value;
  el("library").hidden = value;
  el("working-draft").hidden = !value;
  if (value && !dialog.open) dialog.showModal();
  if (!value) dialog.close();
  el("selected-notice").hidden = value || !selected;
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
  el("draft-audience-summary").textContent = savedCohorts
    ? savedCohorts.map((c) => c.name).join(" or ")
    : [
        fields().framework || "All frameworks",
        fields().sdkVersion || "All stable versions",
        fields().intelligence ? `Intelligence ${fields().intelligence}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
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
    el("working-title").textContent = fields().title ?? "Untitled draft";
    el<HTMLButtonElement>("preview-draft").disabled = false;
    renderList();
    renderAudience();
  } catch (e) {
    current = undefined;
    el<HTMLButtonElement>("preview-draft").disabled = true;
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
function refresh() {
  openNoticeId = undefined;
  const container = document.querySelector(".frame-scroll")!;
  if (frame.parentElement !== container) container.append(frame);
  frame.style.clipPath = "inset(100%)";
  if (frame.getAttribute("src") !== "about:blank") frame.src = "about:blank";
  validate();
  save();
  if (current) el("preview-status").textContent = "Ready to preview";
}
function preview() {
  validate();
  if (!current) return;
  save();
  if (dialog.open && frame.parentElement !== dialog) dialog.append(frame);
  el("preview-status").textContent = "Loading preview…";
  frame.style.clipPath = "inset(100%)";
  frame.src = `/notification-preview.html?revision=${++revision}`;
}
function renderList() {
  const list = el<HTMLSelectElement>("notice-list");
  list.replaceChildren(
    ...catalog.feed.notifications.map(
      (notice) =>
        new Option(
          `${notice.title} · ${catalog.statuses[notice.id]}`,
          notice.id,
        ),
    ),
  );
  if (!catalog.feed.notifications.length)
    list.add(new Option("No notifications", ""));
  list.disabled = !catalog.feed.notifications.length;
  list.value = selected ?? "";
}
function previewTarget() {
  const feed = editing ? current?.feed : catalog.feed;
  const notice = editing
    ? feed?.notifications[0]
    : feed?.notifications.find((n) => n.id === selected);
  return { feed, notice };
}
function renderAudience() {
  const chooser = el<HTMLSelectElement>("sample-cohort");
  const { feed, notice } = previewTarget();
  const cohorts =
    feed?.cohorts.filter((c) => notice?.cohorts.includes(c.id)) ?? [];
  el("audience-selector").hidden = !notice;
  el("match-details").hidden = !notice;
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
    matchNotification(notice, feed!, current.context).matches;
  el<HTMLButtonElement>("view-selected").disabled = !matches || withdrawn;
  el<HTMLButtonElement>("load-matching-client").disabled = !cohort || withdrawn;
  el("sample-status").textContent = withdrawn
    ? "Withdrawn. Duplicate it to test changes."
    : cohorts.length > 1
      ? "Choose a cohort to sample. Matching any one is enough."
      : "Or edit the values below to test another client.";
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
  el("source-description").textContent = "";
  catalog = { feed: EMPTY, statuses: {}, source: "" };
  selected = undefined;
  showSelected();
  refresh();
  try {
    const value = await request(source.value);
    if (token !== loading) return;
    const feed = parseNotificationFeed(value.feed);
    if (!feed) throw new Error("Invalid catalog.");
    catalog = { ...value, feed };
    if (source.value === "catalog") repositoryReady = true;
    el("catalog-status").textContent =
      source.value === "catalog"
        ? `${feed.notifications.length} in repository · not verified published`
        : `${feed.notifications.length} in published feed`;
    el("source-description").textContent = value.source;
  } catch (e) {
    if (token !== loading) return;
    if (source.value === "catalog") repositoryReady = false;
    el("catalog-status").textContent =
      e instanceof Error ? e.message : "Could not load notifications.";
  }
  selected = catalog.feed.notifications[0]?.id;
  showSelected();
  refresh();
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
bodyEditor = createNotificationEditor(el<HTMLTextAreaElement>("markdown-body"));
audience();

el("new-notice").addEventListener("click", () => {
  setEditor(true);
  audience();
  refresh();
});
el("back-library").addEventListener("click", closeDraft);
el("change-audience").addEventListener("click", () => {
  savedCohorts = undefined;
  audience();
  refresh();
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
  refresh();
});
preset.addEventListener("change", () => {
  if (preset.value) {
    savedCohorts = undefined;
    fill(presetFields(preset.value), draftForm);
    audience();
    refresh();
  }
});
draftForm.addEventListener("input", () => {
  preset.value = "";
  refresh();
});
clientForm.addEventListener("input", refresh);
for (const form of [draftForm, clientForm])
  form.addEventListener("submit", (event) => event.preventDefault());
view.addEventListener("change", () => {
  openNoticeId = undefined;
  refresh();
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
    prompt.hidden = false;
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
    refresh();
    el("catalog-status").textContent = `Draft created · not published`;
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
        returnToDraft: dialog.open,
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
  if (event.data?.kind === "notification-preview-closed" && dialog.open) {
    refresh();
    el("preview-draft").focus();
  }
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
  refresh();
});

function openSelected() {
  openNoticeId = previewTarget().notice?.id;
  view.value = "updates";
  preview();
}
el("sample-cohort").addEventListener("change", renderAudience);
el("view-selected").addEventListener("click", openSelected);
el("load-matching-client").addEventListener("click", () => {
  const cohort = previewTarget().feed?.cohorts.find(
    (c) => c.id === el<HTMLSelectElement>("sample-cohort").value,
  );
  if (!cohort) return;
  try {
    fill(matchingClient(cohort), clientForm);
    openNoticeId = undefined;
    refresh();
    el("sample-status").textContent = `Sample loaded for ${cohort.name}.`;
  } catch (error) {
    el("sample-status").textContent =
      error instanceof Error
        ? error.message
        : "Could not load a matching client.";
  }
});

el("notice-list").addEventListener("change", () => {
  openNoticeId = undefined;
  selected = el<HTMLSelectElement>("notice-list").value;
  showSelected();
  refresh();
});

function leaveDraft() {
  setEditor(false);
  showSelected();
  refresh();
}
function closeDraft() {
  dialog.close();
  refresh();
  el("resume-draft").focus();
}
// Handle Escape before the rich-text editor consumes it.
dialog.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeDraft();
    }
  },
  true,
);
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDraft();
});
el("browse-notices").addEventListener("click", leaveDraft);
el("resume-draft").addEventListener("click", () => {
  refresh();
  dialog.showModal();
});
el("preview-draft").addEventListener("click", () => {
  validate();
  if (!current) return;
  const cohort = current.feed.cohorts[0];
  if (!cohort) return;
  try {
    fill(matchingClient(cohort), clientForm);
    openSelected();
  } catch (error) {
    el("draft-error").hidden = false;
    el("draft-error").textContent =
      error instanceof Error ? error.message : "Cannot sample this audience.";
  }
});
