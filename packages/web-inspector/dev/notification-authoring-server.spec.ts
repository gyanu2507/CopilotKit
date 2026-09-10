// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createServer, request } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNotificationAuthoringPlugin } from "./notification-authoring-server.js";
import { compilePreview, DEFAULT_FIELDS } from "./notification-authoring.js";
import { readCatalog } from "./notification-repository.js";
let server: Server;
let port: number;
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "notification-api-"));
  await mkdir(join(root, "notifications/messages"), { recursive: true });
  await writeFile(join(root, "notifications/cohorts.json"), "[]");
  vi.stubEnv("CPK_NOTIFICATION_REPO", root);
  createNotificationAuthoringPlugin().configureServer.call(
    {} as never,
    {
      middlewares: {
        use(handler: Parameters<typeof createServer>[0]) {
          server = createServer(handler);
        },
      },
    } as never,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  port = address.port;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
function post(
  chunks: Buffer[],
  headers: Record<string, string | undefined> = {},
) {
  return new Promise<{ status: number; body: Record<string, unknown> }>(
    (resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/__notifications/drafts",
          method: "POST",
          headers: {
            host: "127.0.0.1:5177",
            origin: "http://127.0.0.1:5177",
            "content-type": "application/json",
            ...headers,
          },
        },
        (res) => {
          const result: Buffer[] = [];
          res.on("data", (chunk) => result.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              body: JSON.parse(Buffer.concat(result).toString()),
            }),
          );
        },
      );
      req.on("error", reject);
      const send = () => {
        const chunk = chunks.shift();
        if (chunk) {
          req.write(chunk);
          setTimeout(send, 2);
        } else req.end();
      };
      send();
    },
  );
}
test("creates a draft through HTTP without corrupting split Unicode", async () => {
  const feed = compilePreview({
    ...DEFAULT_FIELDS,
    title: "Update 🚀",
    body: "Café — こんにちは",
  }).feed;
  const bytes = Buffer.from(JSON.stringify(feed));
  const at = bytes.indexOf(Buffer.from("🚀")) + 2;
  expect((await post([bytes.subarray(0, at), bytes.subarray(at)])).status).toBe(
    201,
  );
  expect((await readCatalog(root)).feed.notifications[0]!.title).toBe(
    "Update 🚀",
  );
});
test("rejects cross-origin, missing origin, wrong host and oversized mutations", async () => {
  const bytes = Buffer.from(
    JSON.stringify(compilePreview(DEFAULT_FIELDS).feed),
  );
  for (const headers of [
    { origin: "https://evil.example" },
    { origin: "" },
    { host: "evil.example" },
    { "content-type": "text/plain" },
  ])
    expect((await post([bytes], headers)).status).toBe(403);
  expect((await post([Buffer.alloc(150001, "x")])).status).toBe(413);
  expect((await readCatalog(root)).feed.notifications).toHaveLength(0);
});
