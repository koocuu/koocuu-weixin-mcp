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
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}
