import { marked } from "marked";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

const safeUrl = (href: string, image = false) => {
  try {
    const protocol = new URL(href, location.href).protocol;
    return ["https:", "http:", ...(image ? [] : ["mailto:"])].includes(
      protocol,
    );
  } catch {
    return false;
  }
};

/** Authoring content is untrusted, including content loaded from the repository. */
export function renderNotificationMarkdown(markdown: string): string {
  const renderer = new marked.Renderer();
  renderer.html = escape;
  renderer.link = (href, title, text) =>
    `<a href="${escape(safeUrl(href) ? href : "#")}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escape(title)}"` : ""}>${text}</a>`;
  renderer.image = (href, title, text) =>
    safeUrl(href, true)
      ? `<img src="${escape(href)}" alt="${escape(text)}"${title ? ` title="${escape(title)}"` : ""} loading="lazy" />`
      : escape(text);
  const html = marked.parse(markdown, { renderer, async: false });
  if (typeof html !== "string")
    throw new Error("Expected synchronous Markdown rendering");
  return html;
}
