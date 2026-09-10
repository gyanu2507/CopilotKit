import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";

/** Rich text is an authoring surface; Markdown remains the saved contract. */
export function createNotificationEditor(source: HTMLTextAreaElement) {
  const toolbar = document.getElementById("format-toolbar")!;
  const host = document.getElementById("rich-message")!;
  const toggle = document.getElementById("toggle-markdown")!;
  const linkControls = document.getElementById("link-controls")!;
  const linkUrl = document.getElementById("link-url") as HTMLInputElement;
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Markdown,
      TableKit,
      Image,
    ],
    content: source.value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Notification message",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: updated }) => {
      source.value = updated.getMarkdown();
      source.dispatchEvent(new Event("input", { bubbles: true }));
    },
  });
  const actions = [
    {
      label: "Bold",
      text: "B",
      mark: "bold",
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      text: "Italic",
      mark: "italic",
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Heading",
      text: "Heading",
      mark: "heading",
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Bullet list",
      text: "List",
      mark: "bulletList",
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Code block",
      text: "Code",
      mark: "codeBlock",
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "Link",
      text: "Link",
      mark: "link",
      run: () => {
        linkControls.hidden = !linkControls.hidden;
        linkUrl.value = String(editor.getAttributes("link").href ?? "");
        if (!linkControls.hidden) linkUrl.focus();
      },
    },
    {
      label: "Undo",
      text: "Undo",
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "Redo",
      text: "Redo",
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  const buttons = actions.map((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.text;
    button.setAttribute("aria-label", action.label);
    button.addEventListener("click", action.run);
    toolbar.append(button);
    return button;
  });
  editor.on("transaction", () =>
    actions.forEach((action, i) => {
      if (action.mark)
        buttons[i]!.setAttribute(
          "aria-pressed",
          String(editor.isActive(action.mark)),
        );
    }),
  );
  document.getElementById("apply-link")!.addEventListener("click", () => {
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(linkUrl.value)) {
      linkUrl.setCustomValidity(
        "Use an https://, http://, mailto:, or relative link.",
      );
      linkUrl.reportValidity();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: linkUrl.value })
      .run();
    linkControls.hidden = true;
  });
  linkUrl.addEventListener("input", () => linkUrl.setCustomValidity(""));
  document.getElementById("remove-link")!.addEventListener("click", () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    linkControls.hidden = true;
  });
  const setMarkdown = () =>
    editor.commands.setContent(source.value, {
      contentType: "markdown",
      emitUpdate: false,
    });
  source.addEventListener("input", () => {
    if (!source.hidden) setMarkdown();
  });
  toggle.addEventListener("click", () => {
    const showSource = source.hidden;
    source.hidden = !showSource;
    host.hidden = showSource;
    toolbar.hidden = showSource;
    linkControls.hidden = true;
    toggle.setAttribute("aria-pressed", String(showSource));
    toggle.textContent = showSource ? "Rich text" : "Markdown source";
    if (showSource) source.focus();
    else {
      setMarkdown();
      editor.commands.focus();
    }
  });
  window.addEventListener("pagehide", () => editor.destroy(), { once: true });
  return { setMarkdown };
}
