#!/usr/bin/env node
import { createInterface } from "node:readline";
import { PluffTools, toolDefinitions } from "./tools.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const tools = new PluffTools();

const lines = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

lines.on("line", async (line) => {
  if (!line.trim()) {
    return;
  }

  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch (error) {
    write({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    return;
  }

  try {
    const result = await handle(request);
    if (request.id !== undefined) {
      write({ jsonrpc: "2.0", id: request.id, result });
    }
  } catch (error) {
    if (request.id !== undefined) {
      write({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Unknown MCP error",
        },
      });
    }
  }
});

async function handle(request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "pluff-mcp", version: "0.1.0" },
      };
    case "tools/list":
      return { tools: toolDefinitions };
    case "tools/call": {
      const params = request.params ?? {};
      const name = params.name;
      const args = params.arguments;
      if (typeof name !== "string") {
        throw new Error("tools/call requires a tool name");
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        throw new Error("tools/call requires object arguments");
      }
      const result = await tools.call(name, args as Record<string, unknown>);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      throw new Error(`Unsupported MCP method: ${request.method}`);
  }
}

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

