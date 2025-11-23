// @ts-ignore - bad-words doesn't have type definitions
import { Filter } from 'bad-words';


class ProfanityFilter {
  private filter: any;

  constructor() {
    this.filter = new Filter();

    // Add additional offensive terms not in the default list
    // This includes common slurs, hate speech, and inappropriate terms
    const additionalBadWords = [
      // Common leetspeak variants
      'n1gg3r', 'n1gga', 'f4gg0t', 'f4g',
      // Bypass attempts with special characters
      'n_igger', 'n-igger', 'f_aggot', 'f-aggot',
      // Other offensive terms that might be missed
      'nazi', 'hitler',
    ];

    this.filter.addWords(...additionalBadWords);
  }

  isClean(text: string): boolean {
    if (!text) return true;

    // Normalize the text to catch various attempts to bypass filters
    const normalized = this.normalizeText(text);

    return this.filter.isProfane(normalized) === false;
  }

  clean(text: string): string {
    if (!text) return text;

    const normalized = this.normalizeText(text);
    return this.filter.clean(normalized);
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      // Remove spaces between letters (e.g., "n i g g e r" -> "nigger")
      .replace(/\s+/g, '')
      // Remove common separators
      .replace(/[-_\.]/g, '')
      .replace(/0/g, 'o')
      .replace(/1/g, 'i')
      .replace(/3/g, 'e')
      .replace(/4/g, 'a')
      .replace(/5/g, 's')
      .replace(/7/g, 't')
      .replace(/8/g, 'b')
      .replace(/\@/g, 'a')
      .replace(/\$/g, 's')
      // Remove other special characters that might be used for obfuscation
      .replace(/[^a-z0-9]/g, '');
  }

  getRejectionMessage(): string {
    return 'Agent name contains inappropriate or offensive language. Please choose a different name.';
  }
}

// Export singleton instance
export const profanityFilter = new ProfanityFilter();

export function validateAgentName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Agent name cannot be empty' };
  }

  if (name.length > 50) {
    return { valid: false, error: 'Agent name must be 50 characters or less' };
  }

  if (name.length < 1) {
    return { valid: false, error: 'Agent name must be at least 1 character' };
  }

  if (!/^[a-zA-Z0-9_\-\s]+$/.test(name)) {
    return {
      valid: false,
      error: 'Agent name can only contain letters, numbers, spaces, underscores, and hyphens'
    };
  }

  if (!profanityFilter.isClean(name)) {
    return {
      valid: false,
      error: profanityFilter.getRejectionMessage()
    };
  }

  return { valid: true };
}
