import type { Plugin } from "vite";
import { createDraft, readCatalog } from "./notification-repository.js";
import { parseNotificationFeed } from "../src/lib/notifications.js";
import { NOTIFICATION_FEED_URL } from "../src/lib/notification-loader.js";

export function createNotificationAuthoringPlugin() {
  return {
    name: "local-notification-authoring",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          const route = req.url?.split("?")[0];
          if (!route?.startsWith("/__notifications/")) return next();
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          const reply = (status: number, value: unknown) => {
            res.statusCode = status;
            res.end(JSON.stringify(value));
          };
          const host = req.headers.host;
          if (host !== "127.0.0.1:5177" && host !== "localhost:5177")
            return reply(403, { error: "Use the loopback workbench address." });
          if (req.headers.origin && req.headers.origin !== `http://${host}`)
            return reply(403, {
              error: "Cross-origin requests are not allowed.",
            });
          try {
            if (
              route === "/__notifications/published" &&
              req.method === "GET"
            ) {
              const response = await fetch(NOTIFICATION_FEED_URL, {
                signal: AbortSignal.timeout(5000),
              });
              if (!response.ok)
                throw new Error(
                  `Published feed unavailable (HTTP ${response.status}).`,
                );
              const feed = parseNotificationFeed(await response.json());
              if (!feed)
                throw new Error("Published feed failed contract validation.");
              return reply(200, {
                feed,
                statuses: Object.fromEntries(
                  feed.notifications.map((n) => [n.id, "active"]),
                ),
                source: NOTIFICATION_FEED_URL,
              });
            }
            const root = process.env.CPK_NOTIFICATION_REPO;
            if (!root)
              return reply(503, {
                error:
                  "Start the workbench with CPK_NOTIFICATION_REPO pointing to your Intelligence worktree.",
              });
            if (route === "/__notifications/catalog" && req.method === "GET")
              return reply(200, await readCatalog(root));
            if (route === "/__notifications/drafts" && req.method === "POST") {
              if (
                req.headers.origin !== `http://${host}` ||
                req.headers["content-type"]?.split(";")[0] !==
                  "application/json"
              )
                return reply(403, {
                  error: "Draft creation requires same-origin JSON.",
                });
              const chunks: Buffer[] = [];
              let size = 0;
              for await (const chunk of req) {
                const bytes = Buffer.from(chunk);
                size += bytes.length;
                if (size > 150000)
                  return reply(413, { error: "Draft is too large." });
                chunks.push(bytes);
              }
              return reply(
                201,
                await createDraft(
                  root,
                  JSON.parse(Buffer.concat(chunks).toString("utf8")),
                ),
              );
            }
            reply(405, { error: "Unsupported authoring action." });
          } catch (error) {
            reply(400, {
              error:
                error instanceof Error
                  ? error.message
                  : "Could not load or save notifications.",
            });
          }
        })().catch(next);
      });
    },
  } satisfies Plugin;
}
