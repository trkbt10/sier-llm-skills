/**
 * @file Chrome DevTools MCP キャプチャ戦略。
 *
 * Google 公式の chrome-devtools-mcp を MCP クライアントとして起動し、
 * MCP ツール呼び出しでブラウザー操作とスクリーンショット取得を行う。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  CaptureStrategy,
  BrowserSession,
} from "../types";

/** Chrome DevTools MCP キャプチャ戦略を生成する。 */
export function createChromeMcpCaptureStrategy(): CaptureStrategy {
  return {
    name: "chrome-mcp",

    async launch(): Promise<BrowserSession> {
      const transport = new StdioClientTransport({
        command: "npx",
        args: ["chrome-devtools-mcp@latest"],
      });

      const client = new Client({
        name: "screenshot-evidence",
        version: "0.1.0",
      });

      await client.connect(transport);

      return {
        async navigate(url: string): Promise<void> {
          await client.callTool({ name: "navigate_page", arguments: { url } });
        },

        async screenshot(): Promise<Uint8Array> {
          const result = await client.callTool({ name: "take_screenshot", arguments: {} });
          const content = result.content;
          if (!Array.isArray(content)) {
            throw new Error("Unexpected MCP response format");
          }

          for (const item of content) {
            if (
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "image" &&
              "data" in item &&
              typeof item.data === "string"
            ) {
              return Uint8Array.from(atob(item.data), (c) => c.charCodeAt(0));
            }
          }

          for (const item of content) {
            if (
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              item.type === "text" &&
              "text" in item &&
              typeof item.text === "string"
            ) {
              const base64Match = item.text.match(
                /data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/,
              );
              if (base64Match) {
                return Uint8Array.from(atob(base64Match[1]), (c) => c.charCodeAt(0));
              }
            }
          }

          throw new Error("No screenshot data found in MCP response");
        },

        async click(selector: string): Promise<void> {
          await client.callTool({ name: "click", arguments: { selector } });
        },

        async type(selector: string, text: string): Promise<void> {
          await client.callTool({ name: "fill", arguments: { selector, value: text } });
        },

        async evaluate<T>(fn: string): Promise<T> {
          const result = await client.callTool({
            name: "evaluate_script",
            arguments: { script: fn },
          });
          const evalContent = result.content;
          if (
            Array.isArray(evalContent) &&
            evalContent.length > 0 &&
            typeof evalContent[0] === "object" &&
            evalContent[0] !== null &&
            "text" in evalContent[0] &&
            typeof evalContent[0].text === "string"
          ) {
            return JSON.parse(evalContent[0].text) as T;
          }
          throw new Error("Unexpected evaluate response format");
        },

        async close(): Promise<void> {
          await client.close();
        },
      };
    },
  };
}
