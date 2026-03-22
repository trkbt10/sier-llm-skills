/** @file createEvidenceServer の単体テスト。 */
import { createEvidenceServer } from "./evidence-server";
import type { CaptureStrategy, BrowserSession } from "../browser-control/types";

function createFakeSession(): BrowserSession {
  return {
    async navigate() {
      /* noop */
    },
    async screenshot() {
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    },
    async click() {
      /* noop */
    },
    async type() {
      /* noop */
    },
    async evaluate<T>(): Promise<T> {
      return "test-result" as T;
    },
    async close() {
      /* noop */
    },
  };
}

function createFakeStrategy(): CaptureStrategy & { mockSession: BrowserSession } {
  const mockSession = createFakeSession();
  return {
    name: "mock",
    async launch() {
      return mockSession;
    },
    mockSession,
  };
}

describe("createEvidenceServer", () => {
  it("creates a Server instance", () => {
    const strategy = createFakeStrategy();
    const server = createEvidenceServer({
      strategy,
      outputDir: "/tmp/evidence-test",
    });

    expect(server).toBeDefined();
    expect(server.connect).toBeTypeOf("function");
  });
});
