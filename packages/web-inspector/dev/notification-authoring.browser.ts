import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDraft, readCatalog } from "./notification-repository.js";
const articleStyleSnapshot = (element: Element) => {
  const style = getComputedStyle(element);
  return Object.fromEntries(
    [
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
      "color",
      "background-color",
      "padding",
      "margin",
      "letter-spacing",
    ].map((key) => [key, style.getPropertyValue(key)]),
  );
};
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
  await expect(page.locator("#preview-frame")).toHaveAttribute(
    "src",
    "about:blank",
  );
  await page.locator("#new-notice").click();
  await page.locator('[name="title"]').fill("Fix for Pro teams");
  await page.locator("#toggle-markdown").click();
  await page
    .locator('[name="body"]')
    .fill("## Upgrade\n\nRun `npm update` and read the **release notes**.");
  await page.locator("#draft-audience > summary").click();
  await page.locator('[name="intelligence"]').selectOption("enabled");
  await page.locator('[name="plan"]').fill("pro");
  await page.locator("#preview-draft").click();
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

  await page.locator("#copy-prompt").click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('"plan": "pro"');
  expect(prompt).toContain("Title (preserve exactly): Fix for Pro teams");
  expect(prompt).toContain(
    "## Upgrade\n\nRun `npm update` and read the **release notes**.",
  );
  expect(prompt).toContain("author-notification");
  await page.locator("#back-library").click();
  await page.locator('[name="clientIntelligence"]').selectOption("");
  await expect(page.locator("#match-result")).toContainText(
    "intelligence is unknown",
  );
  await expect(page.locator("#preview-frame")).toHaveAttribute(
    "src",
    "about:blank",
  );
  await page.reload();
  await page.locator("#new-notice").click();
  await expect(page.locator('[name="title"]')).toHaveValue("Fix for Pro teams");
  await page.locator("#draft-audience > summary").click();
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

