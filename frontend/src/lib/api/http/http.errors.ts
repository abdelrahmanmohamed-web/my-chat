import axios from "axios";
import {
  isMaxSessionsReachedResponse,
  type MaxSessionsReachedResponse,
} from "@/types/auth";

export class ApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly data: unknown;
  readonly isNetworkError: boolean;

  constructor(options: {
    message: string;
    status: number | null;
    code?: string | null;
    data?: unknown;
    isNetworkError?: boolean;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.data = options.data ?? null;
    this.isNetworkError = options.isNetworkError ?? false;
  }
}

function extractMessageFromData(data: unknown): {
  message: string | null;
  code: string | null;
} {
  if (typeof data !== "object" || data === null) {
    return { message: null, code: null };
  }

  const record = data as Record<string, unknown>;
  const errorField = typeof record.error === "string" ? record.error : null;
  const messageField =
    typeof record.message === "string" ? record.message : null;

  return {
    message: messageField ?? errorField,
    code: errorField,
  };
}

/**
 * Normalizes Axios or unknown failures into a predictable ApiError instance.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return new ApiError({
        message: "تعذر الاتصال بالخادم. تحقق من اتصال الشبكة وحاول مجدداً.",
        status: null,
        isNetworkError: true,
      });
    }

    const { status, data } = error.response;
    const { message, code } = extractMessageFromData(data);

    return new ApiError({
      message: message ?? "حدث خطأ غير متوقع أثناء معالجة الطلب.",
      status,
      code,
      data,
    });
  }

  if (error instanceof Error) {
    return new ApiError({
      message: error.message,
      status: null,
    });
  }

  return new ApiError({
    message: "حدث خطأ غير متوقع أثناء معالجة الطلب.",
    status: null,
  });
}

/**
 * Extracts a typed HTTP 409 max-sessions payload when login hits session limit.
 */
export function extractMaxSessionsError(
  error: unknown,
): MaxSessionsReachedResponse | null {
  if (error instanceof ApiError) {
    if (error.status === 409 && isMaxSessionsReachedResponse(error.data)) {
      return error.data;
    }
    return null;
  }

  if (
    axios.isAxiosError(error) &&
    error.response?.status === 409 &&
    isMaxSessionsReachedResponse(error.response.data)
  ) {
    return error.response.data;
  }

  return null;
}
