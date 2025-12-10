'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';
import TournamentLiveViewer from '@/components/TournamentLiveViewer';
import SwissRoundView from '@/components/SwissRoundView';
import LeaderboardTable, { LeaderboardEntry } from '@/components/LeaderboardTable';
import { Swords, Clock3, Timer, Sparkles, Activity, AlertTriangle, Trophy } from 'lucide-react';
import { getTournamentSchedule, isTournamentOverrideActive } from '@/lib/tournament';

type BracketId = 'challenger' | 'contender' | 'elite';

interface BracketAgent {
    id: string;
    name: string;
    version: number;
    eloRating: number;
    gamesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
}

interface TournamentBracket {
    id: BracketId;
    label: string;
    percentLabel: string;
    description: string;
    agents: BracketAgent[];
    eloRange: { min: number; max: number } | null;
}

interface TournamentStatus {
    challenger: { pending: number; in_progress: number; completed: number; agents: number; currentRound: number; totalRounds: number; tournamentStatus: string };
    contender: { pending: number; in_progress: number; completed: number; agents: number; currentRound: number; totalRounds: number; tournamentStatus: string };
    elite: { pending: number; in_progress: number; completed: number; agents: number; currentRound: number; totalRounds: number; tournamentStatus: string };
}

interface TournamentStatusResponse {
    success: boolean;
    status: TournamentStatus;
    totalAgents: number;
    tournamentComplete: boolean;
}

interface CountdownState {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    completed: boolean;
}

const calculateTimeLeft = (target: Date): CountdownState => {
    const diff = target.getTime() - Date.now();
    if (diff <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, completed: true };
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    return { days, hours, minutes, seconds, completed: false };
};

const BRACKET_COLORS: Record<BracketId, string> = {
    challenger: 'from-blue-500/30 to-purple-600/30',
    contender: 'from-emerald-500/30 to-blue-500/30',
    elite: 'from-amber-400/40 to-pink-500/30',
};

const BRACKET_BORDER_COLORS: Record<BracketId, string> = {
    challenger: 'border-blue-500/40',
    contender: 'border-emerald-500/40',
    elite: 'border-amber-500/40',
};