test("preview dismissal is isolated and another preview re-arms the real bubble", async ({
  page,
}) => {
  await page.goto("/notifications.html");
  await page.locator("#new-notice").click();
  await page.locator("#back-library").click();
  await page.evaluate(() => {
    localStorage.setItem("cpk:inspector:notifications:v1", "parent-state");
    document.cookie = "cpk_inspector_notifications_v1=parent-cookie; Path=/";
  });
  await page.locator("#view-selected").click();
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
  await page.locator("#view-selected").click();
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
  await page.locator("#notice-list").selectOption("preview-notification");
  await expect(page.locator("#match-result")).toContainText(
    "Bubble: Update CopilotKit",
  );
  await page.locator("#notice-list").selectOption("workbench:draft");
  await expect(page.locator("#working-draft")).toBeVisible();
  await expect(page.locator("#editor")).not.toBeVisible();
  await expect(page.locator("#preview-frame")).toHaveAttribute(
    "src",
    "about:blank",
  );
  await page.locator("#resume-draft").click();
  await expect(page.locator('[name="title"]')).toHaveValue("");
  await page.locator("#back-library").click();
  await page.locator("#notice-list").selectOption("preview-notification");
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
  await expect(page.locator("#preview-frame")).toHaveAttribute(
    "src",
    "about:blank",
  );
  await page.locator("#new-notice").click();
  await page.locator("#back-library").click();
  await page.locator("#view-selected").click();
  const preview = page.frameLocator("#preview-frame");
  const launcher = preview.locator(".console-button");
  const initial = await launcher.boundingBox();
  expect(initial!.x + initial!.width).toBeLessThan(1035);
  expect(initial!.x).toBeGreaterThan(900);
  expect(initial!.y).toBeLessThan(30);
  await page.locator('[name="clientSdkVersion"]').fill("1.70.1");
  await page.locator("#preview-view").selectOption("updates");
  await page.locator("#view-selected").click();
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
  await page.locator("#audience-selector > summary").click();
  await page.locator("#load-matching-client").click();
  await expect(page.locator("#view-selected")).toBeEnabled();
  await expect(
    page.frameLocator("#preview-frame").locator(".inspector-window"),
  ).not.toBeVisible();
  await expect(page.locator("#notice-list")).toBeVisible();
  await expect(page.locator("#client-form")).toBeVisible();
  await page.locator("#preview-view").selectOption("updates");
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

test("keeps the entire animated launcher intro inside the preview mask", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/notifications.html");
  const preview = page.frameLocator("#preview-frame");
  await page.locator("#new-notice").click();
  await page.locator("#back-library").click();
  await page.locator("#view-selected").click();
  const hud = preview.locator('.cpk-launcher-hud[data-cpk-hud-intro="true"]');
  await expect(hud).toBeVisible();
  // Hit-test the parent at both edges: an iframe can report a visible child
  // even when its clip-path cuts that child off from the actual page.
  await expect
    .poll(async () => {
      const bounds = await hud.boundingBox();
      if (!bounds) return false;
      return page.evaluate(
        ({ x, y, width, height }) =>
          [x + 4, x + width - 4].every(
            (left) =>
              document.elementFromPoint(left, y + height / 2)?.id ===
              "preview-frame",
          ),
        bounds,
      );
    })
    .toBe(true);
  await expect(hud).not.toBeVisible();
  // Once the intro closes, the sidebar must be clickable again.
  await page.locator("#new-notice").click();
  await expect(page.locator('[name="title"]')).toBeVisible();
});

test("edits rich text in a modal without reopening the Inspector and saves Markdown", async ({
  page,
}) => {
  await page.goto("/notifications.html");
  await page.locator("#new-notice").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const message = page.getByRole("textbox", {
    name: "Notification message",
    exact: true,
  });
  await message.fill("Important update");
  await message.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(page.locator('[name="body"]')).toHaveValue(
    "**Important update**",
  );
  await page.locator("#preview-draft").click();
  const preview = page.frameLocator("#preview-frame");
  await expect(preview.locator(".announcement-content strong")).toHaveText(
    "Important update",
  );
  await preview
    .getByRole("button", { name: "Close Web Inspector", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(message).toHaveText("Important update");
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame.parentFrame()) navigations.push(frame.url());
  });
  await page.locator('[name="title"]').fill("Edited title");
  await message.click();
  await message.press("ControlOrMeta+End");
  // Tiptap restores focus/selection on the next animation frame.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await message.pressSequentially(" for everyone");
  await page.waitForTimeout(650); // Covers the old 400 ms auto-preview debounce.
  expect(
    navigations.filter((url) => url.includes("notification-preview.html")),
  ).toEqual([]);
  await expect(page.locator("#preview-frame")).toHaveAttribute(
    "src",
    "about:blank",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.locator("#resume-draft").click();
  await expect(message).toContainText("for everyone");
  await page.locator("#create-draft").click();
  await expect(page.locator("#catalog-status")).toContainText("Draft created");
  const catalog = await readCatalog(repository);
  expect(catalog.feed.notifications[0]?.title).toBe("Edited title");
  expect(catalog.feed.notifications[0]?.body).toContain("**Important update");
  expect(catalog.feed.notifications[0]?.body).toContain("for everyone");
});

test("edits audience without resizing the draft and dismisses back to the composer", async ({
  page,
}) => {
  await page.goto("/notifications.html");
  await page.locator("#new-notice").click();
  const modal = page.locator("#editor");
  const audience = page.locator("#draft-audience");
  const summary = audience.locator(":scope > summary");
  for (const width of [1052, 390]) {
    await page.setViewportSize({ width, height: 1044 });
    const bounds = await modal.boundingBox();
    const messageBounds = await page.locator(".message-editor").boundingBox();
    await summary.click();
    await expect(
      page.getByRole("group", { name: "Edit audience", exact: true }),
    ).toBeVisible();
    expect(await modal.boundingBox()).toEqual(bounds);
    expect(await page.locator(".message-editor").boundingBox()).toEqual(
      messageBounds,
    );
    await audience.locator('[name="plan"]').fill("pro");
    await page.keyboard.press("Escape");
    await expect(audience).not.toHaveAttribute("open");
    await expect(modal).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary).toContainText("pro plan");
    await summary.click();
    await expect(audience.locator('[name="plan"]')).toHaveValue("pro");
    await page.locator("#done-audience").click();
    await expect(audience).not.toHaveAttribute("open");
    await expect(summary).toBeFocused();
    await summary.click();
    await page.locator('[name="title"]').click();
    await expect(audience).not.toHaveAttribute("open");
    await expect(page.locator("#preview-frame")).toHaveAttribute(
      "src",
      "about:blank",
    );
  }
});

