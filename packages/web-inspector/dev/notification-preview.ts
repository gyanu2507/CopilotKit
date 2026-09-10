import { CopilotKitCore } from "@copilotkit/core";
import { WEB_INSPECTOR_TAG } from "@copilotkit/web-inspector";
import type { WebInspectorElement } from "@copilotkit/web-inspector";
import { parseNotificationFeed } from "../src/lib/notifications.js";
import { NOTIFICATION_FEED_URL } from "../src/lib/notification-loader.js";

// Keep preview dismissals and layout isolated from the parent workbench.
const cookies = new Map<string, string>();
Object.defineProperty(document, "cookie", {
  get: () => [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
  set: (entry: string) => {
    const pair = entry.split(";")[0] ?? "";
    const at = pair.indexOf("=");
    const key = pair.slice(0, at);
    if (/max-age=0/i.test(entry)) cookies.delete(key);
    else cookies.set(key, pair.slice(at + 1));
  },
});
const values = new Map<string, string>();
const storage: Storage = {
  get length() {
    return values.size;
  },
  clear() {
    values.clear();
  },
  getItem(key) {
    return values.get(key) ?? null;
  },
  key(index) {
    return [...values.keys()][index] ?? null;
  },
  removeItem(key) {
    values.delete(key);
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
};
Object.defineProperty(window, "localStorage", { value: storage });
storage.setItem(
  "cpk:inspector:state",
  JSON.stringify({
    dockMode: "floating",
    isOpen: false,
    selectedMenu: "whats-new",
    sidebarCollapsed: false,
    window: {
      size: {
        width: Math.min(960, window.innerWidth - 48),
        height: Math.min(740, window.innerHeight - 48),
      },
    },
  }),
);
// Preview interactions never send product telemetry.
class NotificationPreviewCore extends CopilotKitCore {
  override get telemetryDisabled(): boolean {
    return true;
  }
}

let mounted = false;
window.addEventListener("message", async (event) => {
  if (
    event.origin !== location.origin ||
    event.source !== parent ||
    event.data?.kind !== "notification-preview" ||
    mounted
  )
    return;
  const feed = parseNotificationFeed(event.data.feed);
  if (!feed || !event.data.context?.development) return;
  mounted = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? new URL(input, location.href).href
        : input instanceof URL
          ? input.href
          : input.url;
    return url === NOTIFICATION_FEED_URL
      ? Promise.resolve(
          new Response(JSON.stringify(feed), {
            headers: { "content-type": "application/json" },
          }),
        )
      : nativeFetch(input, init);
  };
  const inspector: WebInspectorElement =
    document.createElement(WEB_INSPECTOR_TAG);
  inspector.setAttribute("auto-attach-core", "false");
  inspector.core = new NotificationPreviewCore({
    deferInitialConnection: true,
  });
  inspector.notificationContext = event.data.context;
  document.body.append(inspector);
  await inspector.updateComplete;
  if (event.data.view === "updates") {
    document.querySelector("#hint")?.remove();
    inspector.openInspector("floating_button");
    await inspector.updateComplete;
    inspector.shadowRoot
      ?.querySelector<HTMLButtonElement>(
        '[data-inspector-menu-key="whats-new"]',
      )
      ?.click();
  }
  parent.postMessage({ kind: "notification-preview-mounted" }, location.origin);
});
parent.postMessage({ kind: "notification-preview-ready" }, location.origin);
