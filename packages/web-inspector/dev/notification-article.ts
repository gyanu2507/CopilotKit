import { notificationArticleStyles } from "../src/styles/notification-article.js";
import { renderNotificationMarkdown } from "./notification-markdown.js";

/** Isolate the real article styles from the workbench's form and layout rules. */
export function createNotificationArticle(host: HTMLElement) {
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");
    :host { display: block; font: 14px/1.5 "Plus Jakarta Sans", system-ui, sans-serif;
      --updates-text: #1b1924; --updates-muted: #6c687c; --updates-border: #e6e4ef; }
    *, ::before, ::after { box-sizing: border-box; border: 0 solid; margin: 0; padding: 0; }
    h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
    a { color: inherit; text-decoration: inherit; }
    code, pre { font-family: "Spline Sans Mono", ui-monospace, "Cascadia Code", monospace; font-size: 1em; }
    table { border-collapse: collapse; border-color: inherit; text-indent: 0; }
    img { display: block; max-width: 100%; height: auto; }
    button { font: inherit; }
    ${notificationArticleStyles.cssText}
  </style>
  <article class="inspector-whats-new-document">
    <header class="inspector-whats-new-document-header">
      <h1 id="selected-title"></h1><time></time>
    </header>
    <div id="selected-body" class="announcement-content"></div>
  </article>`;
  const title = root.querySelector("h1")!;
  const date = root.querySelector("time")!;
  const content = root.querySelector<HTMLElement>(".announcement-content")!;
  let renderedBody: string | undefined;
  content.addEventListener("click", async (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-copy]")
        : null;
    if (!button) return;
    try {
      const bytes = Uint8Array.from(atob(button.dataset.copy!), (c) =>
        c.charCodeAt(0),
      );
      await navigator.clipboard.writeText(new TextDecoder().decode(bytes));
      button.dataset.copied = "true";
      button.textContent = "Copied!";
      setTimeout(() => {
        delete button.dataset.copied;
        button.textContent = "Copy";
      }, 2000);
    } catch {
      button.textContent = "Copy failed";
    }
  });
  return (heading: string, publishedAt: string, body: string) => {
    title.textContent = heading;
    date.dateTime = publishedAt;
    date.textContent = new Date(publishedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    if (body !== renderedBody) {
      content.innerHTML = renderNotificationMarkdown(body);
      renderedBody = body;
    }
  };
}
