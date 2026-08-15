import type { ProviderErrorCode, ProviderOperation } from '@roleproof/shared';

import type { SanitizedProviderError } from './types.js';

const SAFE_MESSAGES: Record<ProviderErrorCode, string> = {
  auth: 'Provider authentication failed',
  'rate-limit': 'Provider rate limit exceeded',
  timeout: 'Provider operation timed out',
  unavailable: 'Provider is unavailable',
  refusal: 'Provider refused the operation',
  incomplete: 'Provider returned an incomplete result',
  'invalid-output': 'Provider returned invalid output',
  'budget-exceeded': 'Provider budget exceeded',
  configuration: 'Provider configuration is invalid',
};

export class ProviderError extends Error implements SanitizedProviderError {
  override readonly name = 'ProviderError';
  readonly code: ProviderErrorCode;
  readonly operation: ProviderOperation;
  readonly detail?: string;

  constructor(code: ProviderErrorCode, operation: ProviderOperation, detail?: string) {
    super(SAFE_MESSAGES[code]);
    this.code = code;
    this.operation = operation;
    if (detail !== undefined) this.detail = detail;
  }

  toJSON(): SanitizedProviderError {
    return {
      name: this.name,
      code: this.code,
      operation: this.operation,
      message: this.message,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

export const sanitizeProviderError = (
  error: unknown,
  operation: ProviderOperation,
): ProviderError => {
  if (error instanceof ProviderError) return error;
  if (typeof error === 'object' && error !== null) {
    const status =
      'status' in error && typeof error.status === 'number'
        ? error.status
        : 'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode
          : null;
    if (status === 401 || status === 403) return new ProviderError('auth', operation);
    if (status === 429) return new ProviderError('rate-limit', operation);
  }
  return new ProviderError('unavailable', operation);
};