test("reads a formatted notification without opening the Inspector or executing embedded HTML", async ({
  page,
}) => {
  await page.goto("/notifications.html");
  await page.locator("#new-notice").click();
  await page.locator('[name="title"]').fill("Release notes");
  await page.locator("#toggle-markdown").click();
  await page
    .locator('[name="body"]')
    .fill(
      "## Upgrade\n\nRead the **release notes**.\n\n```sh\nnpm update\n```\n\n[Unsafe](javascript:alert(1))\n\n<script>window.injected = true</script>",
    );
  await page.locator("#back-library").click();
  await expect(page.locator("#selected-title")).toHaveText("Release notes");
  await expect(page.locator("#selected-body h2")).toHaveText("Upgrade");
  await expect(page.locator("#selected-body strong")).toHaveText(
    "release notes",
  );
  await expect(page.locator("#selected-body pre code")).toContainText(
    "npm update",
  );
  await expect(page.locator("#selected-body script")).toHaveCount(0);
  await expect(page.locator("#selected-body a")).toHaveAttribute("href", "#");
  await expect(page.locator("#preview-frame")).toHaveAttribute(
    "src",
    "about:blank",
  );
  await expect(page.locator("#match-result")).toContainText(
    "Matches this client",
  );
  await page.locator('[name="clientIntelligence"]').selectOption("enabled");
  await expect(page.locator("#match-result")).toContainText(
    "This notification won't appear",
  );
  await expect(page.locator("#view-selected")).toBeDisabled();
  await expect(page.locator("#selected-title")).toHaveText("Release notes");
});

test("uses the Inspector article typography and copies code without Markdown decoration", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/notifications.html");
  await page.locator("#new-notice").click();
  await page.locator("#toggle-markdown").click();
  await page
    .locator('[name="body"]')
    .fill(
      '## Release details\n\nRead **this update** and [the guide](https://example.com). Use `npm update`.\n\n- First item\n- Second item\n\n```sh\necho "Hello 世界"\n```',
    );
  await page.locator("#back-library").click();
  const reader = page.locator("#article-content");
  await reader.getByRole("button", { name: "Copy code" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'echo "Hello 世界"',
  );
  await page.locator("#preview-view").selectOption("updates");
  await page.locator("#view-selected").click();
  const inspector = page
    .frameLocator("#preview-frame")
    .locator(".inspector-whats-new-document");
  await expect(inspector).toBeVisible();
  for (const selector of [
    "header h1",
    "time",
    ".announcement-content",
    ".announcement-content h2",
    ".announcement-content p",
    ".announcement-content a",
    ".announcement-content li",
    ".announcement-content p code",
    ".announcement-code pre",
    ".announcement-code pre code",
  ]) {
    expect
      .soft(
        await reader.locator(selector).first().evaluate(articleStyleSnapshot),
        selector,
      )
      .toEqual(
        await inspector
          .locator(selector)
          .first()
          .evaluate(articleStyleSnapshot),
      );
  }
  await expect(reader.locator("time")).toHaveText(
    await inspector.locator("time").innerText(),
  );
});
