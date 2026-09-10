import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDraft, readCatalog } from "./notification-repository.js";
let repository: string;
test.beforeEach(async ({ page }) => {
  repository = await mkdtemp(join(tmpdir(), "notification-browser-"));
  await mkdir(join(repository, "notifications/messages"), { recursive: true });
  await writeFile(join(repository, "notifications/cohorts.json"), "[]");
  await page.route("**/__notifications/catalog", async (route) =>
    route.fulfill({ json: await readCatalog(repository) }),
  );
  await page.route("**/__notifications/drafts", async (route) => {
    try {
      await route.fulfill({
        status: 201,
        json: await createDraft(repository, route.request().postDataJSON()),
      });
    } catch (error) {
      await route.fulfill({ status: 400, json: { error: String(error) } });
    }
  });
});
test.afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

test("drafts a cohort, excludes unknown clients, and exports the exact authoring prompt", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/notifications.html");
  await expect(page.locator("#preview-status")).toHaveText(
    "Live Inspector · fresh client",
  );
  await page.locator("#new-notice").click();
  await page.locator('[name="title"]').fill("Fix for Pro teams");
  await page
    .locator('[name="body"]')
    .fill("## Upgrade\n\nRun `npm update` and read the **release notes**.");
  await page.locator("#audience-fields > summary").click();
  await page.locator('[name="intelligence"]').selectOption("enabled");
  await page.locator('[name="plan"]').fill("pro");
  await page.locator('[name="clientIntelligence"]').selectOption("enabled");
  await page.locator('[name="clientPlan"]').fill("pro");
  await page.locator("#view-selected").click();
  const preview = page.frameLocator("#preview-frame");
  await expect(
    preview.locator(".inspector-whats-new-document-header h1"),
  ).toHaveText("Fix for Pro teams");
  await expect(preview.locator(".announcement-content strong")).toHaveText(
    "release notes",
  );
  await expect(
    preview.getByText("CopilotKit core not attached", { exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Close Web Inspector", exact: true })
    .click();
  await page.locator(".handoff > summary").click();
  await page.locator("#copy-prompt").click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('"plan": "pro"');
  expect(prompt).toContain("Title (preserve exactly): Fix for Pro teams");
  expect(prompt).toContain(
    "## Upgrade\n\nRun `npm update` and read the **release notes**.",
  );
  expect(prompt).toContain("author-notification");
  await page.locator('[name="clientIntelligence"]').selectOption("");
  await expect(page.locator("#match-result")).toContainText(
    "intelligence is unknown",
  );
  await expect(
    preview.getByText("You're all caught up.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.locator("#new-notice").click();
  await page.locator("#audience-fields > summary").click();
  await expect(page.locator('[name="title"]')).toHaveValue("Fix for Pro teams");
  await page.locator('[name="sdkVersion"]').fill("previous release");
  await expect(page.locator("#draft-error")).toContainText(
    "Invalid sdkVersion",
  );
  await expect(page.locator("#copy-prompt")).toBeDisabled();
  await expect(page.locator("#preview-frame")).toHaveAttribute(
    "src",
    "about:blank",
  );
});

test("preview dismissal is isolated and Replay re-arms the real bubble", async ({
  page,
}) => {
  await page.goto("/notifications.html");
  await page.locator("#new-notice").click();
  await page.evaluate(() => {
    localStorage.setItem("cpk:inspector:notifications:v1", "parent-state");
    document.cookie = "cpk_inspector_notifications_v1=parent-cookie; Path=/";
  });
  await page.locator("#replay").click();
  const preview = page.frameLocator("#preview-frame");
  await preview.locator(".console-button").hover();
  await preview
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("cpk:inspector:notifications:v1"),
    ),
  ).toBe("parent-state");
  expect(await page.evaluate(() => document.cookie)).toContain(
    "cpk_inspector_notifications_v1=parent-cookie",
  );
  // The real viewport HUD can overlap the toolbar until the pointer leaves it.
  await page
    .getByRole("heading", { name: "Inspector workbench", exact: true })
    .hover();
  await page.locator("#replay").click();
  await preview.locator(".console-button").hover();
  await expect(
    preview.getByRole("button", {
      name: "Open new notification: Update CopilotKit",
      exact: true,
    }),
  ).toBeVisible();
});

test("creates a repository draft and previews it with independent client settings", async ({
  page,
}) => {
  await page.goto("/notifications.html");
  await page.locator("#new-notice").click();
  await page.locator('[name="title"]').fill("Local test update");
  await page.locator("#create-draft").click();
  await expect(page.locator("#catalog-status")).toContainText("Draft created");
  await expect(page.locator("#notice-list")).toContainText("Local test update");
  const catalog = await readCatalog(repository);
  expect(catalog.feed.notifications).toHaveLength(1);
  expect(Object.values(catalog.statuses)).toEqual(["draft"]);
  await page.locator('[name="clientSdkVersion"]').fill("2.0.0");
  await expect(page.locator("#match-result")).toContainText("No notification");
  await page.locator("#selected-notice > summary").click();
  await page.locator("#duplicate-notice").click();
  await page.locator("#preset").selectOption("pro");
  await expect(page.locator('[name="clientSdkVersion"]')).toHaveValue("2.0.0");
  await page.locator('[name="title"]').fill("");
  await expect(page.locator("#create-draft")).toBeDisabled();
  await expect(page.locator("#preview-frame")).toHaveAttribute(
    "src",
    "about:blank",
  );
});

test("reports unavailable published feeds without showing repository drafts as published", async ({
  page,
}) => {
  await page.route("**/__notifications/published", (route) =>
    route.fulfill({
      status: 400,
      json: { error: "Published feed unavailable (HTTP 404)." },
    }),
  );
  await page.goto("/notifications.html");
  await page.locator("#source-settings > summary").click();
  await page.locator("#catalog-source").selectOption("published");
  await expect(page.locator("#catalog-status")).toContainText(
    "unavailable (HTTP 404)",
  );
  await expect(page.locator("#notice-list")).toBeDisabled();
  await expect(page.locator("#notice-list")).toContainText("No notifications");
});

test("an invalid unfinished draft does not block saved notifications and withdrawn notices stay quiet", async ({
  page,
}) => {
  const { compilePreview, DEFAULT_FIELDS } =
    await import("./notification-authoring.js");
  const feed = compilePreview(DEFAULT_FIELDS).feed;
  await createDraft(repository, feed);
  await page.goto("/notifications.html");
  await expect(page.locator("#match-result")).toContainText(
    "Bubble: Update CopilotKit",
  );
  await page.locator("#new-notice").click();
  await page.locator('[name="title"]').fill("");
  await page.locator("#back-library").click();
  await expect(page.locator("#match-result")).toContainText(
    "Bubble: Update CopilotKit",
  );
  const path = join(
    repository,
    "notifications/messages/preview-notification.md",
  );
  const { readFile } = await import("node:fs/promises");
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace(
      '"status": "draft"',
      '"status": "withdrawn"',
    ),
  );
  await page.locator("#source-settings > summary").click();
  await page.locator("#refresh-catalog").click();
  await expect(page.locator("#selected-status")).toContainText(
    "excluded from delivery",
  );
  await expect(page.locator("#match-result")).toContainText(
    "No notification for this client",
  );
});

test("preview follows the window viewport without clipping the launcher or blocking sidebar controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1035, height: 1040 });
  await page.goto("/notifications.html");
  await expect(page.locator("#preview-status")).toHaveText(
    "Live Inspector · fresh client",
  );
  const preview = page.frameLocator("#preview-frame");
  const launcher = preview.locator(".console-button");
  const initial = await launcher.boundingBox();
  expect(initial!.x + initial!.width).toBeLessThan(1035);
  expect(initial!.x).toBeGreaterThan(900);
  expect(initial!.y).toBeLessThan(30);
  await page.locator('[name="clientSdkVersion"]').fill("1.70.1");
  await page.locator("#preview-view").selectOption("updates");
  const window = preview.locator(".inspector-window");
  await expect(window).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect
    .poll(async () => {
      const box = await window.boundingBox();
      return box && box.x >= 0 && box.x + box.width <= 1440;
    })
    .toBe(true);
  await preview
    .getByRole("button", { name: "Close Web Inspector", exact: true })
    .click();
  await page.locator("#new-notice").click();
  await expect(page.locator('[name="title"]')).toBeVisible();
});

