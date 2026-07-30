import { createHash } from 'node:crypto';

import { ProviderConfigSchema, type ProviderConfig } from '@roleproof/shared';

export function providerConfigFingerprint(value: ProviderConfig): string {
  const config = ProviderConfigSchema.parse(value);
  return `provider-config-${createHash('sha256').update(JSON.stringify(config)).digest('hex')}`;
}
