// Server-only tournament cache utilities (requires Redis)
import { redis } from './redis';

const BRACKET_CACHE_KEY = "tournament:bracket_assignments";

export interface CachedBrackets {
    challenger: string[];
    contender: string[];
    elite: string[];
}

export async function getCachedBrackets(): Promise<CachedBrackets | null> {
    try {
        const data = await redis.get(BRACKET_CACHE_KEY);
        if (data) {
            return JSON.parse(data) as CachedBrackets;
        }
    } catch (e) {
        console.error('Error reading bracket cache:', e);
    }
    return null;
}
