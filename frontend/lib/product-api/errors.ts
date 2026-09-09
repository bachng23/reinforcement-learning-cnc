import type { ApiErrorDetail, FieldErrors } from "@/types/product-api";

export interface ProductApiErrorOptions {
  status: number;
  statusText?: string;
  code?: string;
  details?: ApiErrorDetail[];
  fieldErrors?: FieldErrors;
  cause?: unknown;
}

/** A normalized request, validation, or response-shape failure. */
export class ProductApiError extends Error {
  readonly status: number;
  readonly statusText?: string;
  readonly code?: string;
  readonly details: ApiErrorDetail[];
  readonly fieldErrors: FieldErrors;

  constructor(message: string, options: ProductApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ProductApiError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.code = options.code;
    this.details = options.details ?? [];
    this.fieldErrors = options.fieldErrors ?? {};
  }
}

export function isProductApiError(error: unknown): error is ProductApiError {
  return error instanceof ProductApiError;
}

/** Human-readable request feedback without hiding the backend's safe message. */
export function productApiErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof Error && error.name === "AuthRedirectError") {
    return "Your session has expired. Redirecting to sign in.";
  }
  if (isProductApiError(error)) {
    if (error.status === 401) {
      return "Your session has expired. Please sign in again.";
    }
    if (error.status === 403) {
      return "You are not authorized to perform this action.";
    }
    if (error.status === 0 || error.code === "NETWORK_ERROR") {
      return `Network error: ${error.message}`;
    }
    if (error.status === 409) {
      return `Conflict: ${error.message}`;
    }
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizePath(value: unknown): Array<number | string> | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.split(".").filter(Boolean);
  }
  if (!Array.isArray(value)) return undefined;
  const path = value.filter(
    (part): part is number | string =>
      typeof part === "number" || typeof part === "string",
  );
  return path.length ? path : undefined;
}

function normalizeDetail(value: unknown): ApiErrorDetail | null {
  if (typeof value === "string" && value.trim()) {
    return { message: value };
  }
  if (!isRecord(value)) return null;

  const message = nonEmptyString(value.message) ?? nonEmptyString(value.msg);
  if (!message) return null;

  const path = normalizePath(value.path ?? value.loc);
  const field =
    nonEmptyString(value.field) ??
    (path?.length ? path.join(".") : undefined);

  return {
    message,
    code: nonEmptyString(value.code) ?? nonEmptyString(value.type),
    field,
    path,
    value: value.value ?? value.input,
  };
}

function collectDetails(payload: Record<string, unknown>): ApiErrorDetail[] {
  const error = isRecord(payload.error) ? payload.error : {};
  const candidates = [
    error.details,
    error.detail,
    payload.details,
    payload.detail,
    payload.errors,
  ];

  for (const candidate of candidates) {
    const values = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [];
    const details = values
      .map(normalizeDetail)
      .filter((detail): detail is ApiErrorDetail => detail !== null);
    if (details.length) return details;
  }
  return [];
}

function collectFieldErrors(
  payload: Record<string, unknown>,
  details: ApiErrorDetail[],
): FieldErrors {
  const result: FieldErrors = {};
  const error = isRecord(payload.error) ? payload.error : {};
  const raw = error.field_errors ?? error.fieldErrors ?? payload.field_errors ?? payload.fieldErrors;

  if (isRecord(raw)) {
    for (const [field, messages] of Object.entries(raw)) {
      const normalized = (Array.isArray(messages) ? messages : [messages])
        .map(nonEmptyString)
        .filter((message): message is string => Boolean(message));
      if (normalized.length) result[field] = normalized;
    }
  }

  for (const detail of details) {
    if (!detail.field) continue;
    result[detail.field] = [...(result[detail.field] ?? []), detail.message];
  }
  return result;
}

export function productApiErrorFromPayload(
  payload: unknown,
  status: number,
  statusText?: string,
): ProductApiError {
  const body = isRecord(payload) ? payload : {};
  const error = isRecord(body.error) ? body.error : {};
  const details = collectDetails(body);
  const message =
    nonEmptyString(error.message) ??
    nonEmptyString(body.message) ??
    details[0]?.message ??
    statusText ??
    `Product API request failed (${status})`;

  return new ProductApiError(message, {
    status,
    statusText,
    code: nonEmptyString(error.code) ?? nonEmptyString(body.code),
    details,
    fieldErrors: collectFieldErrors(body, details),
  });
}

export function malformedProductApiResponse(
  message: string,
  cause?: unknown,
): ProductApiError {
  return new ProductApiError(message, {
    status: 502,
    statusText: "Bad Gateway",
    code: "MALFORMED_PRODUCT_API_RESPONSE",
    cause,
  });
}
