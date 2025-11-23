/**
 * Upload Code Generator
 * Generates a 6-character code that rotates every 30 minutes
 * Uses server secret and timestamp to generate deterministic codes
 */

import crypto from 'crypto';

const CODE_LENGTH = 6;
const ROTATION_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excludes confusing chars: 0,O,1,I

/**
 * Get the current time slot (30-minute intervals)
 */
function getCurrentTimeSlot(): number {
  return Math.floor(Date.now() / ROTATION_INTERVAL_MS);
}

/**
 * Generate upload code for a specific time slot
 */
function generateCodeForSlot(slot: number, secret: string): string {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(slot.toString())
    .digest('hex');

  // Convert hash to 6-character code
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    // Use different parts of the hash for each character
    const byte = parseInt(hash.substr(i * 8, 8), 16);
    code += CHARACTERS[byte % CHARACTERS.length];
  }

  return code;
}

/**
 * Get the current valid upload code
 */
export function getCurrentUploadCode(): string {
  const secret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'dev_secret';
  const currentSlot = getCurrentTimeSlot();
  return generateCodeForSlot(currentSlot, secret);
}

/**
 * Validate an upload code
 * Accepts current code and previous code (for 30-min grace period during rotation)
 */
export function validateUploadCode(providedCode: string): boolean {
  if (!providedCode) return false;

  const normalizedProvided = providedCode.toUpperCase().replace(/\s/g, '');

  const secret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'dev_secret';
  const currentSlot = getCurrentTimeSlot();

  const currentCode = generateCodeForSlot(currentSlot, secret);
  if (normalizedProvided === currentCode) {
    return true;
  }

  const previousCode = generateCodeForSlot(currentSlot - 1, secret);
  if (normalizedProvided === previousCode) {
    return true;
  }

  return false;
}

/**
 * Get time until next code rotation (in seconds)
 */
export function getTimeUntilRotation(): number {
  const now = Date.now();
  const currentSlot = getCurrentTimeSlot();
  const nextRotation = (currentSlot + 1) * ROTATION_INTERVAL_MS;
  return Math.floor((nextRotation - now) / 1000);
}

/**
 * Get formatted code with separators for display (e.g., "ABC-123")
 */
export function getFormattedUploadCode(): string {
  const code = getCurrentUploadCode();
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
