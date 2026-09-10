import {
  readFile,
  readdir,
  realpath,
  lstat,
  open,
  writeFile,
  rename,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseDocument } from "yaml";
import { parseNotificationFeed } from "../src/lib/notifications.js";
import type { NotificationFeed } from "../src/lib/notifications.js";

export type NoticeStatus = "draft" | "active" | "withdrawn";
export interface NotificationCatalog {
  feed: NotificationFeed;
  statuses: Record<string, NoticeStatus>;
  source: string;
}
async function paths(root: string) {
  const canonical = await realpath(root);
  const folder = join(canonical, "notifications");
  const messages = join(folder, "messages");
  for (const path of [folder, messages, join(folder, "cohorts.json")]) {
    if ((await lstat(path)).isSymbolicLink() || (await realpath(path)) !== path)
      throw new Error(
        "Notification paths must stay inside the configured repository without symlinks.",
      );
  }
  return { folder, messages, cohorts: join(folder, "cohorts.json") };
}
export async function readCatalog(root: string): Promise<NotificationCatalog> {
  const p = await paths(root);
  const cohorts: unknown = JSON.parse(await readFile(p.cohorts, "utf8"));
  const notifications: unknown[] = [];
  const statuses: Record<string, NoticeStatus> = {};
  for (const file of (await readdir(p.messages))
    .filter((f) => f.endsWith(".md"))
    .sort()) {
    const path = join(p.messages, file);
    if ((await lstat(path)).isSymbolicLink())
      throw new Error(`Symlink not allowed: ${file}`);
    const source = await readFile(path, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(
      source,
    );
    if (!match) throw new Error(`Missing frontmatter: ${file}`);
    const doc = parseDocument(match[1]!, { uniqueKeys: true });
    if (doc.errors.length) throw new Error(`Invalid frontmatter: ${file}`);
    const metadata = doc.toJS({ maxAliasCount: 0 });
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      throw new Error(`Invalid metadata: ${file}`);
    const allowed = [
      "id",
      "title",
      "publishedAt",
      "cohorts",
      "priority",
      "priorityOverride",
      "status",
    ];
    if (Object.keys(metadata).some((key) => !allowed.includes(key)))
      throw new Error(`Unsupported metadata: ${file}`);
    const { status, ...notice } = metadata;
    if (!["draft", "active", "withdrawn"].includes(status))
      throw new Error(`Invalid status: ${file}`);
    notifications.push({
      priority: "Normal",
      ...notice,
      body: match[2]!.trim(),
    });
    statuses[notice.id] = status;
  }
  const feed = parseNotificationFeed({
    schemaVersion: 1,
    cohorts,
    notifications,
  });
  if (!feed)
    throw new Error(
      "Repository notifications failed contract validation. Fix the files before creating another draft.",
    );
  return { feed, statuses, source: await realpath(root) };
}
/** Create only. The filesystem lock protects concurrent workbench writes; no git or publishing commands. */
export async function createDraft(
  root: string,
  input: unknown,
): Promise<{ id: string; path: string }> {
  const draft = parseNotificationFeed(input);
  if (!draft || draft.notifications.length !== 1)
    throw new Error("Provide one valid notification and its cohorts.");
  const notice = draft.notifications[0]!;
  if (draft.cohorts.some((c) => !notice.cohorts.includes(c.id)))
    throw new Error("Include only the referenced cohorts.");
  const p = await paths(root);
  const lockPath = join(p.folder, ".notification-authoring.lock");
  const lock = await open(lockPath, "wx").catch(() => {
    throw new Error("Another draft is being saved. Retry after it finishes.");
  });
  const temp = join(p.folder, `.cohorts-${randomUUID()}.tmp`);
  let createdPath: string | undefined;
  try {
    const before = await readFile(p.cohorts, "utf8");
    const catalog = await readCatalog(root);
    if (catalog.feed.notifications.some((n) => n.id === notice.id))
      throw new Error(
        "This notification ID already exists. Create a new ID to resend.",
      );
    const cohorts = [...catalog.feed.cohorts];
    for (const cohort of draft.cohorts) {
      const existing = cohorts.find((c) => c.id === cohort.id);
      if (
        existing &&
        (existing.name !== cohort.name ||
          existing.description !== cohort.description ||
          JSON.stringify(Object.entries(existing.conditions).sort()) !==
            JSON.stringify(Object.entries(cohort.conditions).sort()))
      )
        throw new Error(
          `Cohort ${cohort.id} already exists with different content.`,
        );
      if (!existing) cohorts.push(cohort);
    }
    if (
      !parseNotificationFeed({
        schemaVersion: 1,
        cohorts,
        notifications: [...catalog.feed.notifications, notice],
      })
    )
      throw new Error(
        "The combined catalog exceeds contract limits or contains invalid references.",
      );
    const { body, ...metadata } = notice;
    // JSON is valid YAML and avoids ambiguous scalar parsing in authored metadata.
    const document = `---\n${JSON.stringify({ ...metadata, status: "draft" }, null, 2)}\n---\n\n${body}\n`;
    await writeFile(temp, `${JSON.stringify(cohorts, null, 2)}\n`, {
      flag: "wx",
    });
    if ((await readFile(p.cohorts, "utf8")) !== before)
      throw new Error("Cohorts changed while saving. Refresh and retry.");
    const target = join(p.messages, `${notice.id}.md`);
    await writeFile(target, document, { flag: "wx" });
    createdPath = target;
    await rename(temp, p.cohorts);
    createdPath = undefined;
    return { id: notice.id, path: target };
  } finally {
    if (createdPath) await unlink(createdPath);
    await unlink(temp).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
