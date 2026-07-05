export type ImporterStatementResult = {
  success?: boolean;
  error?: unknown;
};

export type ImporterResponsePayload = {
  ok?: boolean;
  error?: unknown;
  message?: unknown;
  results?: ImporterStatementResult[];
};

export type ImporterResponseEvaluation = {
  ok: boolean;
  payload: ImporterResponsePayload | null;
  retryable: boolean;
  errorExcerpt: string;
  failedResultCount: number;
};

export function parseImporterResponse(text: string): ImporterResponsePayload | null {
  try {
    return JSON.parse(text) as ImporterResponsePayload;
  } catch {
    return null;
  }
}

export function evaluateImporterResponse(response: {
  responseOk: boolean;
  status: number;
  text: string;
}): ImporterResponseEvaluation {
  const payload = parseImporterResponse(response.text);
  const results = Array.isArray(payload?.results) ? payload.results : null;
  const failedResultCount = results?.filter((result) => result.success !== true).length ?? 0;
  const ok = response.responseOk && payload?.ok === true && results !== null && results.length > 0 && failedResultCount === 0;

  return {
    ok,
    payload,
    retryable: response.status >= 500 || response.text.toLowerCase().includes("overload"),
    errorExcerpt: payload ? JSON.stringify(payload).slice(0, 2000) : response.text.slice(0, 2000) || "empty importer response",
    failedResultCount,
  };
}
