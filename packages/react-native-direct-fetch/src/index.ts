import { NitroModules } from "react-native-nitro-modules";
import type {
  DirectFetch as DirectFetchSpec,
  DirectFetchDownloadRequest as NativeDirectFetchDownloadRequest,
  DirectFetchFormDataPart,
  DirectFetchDownloadResponse as NativeDirectFetchDownloadResponse,
  DirectFetchRequest as NativeDirectFetchRequest,
  DirectFetchResponse as NativeDirectFetchResponse,
  DirectFetchStreamChunk,
} from "./specs/direct-fetch.nitro";

export const DirectFetch = NitroModules.createHybridObject<DirectFetchSpec>("DirectFetch");

export interface DirectFetchHeader {
  key: string;
  value: string;
}

export type DirectFetchRequest = Omit<NativeDirectFetchRequest, "headersJson"> & {
  headers?: DirectFetchHeader[];
};

export type DirectFetchDownloadRequest = Omit<NativeDirectFetchDownloadRequest, "headersJson"> & {
  headers?: DirectFetchHeader[];
};

export type DirectFetchResponse = Omit<NativeDirectFetchResponse, "headersJson"> & {
  headers: DirectFetchHeader[];
};

export type DirectFetchDownloadResponse = Omit<NativeDirectFetchDownloadResponse, "headersJson"> & {
  headers: DirectFetchHeader[];
};

type DirectFetchInit = RequestInit & {
  timeoutMs?: number;
};

export async function dfetch(input: RequestInfo | URL, init?: DirectFetchInit): Promise<Response> {
  const request = await normalizeRequest(input, init);
  const response = await fetchDirect(request);
  return new Response(response.bodyString, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers.reduce<Record<string, string>>((headers, header) => {
      headers[header.key] = header.value;
      return headers;
    }, {}),
  });
}

export async function dfetchStream(
  input: RequestInfo | URL,
  init: DirectFetchInit | undefined,
  onChunk: (chunk: string) => void,
): Promise<Response> {
  const request = await normalizeRequest(input, init);
  const stream = (DirectFetch as Partial<DirectFetchSpec>).stream;
  if (typeof stream !== "function") {
    const response = await fetchDirect(request);
    if (response.bodyString) {
      onChunk(response.bodyString);
    }
    return directFetchResponseToFetchResponse(response);
  }

  const response = await stream.call(
    DirectFetch,
    {
      url: request.url,
      method: request.method,
      headersJson: JSON.stringify(request.headers ?? []),
      bodyString: request.bodyString,
      bodyFormData: request.bodyFormData,
      timeoutMs: request.timeoutMs,
    },
    (chunk: DirectFetchStreamChunk) => {
      if (chunk.bodyString) {
        onChunk(chunk.bodyString);
      }
    },
  );
  return directFetchResponseToFetchResponse({
    ...response,
    headers: parseHeaders(response.headersJson),
  });
}

export async function dfetchDownload(
  input: RequestInfo | URL,
  fileUri: string,
  init?: DirectFetchInit,
): Promise<DirectFetchDownloadResponse> {
  const request = await normalizeRequest(input, init);
  const response = await DirectFetch.download({
    url: request.url,
    fileUri,
    method: request.method,
    headersJson: JSON.stringify(request.headers ?? []),
    bodyString: request.bodyString,
    timeoutMs: request.timeoutMs,
  });
  return {
    ...response,
    headers: parseHeaders(response.headersJson),
  };
}

export const fetch = dfetch;

async function fetchDirect(request: DirectFetchRequest): Promise<DirectFetchResponse> {
  const response = await DirectFetch.fetch({
    url: request.url,
    method: request.method,
    headersJson: JSON.stringify(request.headers ?? []),
    bodyString: request.bodyString,
    bodyFormData: request.bodyFormData,
    timeoutMs: request.timeoutMs,
  });
  return {
    ...response,
    headers: parseHeaders(response.headersJson),
  };
}

function directFetchResponseToFetchResponse(response: DirectFetchResponse) {
  return new Response(response.bodyString, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers.reduce<Record<string, string>>((headers, header) => {
      headers[header.key] = header.value;
      return headers;
    }, {}),
  });
}

