import { spawn } from 'node:child_process';

import {
  type LocalProviderCredentialProvider,
  type LocalProviderCredentialStatus,
} from '@roleproof/shared';

const SERVICE_NAME = 'RoleProof';
const POWERSHELL_TIMEOUT_MS = 15_000;
const windowsCredentialScript = String.raw`
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$signature = @'
using System;
using System.Runtime.InteropServices;

public static class RoleProofCredentialManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWrite([In] ref CREDENTIAL userCredential, [In] UInt32 flags);

  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);

  [DllImport("advapi32.dll", SetLastError=true)]
  public static extern void CredFree([In] IntPtr cred);
}
'@
Add-Type -TypeDefinition $signature

$generic = 1
$persistLocalMachine = 2

if ($payload.operation -eq 'get') {
  $credentialPtr = [IntPtr]::Zero
  if ([RoleProofCredentialManager]::CredRead($payload.target, $generic, 0, [ref]$credentialPtr)) {
    try {
      $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($credentialPtr, [type][RoleProofCredentialManager+CREDENTIAL])
      if ($credential.CredentialBlobSize -gt 0) {
        [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, [int]($credential.CredentialBlobSize / 2))
      }
    } finally {
      [RoleProofCredentialManager]::CredFree($credentialPtr)
    }
  }
  exit 0
}

if ($payload.operation -eq 'set') {
  $secretBytes = [Text.Encoding]::Unicode.GetBytes([string]$payload.secret)
  $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($secretBytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($secretBytes, 0, $blob, $secretBytes.Length)
    $credential = New-Object RoleProofCredentialManager+CREDENTIAL
    $credential.Type = $generic
    $credential.TargetName = $payload.target
    $credential.UserName = $payload.userName
    $credential.CredentialBlobSize = $secretBytes.Length
    $credential.CredentialBlob = $blob
    $credential.Persist = $persistLocalMachine
    if (-not [RoleProofCredentialManager]::CredWrite([ref]$credential, 0)) {
      throw "CredWrite failed"
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
  }
  exit 0
}

if ($payload.operation -eq 'delete') {
  if ([RoleProofCredentialManager]::CredDelete($payload.target, $generic, 0)) {
    'true'
  } else {
    'false'
  }
  exit 0
}

throw "Unsupported credential operation"
`;

export interface ProviderCredentialStore {
  get(provider: LocalProviderCredentialProvider): Promise<string | null>;
  set(provider: LocalProviderCredentialProvider, apiKey: string): Promise<void>;
  delete(provider: LocalProviderCredentialProvider): Promise<boolean>;
}

export type CredentialEnvironment = Partial<
  Record<'OPENAI_API_KEY' | 'ROLEPROOF_PROVIDER_API_KEY', string>
>;

export const credentialProviders: readonly LocalProviderCredentialProvider[] = Object.freeze([
  'openai',
  'openai-compatible',
]);

function accountName(provider: LocalProviderCredentialProvider): string {
  return `provider:${provider}:api-key`;
}

function targetName(provider: LocalProviderCredentialProvider): string {
  return `${SERVICE_NAME}/${accountName(provider)}`;
}

function runPowerShellCredentialCommand(payload: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        windowsCredentialScript,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Credential manager command timed out'));
    }, POWERSHELL_TIMEOUT_MS);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || 'Credential manager command failed'));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export class WindowsProviderCredentialStore implements ProviderCredentialStore {
  async get(provider: LocalProviderCredentialProvider): Promise<string | null> {
    try {
      const value = await runPowerShellCredentialCommand({
        operation: 'get',
        target: targetName(provider),
      });
      return value === '' ? null : value;
    } catch {
      return null;
    }
  }

  async set(provider: LocalProviderCredentialProvider, apiKey: string): Promise<void> {
    await runPowerShellCredentialCommand({
      operation: 'set',
      target: targetName(provider),
      userName: provider,
      secret: apiKey,
    });
  }

  async delete(provider: LocalProviderCredentialProvider): Promise<boolean> {
    return (
      (await runPowerShellCredentialCommand({
        operation: 'delete',
        target: targetName(provider),
      })) === 'true'
    );
  }
}

export class UnavailableProviderCredentialStore implements ProviderCredentialStore {
  get(): Promise<string | null> {
    return Promise.resolve(null);
  }

  set(): Promise<void> {
    return Promise.reject(new Error('OS credential manager is unavailable on this platform'));
  }

  delete(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export function createDefaultProviderCredentialStore(): ProviderCredentialStore {
  return process.platform === 'win32'
    ? new WindowsProviderCredentialStore()
    : new UnavailableProviderCredentialStore();
}

export function environmentCredential(
  provider: LocalProviderCredentialProvider,
  environment: CredentialEnvironment,
): string | null {
  const value =
    provider === 'openai' ? environment.OPENAI_API_KEY : environment.ROLEPROOF_PROVIDER_API_KEY;
  return value === undefined || value.trim() === '' ? null : value;
}

export async function resolveProviderCredential(
  provider: LocalProviderCredentialProvider,
  store: ProviderCredentialStore,
  environment: CredentialEnvironment,
): Promise<string | null> {
  return (await store.get(provider)) ?? environmentCredential(provider, environment);
}

export async function providerCredentialStatus(
  store: ProviderCredentialStore,
  environment: CredentialEnvironment,
): Promise<LocalProviderCredentialStatus[]> {
  const statuses: LocalProviderCredentialStatus[] = [];
  for (const provider of credentialProviders) {
    const stored = await store.get(provider);
    const environmentValue = environmentCredential(provider, environment);
    const source =
      stored !== null ? 'key-store' : environmentValue !== null ? 'environment' : 'none';
    statuses.push({ provider, configured: source !== 'none', source });
  }
  return statuses;
}
