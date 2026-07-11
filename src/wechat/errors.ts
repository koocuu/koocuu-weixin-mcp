export class WechatApiError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WechatApiError";
  }
}

function stackHead(error: Error) {
  return error.stack?.split("\n").slice(0, 5).join("\n");
}

export function serializeError(error: unknown) {
  if (error instanceof WechatApiError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: stackHead(error),
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}