async function normalizeRequest(
  input: RequestInfo | URL,
  init?: DirectFetchInit,
): Promise<DirectFetchRequest> {
  const request = isRequest(input) ? input : undefined;
  const url = request?.url ?? input.toString();
  const method = init?.method ?? request?.method ?? "GET";
  const headers = directFetchHeaders(request?.headers, init?.headers);
  const body = await normalizeBody(init?.body ?? (request ? await request.text() : undefined));
  const requestHeaders = body?.bodyFormData
    ? headers.filter((header) => {
        const key = header.key.toLowerCase();
        return key !== "content-type" && key !== "content-length";
      })
    : headers;
  return {
    url,
    method,
    headers: requestHeaders,
    ...body,
    timeoutMs: init?.timeoutMs ?? 30000,
  };
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

async function normalizeBody(body: BodyInit | null | undefined): Promise<
  | {
      bodyString?: string;
      bodyFormData?: DirectFetchFormDataPart[];
    }
  | undefined
> {
  if (body == null) {
    return undefined;
  }
  if (typeof body === "string") {
    return { bodyString: body };
  }
  if (isFormData(body)) {
    return { bodyFormData: serializeFormData(body) };
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return { bodyString: body.toString() };
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return { bodyString: await body.text() };
  }
  if (body instanceof ArrayBuffer) {
    return { bodyString: new TextDecoder().decode(body) };
  }
  if (ArrayBuffer.isView(body)) {
    return { bodyString: new TextDecoder().decode(body) };
  }
  throw new TypeError(
    "dfetch currently supports string, URLSearchParams, Blob, FormData, and BufferSource bodies.",
  );
}

function isFormData(body: unknown): body is FormData {
  return (
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof body === "object" &&
      body !== null &&
      typeof (body as { append?: unknown }).append === "function" &&
      typeof (body as { getParts?: unknown }).getParts === "function")
  );
}

function serializeFormData(formData: FormData): DirectFetchFormDataPart[] {
  if (typeof (formData as { getParts?: unknown }).getParts === "function") {
    return (formData as unknown as { getParts: () => unknown[] })
      .getParts()
      .flatMap<DirectFetchFormDataPart>((part) => {
        if (!part || typeof part !== "object") {
          return [];
        }
        const rnPart = part as {
          fieldName?: unknown;
          fileName?: unknown;
          headers?: Record<string, unknown>;
          name?: unknown;
          string?: unknown;
          type?: unknown;
          uri?: unknown;
        };
        const fieldName = rnPart.fieldName ?? multipartDispositionValue(rnPart.headers, "name");
        const name = String(fieldName ?? "");
        if (!name) {
          return [];
        }
        if (rnPart.string !== undefined) {
          return [{ name, value: String(rnPart.string) }];
        }
        if (typeof rnPart.uri === "string") {
          const fileName =
            rnPart.fileName ?? rnPart.name ?? multipartDispositionValue(rnPart.headers, "filename");
          return [
            {
              name,
              fileUri: rnPart.uri,
              fileName: String(fileName ?? "file"),
              mimeType: String(rnPart.type ?? "application/octet-stream"),
            },
          ];
        }
        return [];
      });
  }

  const parts: DirectFetchFormDataPart[] = [];
  formData.forEach((value, name) => {
    if (typeof value === "string") {
      parts.push({ name, value });
      return;
    }
    const file = value as Blob & {
      fileName?: string;
      name?: string;
      mimeType?: string;
      type?: string;
      uri?: string;
    };
    if (typeof file.uri === "string") {
      parts.push({
        name,
        fileUri: file.uri,
        fileName: file.name ?? file.fileName ?? "file",
        mimeType: file.type ?? file.mimeType ?? "application/octet-stream",
      });
    }
  });
  return parts;
}

function multipartDispositionValue(
  headers: Record<string, unknown> | undefined,
  key: "filename" | "name",
) {
  const disposition = headers?.["content-disposition"];
  if (typeof disposition !== "string") {
    return undefined;
  }
  return new RegExp(`${key}="([^"]*)"`).exec(disposition)?.[1];
}

function directFetchHeaders(...inputs: Array<HeadersInit | undefined>): DirectFetchHeader[] {
  const headers = new Headers();
  for (const input of inputs) {
    if (!input) {
      continue;
    }
    new Headers(input).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  const result: DirectFetchHeader[] = [];
  headers.forEach((value, key) => result.push({ key, value }));
  return result;
}

function parseHeaders(headersJson: string): DirectFetchHeader[] {
  try {
    const headers = JSON.parse(headersJson);
    if (!Array.isArray(headers)) {
      return [];
    }
    return headers.flatMap((header) => {
      if (
        typeof header === "object" &&
        header !== null &&
        typeof header.key === "string" &&
        typeof header.value === "string"
      ) {
        return [{ key: header.key, value: header.value }];
      }
      return [];
    });
  } catch {
    return [];
  }
}