export default function TournamentPage() {
    const tournamentNowFlag = isTournamentOverrideActive();
    const schedule = useMemo(() => getTournamentSchedule(), []);
    const [now, setNow] = useState<Date>(new Date());
    const [countdown, setCountdown] = useState<CountdownState>(() => calculateTimeLeft(schedule.startTime));
    const [brackets, setBrackets] = useState<TournamentBracket[]>([]);
    const [tournamentStatus, setTournamentStatus] = useState<TournamentStatus | null>(null);
    const [tournamentComplete, setTournamentComplete] = useState(false);
    const [activeBracket, setActiveBracket] = useState<BracketId>('challenger');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const bracketsRequestedRef = useRef(false);

    // Show countdown until startTime (even if override/lock is active)
    // Only show tournament content after countdown completes
    const beforeStart = now.getTime() < schedule.startTime.getTime();
    const showCountdownOnly = beforeStart;

    // Check if bracket is complete (tournament status is completed)
    const isBracketComplete = useCallback((bracketId: BracketId) => {
        if (!tournamentStatus) return false;
        const status = tournamentStatus[bracketId];
        return status && status.tournamentStatus === 'completed';
    }, [tournamentStatus]);

    const fetchBrackets = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);
            const res = await fetch('/api/tournament/brackets');
            const data = await res.json();

            if (data.success && data.brackets) {
                setBrackets(data.brackets);
                // Set first available bracket as active
                if (data.brackets.length > 0 && !data.brackets.find((b: TournamentBracket) => b.id === activeBracket)) {
                    setActiveBracket(data.brackets[0].id);
                }
            } else {
                setError('Failed to load tournament brackets');
            }
        } catch (err) {
            console.error('Error fetching brackets:', err);
            setError('Failed to load tournament brackets');
        } finally {
            setIsLoading(false);
        }
    }, [activeBracket]);

    const fetchTournamentStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/tournament/status');
            const data: TournamentStatusResponse = await res.json();
            if (data.success && data.status) {
                setTournamentStatus(data.status);
                setTournamentComplete(data.tournamentComplete ?? false);
            }
        } catch (err) {
            console.error('Error fetching tournament status:', err);
        }
    }, []);

    useEffect(() => {
        const tick = () => {
            const current = new Date();
            setNow(current);
            // Always show real countdown - don't bypass even if override is active
            setCountdown(calculateTimeLeft(schedule.startTime));
        };

        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [schedule.startTime]);

    useEffect(() => {
        if (bracketsRequestedRef.current) return;
        if (showCountdownOnly) return;
        bracketsRequestedRef.current = true;
        fetchBrackets();
        fetchTournamentStatus();
    }, [fetchBrackets, fetchTournamentStatus, showCountdownOnly]);

    // Refresh brackets and status periodically
    useEffect(() => {
        if (showCountdownOnly) return;
        const interval = setInterval(() => {
            fetchBrackets();
            fetchTournamentStatus();
        }, 30000);
        return () => clearInterval(interval);
    }, [fetchBrackets, fetchTournamentStatus, showCountdownOnly]);

    const activeBracketData = brackets.find((b) => b.id === activeBracket);

    const formatUtcDate = (date: Date) =>
        date.toLocaleString('en-GB', {
            timeZone: 'UTC',
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

    // Countdown-only view (before tournament start time)
    if (showCountdownOnly) {
        return (
            <div className="min-h-screen relative">
                <AnimatedBackground />
                <div className="relative z-10">
                    <Navigation />
                    <div className="flex items-center justify-center px-4 py-16 min-h-[calc(100vh-64px)]">
                        <div className="text-center px-4 max-w-3xl">
                            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
                                Tournament <span className="text-purple-400">Begins Soon</span>
                            </h1>

                            <p className="text-lg sm:text-xl text-gray-400 max-w-xl mx-auto mb-8">
                                Coursework is wrapping up. The platform will end with a final tournament kickoff shown below. Thank you for competing.
                            </p>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 max-w-2xl mx-auto">
                                {['Days', 'Hours', 'Minutes', 'Seconds'].map((label, idx) => {
                                    const values = [countdown.days, countdown.hours, countdown.minutes, countdown.seconds];
                                    return (
                                        <div key={label} className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-4 sm:p-6 text-center">
                                            <div className="text-3xl sm:text-4xl font-bold text-white">
                                                {countdown.completed ? 0 : values[idx].toString().padStart(2, '0')}
                                            </div>
                                            <div className="text-xs sm:text-sm text-gray-400 uppercase tracking-wide mt-1">{label}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen relative">
            <AnimatedBackground />
            <div className="relative z-10">
                <Navigation />

                <div className="container mx-auto px-4 py-8 space-y-6">
                    {/* Tournament Complete Banner */}
                    {tournamentComplete && (
                        <div className="bg-gradient-to-r from-yellow-900/40 to-amber-900/40 backdrop-blur border border-yellow-500/40 rounded-2xl p-6 text-center">
                            <Trophy className="w-12 h-12 text-yellow-400 mx-auto mb-3" />
                            <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">Tournament Complete</h2>
                            <p className="text-yellow-200/80">
                                All matches have concluded. Final standings are shown below. Thank you for participating!
                            </p>
                        </div>
                    )}

                    {/* Header */}
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-200">
                                <Swords className="w-7 h-7" />
                            </div>
                            <div>
                                <h1 className="text-3xl md:text-4xl font-bold text-white">Tournament</h1>
                                <p className="text-gray-400 text-sm mt-1">
                                    {tournamentComplete
                                        ? 'The tournament has concluded. View the final standings below.'
                                        : 'Analytics have ended. This platform is commencing its conclusion with a large scale tournament.'
                                    }
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Status Bar - Only show countdown if not live */}
                    {!tournamentNowFlag && !countdown.completed && (
                        <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-2xl p-6 shadow-xl shadow-purple-900/30">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 text-purple-200">
                                        <Clock3 className="w-5 h-5" />
                                        <span className="text-sm uppercase tracking-wide">Tournament Date (GMT)</span>
                                    </div>
                                    <h2 className="text-xl md:text-2xl font-semibold text-white mt-1">
                                        {formatUtcDate(schedule.startTime)} GMT
                                    </h2>
                                </div>

                                <div className="grid grid-cols-4 gap-2">
                                    {['Days', 'Hours', 'Minutes', 'Seconds'].map((label, idx) => {
                                        const values = [countdown.days, countdown.hours, countdown.minutes, countdown.seconds];
                                        return (
                                            <div key={label} className="bg-gray-800/60 border border-purple-500/10 rounded-lg p-2 text-center">
                                                <div className="text-xl md:text-2xl font-bold text-white">
                                                    {values[idx].toString().padStart(2, '0')}
                                                </div>
                                                <div className="text-xs text-gray-400 uppercase">{label.slice(0, 3)}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="mt-4 flex items-center gap-2 text-gray-300 text-sm">
                                <Timer className="w-4 h-4 text-purple-300" />
                                <span>Countdown targets Friday 12 December, 17:00 GMT. Brackets will unlock at kickoff.</span>
                            </div>
                        </div>
                    )}

                    {/* Bracket Tabs */}
                    {brackets.length === 0 && !isLoading ? (
                        <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-2xl p-8 text-center">
                            <AlertTriangle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">No Brackets Available</h3>
                            <p className="text-gray-400">
                                {error || 'There are not enough agents with games played to form tournament brackets yet.'}
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Bracket Selection Tabs */}
                            <div className="flex flex-wrap gap-2">
                                {brackets.map((bracket) => {
                                    const bracketStatus = tournamentStatus?.[bracket.id];
                                    return (
                                        <button
                                            key={bracket.id}
                                            onClick={() => setActiveBracket(bracket.id)}
                                            className={`flex-1 min-w-[150px] p-4 rounded-xl border transition-all ${activeBracket === bracket.id
                                                    ? `bg-gradient-to-br ${BRACKET_COLORS[bracket.id]} ${BRACKET_BORDER_COLORS[bracket.id]} border-2`
                                                    : 'bg-gray-800/50 border-purple-500/20 hover:border-purple-500/40'
                                                }`}
                                        >
                                            <div className="text-xs uppercase text-purple-200">{bracket.percentLabel}</div>
                                            <div className="text-lg font-semibold text-white">{bracket.label}</div>
                                            <div className="text-sm text-gray-400 mt-1">{bracket.agents.length} agents</div>
                                            {bracketStatus && bracketStatus.totalRounds > 0 && (
                                                <div className="text-xs text-purple-300 mt-1">
                                                    Round {bracketStatus.currentRound}/{bracketStatus.totalRounds}
                                                    {bracketStatus.tournamentStatus === 'completed' && (
                                                        <span className="ml-2 text-green-400">Complete</span>
                                                    )}
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Active Bracket Content */}
                            {activeBracketData && (
                                <div className="grid lg:grid-cols-2 gap-6">
                                    {/* Left: Live Game Viewer OR Final Results */}
                                    <div>
                                        {isBracketComplete(activeBracketData.id) ? (
                                            <>
                                                <div className="flex items-center gap-2 mb-4">
                                                    <Trophy className="w-5 h-5 text-yellow-400" />
                                                    <h2 className="text-xl font-semibold text-white">Final Results</h2>
                                                </div>
                                                <div className="bg-gray-900/60 backdrop-blur border border-yellow-500/30 rounded-xl p-4">
                                                    <div className="text-center mb-4">
                                                        <span className="px-3 py-1 rounded-full bg-yellow-600/20 text-yellow-200 border border-yellow-500/40 text-sm">
                                                            BRACKET COMPLETE
                                                        </span>
                                                    </div>
                                                    <LeaderboardTable
                                                        entries={[...activeBracketData.agents]
                                                            .sort((a, b) => b.eloRating - a.eloRating)
                                                            .map((agent, idx): LeaderboardEntry => ({
                                                                rank: idx + 1,
                                                                agentId: agent.id,
                                                                agentName: agent.name,
                                                                version: agent.version,
                                                                eloRating: agent.eloRating,
                                                                gamesPlayed: agent.gamesPlayed,
                                                                wins: agent.wins,
                                                                losses: agent.losses,
                                                                draws: agent.draws,
                                                                winPercentage: agent.gamesPlayed > 0
                                                                    ? ((agent.wins / agent.gamesPlayed) * 100).toFixed(1)
                                                                    : '0.0',
                                                                avgMoveTimeMs: null,
                                                            }))}
                                                        showPodium={true}
                                                        compact={true}
                                                    />
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-2 mb-4">
                                                    <Activity className="w-5 h-5 text-purple-400" />
                                                    <h2 className="text-xl font-semibold text-white">Live Stream</h2>
                                                </div>
                                                <TournamentLiveViewer
                                                    bracketId={activeBracketData.id}
                                                    bracketLabel={activeBracketData.label}
                                                />
                                            </>
                                        )}
                                    </div>

                                    {/* Right: Swiss Round View / Standings */}
                                    <div>
                                        <div className="flex items-center gap-2 mb-4">
                                            <Sparkles className="w-5 h-5 text-purple-400" />
                                            <h2 className="text-xl font-semibold text-white">{activeBracketData.label}</h2>
                                        </div>
                                        <SwissRoundView
                                            bracketId={activeBracketData.id}
                                            agents={activeBracketData.agents}
                                            eloRange={activeBracketData.eloRange}
                                        />
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                </div>
            </div>
        </div>
    );
}
