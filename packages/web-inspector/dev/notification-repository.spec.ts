// @vitest-environment node
import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDraft, readCatalog } from "./notification-repository.js";
import { compilePreview, DEFAULT_FIELDS } from "./notification-authoring.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function repo() {
  const root = await mkdtemp(join(tmpdir(), "notification-authoring-test-"));
  roots.push(root);
  await mkdir(join(root, "notifications/messages"), { recursive: true });
  await writeFile(join(root, "notifications/cohorts.json"), "[]\n");
  return root;
}
function draft(id = "test-notice") {
  const feed = compilePreview(DEFAULT_FIELDS).feed;
  feed.notifications[0]!.id = id;
  return feed;
}
test("creates a draft, preserves Markdown and reuses an identical cohort", async () => {
  const root = await repo();
  const feed = draft();
  feed.notifications[0]!.body =
    "## Title\n\n---\nstatus: active\n---\n\n`npm update`";
  await createDraft(root, feed);
  const first = await readCatalog(root);
  expect(first.statuses).toEqual({ "test-notice": "draft" });
  expect(first.feed.notifications[0]!.body).toBe(feed.notifications[0]!.body);
  await createDraft(root, draft("second-notice"));
  expect((await readCatalog(root)).feed.cohorts).toHaveLength(1);
});
test("rejects reused IDs, conflicting cohorts and traversal without changing files", async () => {
  const root = await repo();
  await createDraft(root, draft());
  const before = await readFile(
    join(root, "notifications/cohorts.json"),
    "utf8",
  );
  await expect(createDraft(root, draft())).rejects.toThrow("already exists");
  const changed = draft("second-notice");
  changed.cohorts[0]!.conditions.intelligence = "enabled";
  await expect(createDraft(root, changed)).rejects.toThrow("different content");
  await expect(createDraft(root, draft("../escape"))).rejects.toThrow(
    "valid notification",
  );
  expect(await readFile(join(root, "notifications/cohorts.json"), "utf8")).toBe(
    before,
  );
  expect((await readCatalog(root)).feed.notifications).toHaveLength(1);
});
test("rejects malformed repository documents and symlinked write paths", async () => {
  const root = await repo();
  await writeFile(
    join(root, "notifications/messages/broken.md"),
    "---\nstatus: active\n---\nBad",
  );
  await expect(createDraft(root, draft())).rejects.toThrow(
    "contract validation",
  );
  await rm(join(root, "notifications/messages"), { recursive: true });
  const outside = await repo();
  await symlink(
    join(outside, "notifications/messages"),
    join(root, "notifications/messages"),
  );
  await expect(createDraft(root, draft())).rejects.toThrow("symlinks");
});
test("serializes concurrent creates and never overwrites a colliding file", async () => {
  const root = await repo();
  const results = await Promise.allSettled([
    createDraft(root, draft()),
    createDraft(root, draft()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const before = await readFile(
    join(root, "notifications/cohorts.json"),
    "utf8",
  );
  // A non-Markdown target collision must fail before replacing the cohort catalog.
  await mkdir(join(root, "notifications/messages/collision.md"));
  await expect(createDraft(root, draft("collision"))).rejects.toThrow();
  expect(await readFile(join(root, "notifications/cohorts.json"), "utf8")).toBe(
    before,
  );
  expect(
    (await readdir(join(root, "notifications"))).filter((f) =>
      f.startsWith("."),
    ),
  ).toEqual([]);
});
test("keeps OR cohorts through preview, prompt, and repository creation", async () => {
  const root = await repo();
  const a = draft().cohorts[0]!;
  const cohorts = [
    { ...a, id: "react-users", conditions: { framework: "react" as const } },
    {
      ...a,
      id: "angular-users",
      conditions: { framework: "angular" as const },
    },
  ];
  const compiled = compilePreview(
    { ...DEFAULT_FIELDS, clientFramework: "angular" },
    cohorts,
  );
  expect(compiled.result.matches).toBe(true);
  expect(compiled.prompt).toContain("Match ANY");
  await createDraft(root, compiled.feed);
  expect((await readCatalog(root)).feed.notifications[0]!.cohorts).toEqual([
    "react-users",
    "angular-users",
  ]);
});

test("rejects metadata that the Intelligence compiler rejects", async () => {
  const root = await repo();
  await createDraft(root, draft());
  const path = join(root, "notifications/messages/test-notice.md");
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    source.replace('"status": "draft"', '"status": "draft", "body": "hidden"'),
  );
  await expect(readCatalog(root)).rejects.toThrow("Unsupported metadata");
});
