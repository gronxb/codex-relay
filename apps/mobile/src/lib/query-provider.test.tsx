import { createRequire } from "node:module";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";

// Exercise the installed dependency graph; mocks or bundler deduplication hide
// the separate QueryClient contexts that crash the native release on startup.
const requireFromApp = createRequire(import.meta.url);
const { QueryClient, useQueryClient } = requireFromApp(
  "@tanstack/react-query",
) as typeof import("@tanstack/react-query");
const { PersistQueryClientProvider } = requireFromApp(
  "@tanstack/react-query-persist-client",
) as typeof import("@tanstack/react-query-persist-client");

it("makes the persisted query client available to a screen on first render", () => {
  const client = new QueryClient();
  function Screen() {
    return <span>{useQueryClient() === client ? "client ready" : "wrong client"}</span>;
  }

  const html = renderToString(
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister: {
          persistClient: () => undefined,
          restoreClient: () => undefined,
          removeClient: () => undefined,
        },
      }}
    >
      <Screen />
    </PersistQueryClientProvider>,
  );

  expect(html).toContain("client ready");
});
