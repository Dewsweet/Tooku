export const minimumNodeVersion: string;
export function parseNodeVersion(input: string): number[] | undefined;
export function supportsNodeVersion(input: string): boolean;
export function assertSupportedNodeVersion(input?: string): void;