test("loads a matching audience and opens the exact notice without guessing client settings", async ({
  page,
}) => {
  const { compilePreview, DEFAULT_FIELDS } =
    await import("./notification-authoring.js");
  const feed = compilePreview({
    ...DEFAULT_FIELDS,
    title: "Fix for Angular Pro",
    sdkVersion: "1.69.0",
    framework: "angular",
    intelligence: "enabled",
    plan: "pro",
    body: "## Apply the fix\n\nRun `npm update`.",
  }).feed;
  await createDraft(repository, feed);
  await page.goto("/notifications.html");
  await expect(page.locator("#view-selected")).toBeDisabled();
  await page.locator("#match-details > summary").click();
  await expect(page.locator("#audience-check")).toContainText("No match");
  await page.locator("#load-matching-client").click();
  await expect(page.locator("#view-selected")).toBeEnabled();
  await expect(
    page.frameLocator("#preview-frame").locator(".inspector-window"),
  ).not.toBeVisible();
  await expect(page.locator("#notice-list")).toBeVisible();
  await expect(page.locator("#client-form")).toBeVisible();
  await page.locator("#view-selected").click();
  const preview = page.frameLocator("#preview-frame");
  await expect(
    preview.locator(".inspector-whats-new-document-header h1"),
  ).toHaveText("Fix for Angular Pro");
  await expect(preview.locator(".announcement-content h2")).toHaveText(
    "Apply the fix",
  );
  await preview
    .getByRole("button", { name: "Close Web Inspector", exact: true })
    .click();
  await expect(page.locator("#audience-check")).not.toContainText("No match");
  await expect(page.locator('[name="clientSdkVersion"]')).toHaveValue("1.69.0");
  await expect(page.locator('[name="clientFramework"]')).toHaveValue("angular");
  await expect(page.locator('[name="clientIntelligence"]')).toHaveValue(
    "enabled",
  );
  await expect(page.locator('[name="clientPlan"]')).toHaveValue("pro");
});

test("shares navigation and usable narrow layouts across both workbench pages", async ({
  page,
}) => {
  await page.goto("/?scenario=pro-enabled-existing");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await page
    .getByRole("button", { name: "Close Web Inspector", exact: true })
    .click();
  await page.locator("#open-inspector").click();
  await expect(page.locator(".inspector-window")).toBeVisible();
  await page
    .getByRole("button", { name: "Close Web Inspector", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#scenario-select")).toBeInViewport();
  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(page.locator("#notice-list")).toBeInViewport();
  await expect(
    page.getByRole("link", { name: "Notifications", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("link", { name: "Scenarios", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Scenarios", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
