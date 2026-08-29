import type { components } from '@/api/generated/schema';

type DeviceRequest = components['schemas']['DeviceRequest'];

const FINGERPRINT_VERSION = 1;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createManagementDevice(): Promise<DeviceRequest> {
  const fingerprintSource = [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    `${screen.width}x${screen.height}`,
    String(screen.colorDepth),
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprintSource));

  return {
    deviceHash: bytesToHex(new Uint8Array(digest)),
    fingerprintVersion: FINGERPRINT_VERSION,
    displayName: `管理中心 - ${navigator.platform || 'Web'}`,
    platform: navigator.platform || 'web',
    architecture: 'browser',
    appVersion: '1.0.0',
  };
}
