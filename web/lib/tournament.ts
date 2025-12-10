export function isTournamentOverrideActive(): boolean {
    // Set to true to bypass countdown/locks for testing
    return false;
}

export function getNextTournamentDate(now: Date = new Date()): Date {
    let year = now.getUTCFullYear();
    let candidate = new Date(Date.UTC(year, 11, 12, 17, 0, 0)); // Dec 12, 17:00 GMT
    const keepThrough = new Date(candidate.getTime() + 24 * 60 * 60 * 1000); // keep current-year window for full day

    if (keepThrough.getTime() <= now.getTime()) {
        year += 1;
        candidate = new Date(Date.UTC(year, 11, 12, 17, 0, 0));
    }

    return candidate;
}

export function getTournamentSchedule(now: Date = new Date()) {
    const startTime = getNextTournamentDate(now);
    const lockStart = new Date(startTime.getTime() - 30 * 60 * 1000); // 30m before start
    const announceTime = startTime; // 17:00 GMT: brackets announced
    const streamStart = new Date(startTime.getTime() + 5 * 60 * 1000); // 17:10 GMT: first games
    const endTime = new Date(startTime.getTime() + 6000 * 60 * 60 * 1000); // buffer for full run/results

    return { startTime, lockStart, announceTime, streamStart, endTime };
}

export function isTournamentLockActive(now: Date = new Date()): boolean {
    // Lock is based on actual time, not override
    const { lockStart, endTime } = getTournamentSchedule(now);
    return now.getTime() >= lockStart.getTime() && now.getTime() <= endTime.getTime();
}
