import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { serializeError } from "@/src/wechat/errors";

export function jsonToolResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function errorToolResult(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(serializeError(error), null, 2),
      },
    ],
  };
}

export function toolHandler<T>(handler: (input: T) => Promise<unknown> | unknown) {
  return async (input: T) => {
    try {
      return jsonToolResult(await handler(input));
    } catch (error) {
      return errorToolResult(error);
    }
  };
}
