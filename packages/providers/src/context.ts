import type { ProviderCallContext } from './types.js';

import { ProviderError } from './errors.js';

const trustedContexts = new WeakSet<object>();

export function trustProviderCallContext<T>(
  context: ProviderCallContext<T>,
): ProviderCallContext<T> {
  trustedContexts.add(context);
  return context;
}

export function assertTrustedProviderCallContext(context: ProviderCallContext<unknown>): void {
  if (!trustedContexts.has(context)) {
    throw new ProviderError('configuration', 'analyze-requirements');
  }
}
