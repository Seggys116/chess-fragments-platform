'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2, Trophy, Zap, Clock, Target, Activity, TrendingUp, TrendingDown, Shield, ChartBar, Eye, Code, Power, Upload, Download, Edit2, AlertTriangle } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';
import { isTournamentLockActive } from '@/lib/tournament';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface AgentRanking {
    eloRating: number;
    gamesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
    avgMoveTimeMs: number | null;
    globalRank: number | null;
}

interface Agent {
    id: string;
    name: string;
    version: number;
    active: boolean;
    executionMode: string;
    createdAt: string;
    codeHash: string;
    ranking: AgentRanking | null;
    lastMatchAt: string | null;
    connectionStatus: string;
    lastHeartbeat: string | null;
}

interface UploadHistoryEntry {
    id: string;
    uploadedAt: string;
    success: boolean;
    errorMessage: string | null;
    codeHash: string | null;
}

export default function DashboardPage() {
    const [now, setNow] = useState<Date>(new Date());
    const tournamentLocked = useMemo(() => isTournamentLockActive(now), [now]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [history, setHistory] = useState<UploadHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [updateCodeModalOpen, setUpdateCodeModalOpen] = useState(false);
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [watchPlayLoading, setWatchPlayLoading] = useState<string | null>(null);
    const [opponentSelectModalOpen, setOpponentSelectModalOpen] = useState(false);
    const [selectedAgentForMatch, setSelectedAgentForMatch] = useState<string | null>(null);
    const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
    const [deleteConfirmStep, setDeleteConfirmStep] = useState<string | null>(null); // agentId when in "really sure?" step
    const [deactivatingOlderVersions, setDeactivatingOlderVersions] = useState(false);
    const [autoDeactivatedCount, setAutoDeactivatedCount] = useState(0);
    const [hasCheckedExcessVersions, setHasCheckedExcessVersions] = useState(false);
    const [concurrencyWarning, setConcurrencyWarning] = useState('');
    const [activeLimitWarning, setActiveLimitWarning] = useState('');
    const router = useRouter();

    const isConcurrencyError = (message: string | undefined) => {
        if (!message) return false;
        return /multiprocess|multithread/i.test(message);
    };

    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 30000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (tournamentLocked) {
            setLoading(false);
            return;
        }

        const accessCode = localStorage.getItem('fragmentarena_code');
        if (!accessCode) {
            router.push('/start');
            return;
        }

        fetchDashboardData();
    }, [router, tournamentLocked]);

    const fetchDashboardData = async () => {
        if (tournamentLocked) return;
        try {
            const [agentsRes, historyRes] = await Promise.all([
                authenticatedFetch('/api/dashboard/agents'),
                authenticatedFetch('/api/dashboard/history'),
            ]);

            if (!agentsRes.ok || !historyRes.ok) {
                throw new Error('Failed to fetch dashboard data');
            }

            const agentsData = await agentsRes.json();
            const historyData = await historyRes.json();

            setAgents(agentsData.agents);
            setHistory(historyData.history);

            const nextActiveCount = (agentsData.agents as Agent[]).filter((a) => a.active).length;
            if (nextActiveCount > 2) {
                setActiveLimitWarning(
                    `You have ${nextActiveCount} active agents. Only two can stay active to keep server load fair; turning on another will auto-switch off older ones.`
                );
            } else if (nextActiveCount > 1) {
                setActiveLimitWarning(
                    `Active agents are capped at two per user to keep demand fair. You currently have ${nextActiveCount} active agents.`
                );
            } else {
                setActiveLimitWarning('');
            }

            setError('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const toggleAgentActive = async (agentId: string, currentlyActive: boolean) => {
        try {
            const response = await authenticatedFetch(`/api/dashboard/agents/${agentId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ active: !currentlyActive }),
            });

            if (!response.ok) {
                let errorMessage = 'Failed to update agent';
                try {
                    const data = await response.json();
                    errorMessage = data.error || errorMessage;
                    if (isConcurrencyError(errorMessage)) {
                        setConcurrencyWarning('You are not allowed to multithread your agent as threads are used to allow for multiple games to be played at once not to be used on one agent.');
                    }
                } catch {
                    // Ignore JSON parse errors
                }

                throw new Error(errorMessage);
            }

            setConcurrencyWarning('');
            await fetchDashboardData();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An error occurred';
            if (isConcurrencyError(message)) {
                setConcurrencyWarning('You are not allowed to multithread your agent as threads are used to allow for multiple games to be played at once not to be used on one agent.');
            }
            alert(message);
        }
    };

    const deleteAgent = async (agentId: string) => {
        try {
            const response = await authenticatedFetch(`/api/dashboard/agents/${agentId}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to delete agent');
            }

            await fetchDashboardData();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    const handleWatchPlay = (agentId: string) => {
        // If user has multiple agents, show opponent selection modal
        if (agents.filter(a => a.active).length > 1) {
            setSelectedAgentForMatch(agentId);
            setOpponentSelectModalOpen(true);
        } else {
            // Only one agent, match against random opponent
            startExhibitionMatch(agentId, undefined);
        }
    };

    const startExhibitionMatch = async (agentId: string, opponentId: string | undefined) => {
        setWatchPlayLoading(agentId);
        setOpponentSelectModalOpen(false);

        try {
            const response = await fetch('/api/matches/exhibition', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-access-code': localStorage.getItem('fragmentarena_code') || '',
                },
                body: JSON.stringify({ agentId, opponentId }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to create exhibition match');
            }

            const data = await response.json();
            // Navigate to the match viewer
            router.push(`/match/${data.match.id}`);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setWatchPlayLoading(null);
            setSelectedAgentForMatch(null);
        }
    };

    const handleUpdateCode = (agentId: string) => {
        setSelectedAgentId(agentId);
        setUpdateCodeModalOpen(true);
    };

    const startEditingName = (agentId: string, currentName: string) => {
        setEditingAgentId(agentId);
        setEditingName(currentName);
    };

    const cancelEditingName = () => {
        setEditingAgentId(null);
        setEditingName('');
    };

    const saveAgentName = async (agentId: string) => {
        if (!editingName.trim()) {
            alert('Agent name cannot be empty');
            return;
        }

        try {
            const response = await authenticatedFetch(`/api/dashboard/agents/${agentId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: editingName.trim() }),
            });

            if (!response.ok) {
                throw new Error('Failed to update agent name');
            }

            setEditingAgentId(null);
            setEditingName('');
            await fetchDashboardData();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    const getWinRate = (agent: Agent) => {
        if (!agent.ranking || agent.ranking.gamesPlayed === 0) return 0;
        return ((agent.ranking.wins / agent.ranking.gamesPlayed) * 100).toFixed(1);
    };

    const toggleVersionHistory = (agentName: string) => {
        setExpandedAgents(prev => {
            const newSet = new Set(prev);
            if (newSet.has(agentName)) {
                newSet.delete(agentName);
            } else {
                newSet.add(agentName);
            }
            return newSet;
        });
    };

    // Deactivate all older versions of agents (keep only the latest active version per name)
    const deactivateOlderVersions = async () => {
        setDeactivatingOlderVersions(true);
        try {
            const response = await authenticatedFetch('/api/dashboard/agents/deactivate-older', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error('Failed to deactivate older versions');
            }

            await fetchDashboardData();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setDeactivatingOlderVersions(false);
        }
    };

    // Auto-deactivate excess versions (more than 3 active of same agent)
    const autoDeactivateExcessVersions = async (agentGroups: Record<string, Agent[]>) => {
        const agentsToDeactivate: string[] = [];

        for (const [name, versions] of Object.entries(agentGroups)) {
            const activeVersions = versions.filter(a => a.active).sort((a, b) => b.version - a.version);
            if (activeVersions.length > 3) {
                // Keep top 3, deactivate the rest
                const excessVersions = activeVersions.slice(3);
                agentsToDeactivate.push(...excessVersions.map(a => a.id));
            }
        }

        if (agentsToDeactivate.length > 0) {
            try {
                const response = await authenticatedFetch('/api/dashboard/agents/deactivate-bulk', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ agentIds: agentsToDeactivate }),
                });

                if (response.ok) {
                    setAutoDeactivatedCount(agentsToDeactivate.length);
                    await fetchDashboardData();
                }
            } catch (err) {
                console.error('Failed to auto-deactivate excess versions:', err);
            }
        }
    };

    // Group agents by name, sorted by version descending
    const groupedAgents = agents.reduce((acc, agent) => {
        if (!acc[agent.name]) {
            acc[agent.name] = [];
        }
        acc[agent.name].push(agent);
        return acc;
    }, {} as Record<string, Agent[]>);

    // Sort versions within each group (highest version first)
    Object.keys(groupedAgents).forEach(name => {
        groupedAgents[name].sort((a, b) => b.version - a.version);
    });

    const activeAgents = agents.filter(a => a.active);
    const activeAgentCount = activeAgents.length;
    const hasExcessActiveAgents = activeAgentCount > 2;

    // Check if any agent group has more than 3 active versions (for auto-deactivation)
    const hasExcessActiveVersions = Object.entries(groupedAgents).some(([name, versions]) => {
        const activeCount = versions.filter(a => a.active).length;
        return activeCount > 3;
    });

    // Auto-deactivate excess versions on load (only once)
    useEffect(() => {
        if (!loading && hasExcessActiveVersions && !hasCheckedExcessVersions) {
            setHasCheckedExcessVersions(true);
            autoDeactivateExcessVersions(groupedAgents);
        }
    }, [loading, hasExcessActiveVersions, hasCheckedExcessVersions]);

    if (tournamentLocked) {
        return (
            <div className="min-h-screen relative">
                <AnimatedBackground />
                <div className="relative z-10">
                    <Navigation />
                    <div className="container mx-auto px-4 py-12">
                        <div className="bg-gray-900/70 border border-purple-500/30 rounded-2xl p-8 shadow-xl shadow-purple-900/30 max-w-3xl mx-auto text-center">
                            <div className="inline-flex items-center justify-center p-3 rounded-full bg-purple-600/20 border border-purple-500/40 mb-4">
                                <Shield className="w-6 h-6 text-purple-200" />
                            </div>
                            <h1 className="text-3xl font-bold text-white mb-3">Tournament Focus Mode</h1>
                            <p className="text-gray-300 mb-4">Dashboard actions are locked while tournaments run (lock begins 30 minutes before kickoff). Executions and management are paused.</p>
                            <p className="text-gray-400 mb-6">Leaderboard stays live; follow the brackets in the Tournament tab.</p>
                            <div className="flex flex-col sm:flex-row gap-3 justify-center">
                                <Link
                                    href="/tournament"
                                    className="px-5 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-lg shadow-purple-500/30"
                                >
                                    Go to Tournament
                                </Link>
                                <Link
                                    href="/leaderboard"
                                    className="px-5 py-3 rounded-lg bg-gray-800 border border-purple-500/30 text-white font-semibold hover:bg-gray-700"
                                >
                                    View Leaderboard
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-screen relative flex items-center justify-center">
                <AnimatedBackground />
                <div className="relative z-10 text-center text-gray-400 py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
                    Loading dashboard...
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen relative">
            <AnimatedBackground />
            <div className="relative z-10">
                <Navigation />
                <div className="container mx-auto py-4 sm:py-8 max-w-7xl px-4">
                    {/* Header */}
                    <div className="mb-6 sm:mb-8 text-center">
                        <div className="inline-flex items-center gap-2 sm:gap-3 mb-4">
                            <Shield className="w-8 sm:w-10 h-8 sm:h-10 text-purple-400" />
                            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white">Agent Command Center</h1>
                            <Shield className="w-8 sm:w-10 h-8 sm:h-10 text-purple-400" />
                        </div>
                        <p className="text-gray-400 text-base sm:text-lg">Deploy, manage, and monitor your AI chess warriors</p>
                    </div>

                    {error && (
                        <div className="mb-6 bg-red-900/50 backdrop-blur border border-red-600/50 rounded-lg p-4">
                            <p className="text-red-200">{error}</p>
                        </div>
                    )}

                    {concurrencyWarning && (
                        <div className="mb-6 bg-amber-900/40 backdrop-blur border border-amber-500/40 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
                                <p className="text-amber-100 text-sm">{concurrencyWarning}</p>
                            </div>
                        </div>
                    )}

                    {activeLimitWarning && (
                        <div className="mb-6 bg-amber-900/50 backdrop-blur border border-amber-500/50 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
                                <p className="text-amber-100 text-sm leading-relaxed">{activeLimitWarning}</p>
                            </div>
                        </div>
                    )}

                    {/* Auto-deactivation notification */}
                    {autoDeactivatedCount > 0 && (
                        <div className="mb-6 bg-blue-900/50 backdrop-blur border border-blue-500/50 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-blue-200">
                                        <span className="font-semibold">{autoDeactivatedCount} older agent version{autoDeactivatedCount > 1 ? 's were' : ' was'} automatically deactivated.</span>
                                        {' '}Only 3 versions of the same agent can be active at a time.
                                    </p>
                                </div>
                                <button
                                    onClick={() => setAutoDeactivatedCount(0)}
                                    className="text-blue-400 hover:text-blue-300 ml-auto"
                                >
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Warning for too many active agents */}
                    {hasExcessActiveAgents && (
                        <div className="mb-6 bg-amber-900/50 backdrop-blur border border-amber-500/50 rounded-lg p-4">
                            <div className="flex flex-col sm:flex-row items-start gap-4">
                                <div className="flex items-start gap-3 flex-1">
                                    <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-amber-200 font-semibold mb-1">Too Many Active Agents</p>
                                        <p className="text-amber-300/80 text-sm">
                                            Only two agents can be active per user to keep server demand fair for everyone. Activating more will auto-deactivate older ones, so keep just the newest two you actually need.
                                        </p>
                                        <p className="text-amber-400/70 text-xs mt-2">
                                            Active agents: {activeAgents.map((a) => `${a.name} v${a.version}`).join(', ')}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={deactivateOlderVersions}
                                    disabled={deactivatingOlderVersions}
                                    className="bg-amber-600/80 hover:bg-amber-500/80 disabled:bg-amber-800/50 text-white px-4 py-2 rounded-lg font-semibold transition-all text-sm whitespace-nowrap flex items-center gap-2 shadow-lg shadow-amber-500/20"
                                >
                                    {deactivatingOlderVersions ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                            Deactivating...
                                        </>
                                    ) : (
                                        <>
                                            <Power className="w-4 h-4" />
                                            Keep Only Latest Versions
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* My Agents Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-2 mb-6">
                            <Trophy className="w-6 h-6 text-purple-400" />
                            <h2 className="text-3xl font-bold text-white">Battle-Ready Agents</h2>
                        </div>
                        {agents.length === 0 ? (
                            <div className="bg-gray-800/50 backdrop-blur border border-purple-500/20 rounded-xl p-8 text-center shadow-lg shadow-purple-500/10">
                                <Shield className="w-16 h-16 text-purple-400 mx-auto mb-4 opacity-50" />
                                <p className="text-gray-400 mb-4 text-lg">No agents deployed yet. Begin your conquest!</p>
                                <Link
                                    href="/upload"
                                    className="inline-block bg-purple-600/80 backdrop-blur hover:bg-purple-700/80 text-white px-6 py-3 rounded-lg font-semibold transition-all shadow-lg shadow-purple-500/20"
                                >
                                    Deploy Your First Agent
                                </Link>
                            </div>
                        ) : (
                            <div className="grid gap-6">
                                {Object.entries(groupedAgents).map(([agentName, versions]) => {
                                    const latestVersion = versions[0];
                                    const isExpanded = expandedAgents.has(agentName);
                                    const hasMultipleVersions = versions.length > 1;

                                    return (
                                        <div key={agentName} className="space-y-3">
                                            {/* Latest/Main Version */}
                                            {versions.filter((_, idx) => idx === 0 || isExpanded).map((agent, versionIndex) => (
                                                <div
                                                    key={agent.id}
                                                    className={`bg-gray-900/50 backdrop-blur border rounded-xl p-6 shadow-lg transition-all duration-300 ${versionIndex === 0
                                                            ? 'border-purple-500/20 hover:shadow-xl hover:shadow-purple-500/20'
                                                            : 'border-purple-500/10 bg-gray-900/30 ml-8'
                                                        }`}
                                                >
                                                    <div className="flex flex-col gap-4 mb-4">
                                                        <div>
                                                            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                                                {editingAgentId === agent.id ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <input
                                                                            type="text"
                                                                            value={editingName}
                                                                            onChange={(e) => setEditingName(e.target.value)}
                                                                            className="text-xl sm:text-2xl font-bold bg-gray-800 text-white px-3 py-1 rounded border border-purple-500 focus:outline-none focus:border-purple-400"
                                                                            autoFocus
                                                                        />
                                                                        <button
                                                                            onClick={() => saveAgentName(agent.id)}
                                                                            className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm"
                                                                        >
                                                                            Save
                                                                        </button>
                                                                        <button
                                                                            onClick={cancelEditingName}
                                                                            className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded text-sm"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-2">
                                                                        <h3 className="text-xl sm:text-2xl font-bold text-white">{agent.name}</h3>
                                                                        {versionIndex === 0 && (
                                                                            <button
                                                                                onClick={() => startEditingName(agent.id, agent.name)}
                                                                                className="text-gray-400 hover:text-purple-400 transition-colors"
                                                                                title="Edit name"
                                                                            >
                                                                                <Edit2 className="w-4 h-4" />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                <span className={`text-sm font-semibold ${versionIndex === 0 ? 'text-purple-400' : 'text-gray-400'}`}>
                                                                    v{agent.version}
                                                                    {versionIndex > 0 && ' (older)'}
                                                                </span>
                                                                {agent.executionMode === 'local' ? (
                                                                    <span
                                                                        className={`px-3 py-1 rounded-full text-xs font-semibold ${agent.active && agent.connectionStatus === 'connected'
                                                                                ? 'bg-green-900/50 text-green-300 border border-green-500/30 animate-pulse'
                                                                                : agent.active
                                                                                    ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-500/30'
                                                                                    : 'bg-gray-800/50 text-gray-400 border border-gray-600/30'
                                                                            }`}
                                                                    >
                                                                        {agent.active && agent.connectionStatus === 'connected' ? 'CONNECTED' : agent.active ? 'OFFLINE' : 'INACTIVE'}
                                                                    </span>
                                                                ) : (
                                                                    <span
                                                                        className={`px-3 py-1 rounded-full text-xs font-semibold ${agent.active
                                                                                ? 'bg-green-900/50 text-green-300 border border-green-500/30 animate-pulse'
                                                                                : 'bg-gray-800/50 text-gray-400 border border-gray-600/30'
                                                                            }`}
                                                                    >
                                                                        {agent.active ? 'ONLINE' : 'OFFLINE'}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-gray-400 text-sm mt-1">
                                                                <Clock className="w-3 h-3 inline mr-1" />
                                                                Deployed {new Date(agent.createdAt).toLocaleDateString()}
                                                            </p>
                                                        </div>
                                                        <div className="flex gap-2 flex-wrap justify-start sm:justify-end">
                                                            <Link
                                                                href={`/agent/${agent.id}`}
                                                                className="bg-gradient-to-r from-yellow-600/80 to-orange-600/80 backdrop-blur hover:from-yellow-500/80 hover:to-orange-500/80 text-white px-4 py-2 rounded-lg font-semibold transition-all text-sm shadow-lg shadow-yellow-500/20 flex items-center gap-2"
                                                            >
                                                                <ChartBar className="w-4 h-4" />
                                                                Analytics
                                                            </Link>
                                                            {agent.executionMode === 'local' ? (
                                                                <a
                                                                    href={`/api/agents/${agent.id}/code/download`}
                                                                    download={`${agent.name}_v${Math.floor(agent.version)}.py`}
                                                                    className="bg-gradient-to-r from-blue-600/80 to-cyan-600/80 backdrop-blur hover:from-blue-500/80 hover:to-cyan-500/80 text-white px-4 py-2 rounded-lg font-semibold transition-all text-sm shadow-lg shadow-blue-500/20 flex items-center gap-2"
                                                                >
                                                                    <Download className="w-4 h-4" />
                                                                    Download Code
                                                                </a>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleUpdateCode(agent.id)}
                                                                    className="bg-gradient-to-r from-blue-600/80 to-cyan-600/80 backdrop-blur hover:from-blue-500/80 hover:to-cyan-500/80 text-white px-4 py-2 rounded-lg font-semibold transition-all text-sm shadow-lg shadow-blue-500/20 flex items-center gap-2"
                                                                >
                                                                    <Code className="w-4 h-4" />
                                                                    Update Code
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => toggleAgentActive(agent.id, agent.active)}
                                                                className={`px-4 py-2 rounded-lg font-semibold transition-all text-sm flex items-center gap-2 shadow-lg ${agent.active
                                                                        ? 'bg-gray-700/80 backdrop-blur hover:bg-gray-600/80 text-white shadow-gray-500/20'
                                                                        : 'bg-gradient-to-r from-purple-600/80 to-pink-600/80 backdrop-blur hover:from-purple-500/80 hover:to-pink-500/80 text-white shadow-purple-500/20'
                                                                    }`}
                                                            >
                                                                <Power className="w-4 h-4" />
                                                                {agent.active ? 'Deactivate' : 'Activate'}
                                                            </button>
                                                            <AlertDialog onOpenChange={(open) => { if (!open) setDeleteConfirmStep(null); }}>
                                                                <AlertDialogTrigger asChild>
                                                                    <button
                                                                        className="bg-red-600/80 backdrop-blur hover:bg-red-700/80 text-white px-4 py-2 rounded-lg font-semibold transition-all text-sm flex items-center gap-2 shadow-lg shadow-red-500/20"
                                                                    >
                                                                        <Trash2 size={16} />
                                                                        Delete
                                                                    </button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent className="bg-gray-900/95 backdrop-blur border border-purple-500/30 shadow-2xl shadow-purple-500/20">
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle className="text-white text-2xl">
                                                                            {deleteConfirmStep === agent.id ? 'Are you REALLY sure?' : 'Delete Agent'}
                                                                        </AlertDialogTitle>
                                                                        <AlertDialogDescription className="text-gray-300 text-base">
                                                                            {deleteConfirmStep === agent.id ? (
                                                                                <span className="text-red-300">
                                                                                    This is your final warning. Deleting <strong>{agent.name} v{agent.version}</strong> is permanent and cannot be undone. All rankings, match history, and analytics will be lost forever.
                                                                                </span>
                                                                            ) : (
                                                                                <>Are you sure you want to delete {agent.name} v{agent.version}? This action cannot be undone. All associated rankings and match history will be permanently removed.</>
                                                                            )}
                                                                        </AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel className="bg-gray-700/80 backdrop-blur hover:bg-gray-600/80 text-white border-gray-600/50 shadow-lg">Cancel</AlertDialogCancel>
                                                                        {deleteConfirmStep === agent.id ? (
                                                                            <AlertDialogAction
                                                                                onClick={() => {
                                                                                    deleteAgent(agent.id);
                                                                                    setDeleteConfirmStep(null);
                                                                                }}
                                                                                className="bg-gradient-to-r from-red-700/90 to-rose-700/90 backdrop-blur hover:from-red-600/90 hover:to-rose-600/90 text-white shadow-lg shadow-red-500/30 border-0 font-bold"
                                                                            >
                                                                                Yes, Delete Forever
                                                                            </AlertDialogAction>
                                                                        ) : (
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.preventDefault();
                                                                                    setDeleteConfirmStep(agent.id);
                                                                                }}
                                                                                className="bg-gradient-to-r from-red-600/80 to-rose-600/80 backdrop-blur hover:from-red-500/80 hover:to-rose-500/80 text-white shadow-lg shadow-red-500/20 border-0 px-4 py-2 rounded-md font-medium"
                                                                            >
                                                                                Delete
                                                                            </button>
                                                                        )}
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        </div>
                                                    </div>

                                                    {agent.ranking ? (
                                                        <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3">
                                                            <div className="bg-gradient-to-br from-purple-900/30 to-purple-800/30 backdrop-blur rounded-lg p-3 border border-purple-500/20">
                                                                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                                                                    <Trophy className="w-3 h-3" />
                                                                    Global Rank
                                                                </div>
                                                                <div className="text-2xl font-bold text-purple-400">
                                                                    #{agent.ranking.globalRank || '-'}
                                                                </div>
                                                            </div>
                                                            <div className="bg-gradient-to-br from-yellow-900/30 to-yellow-800/30 backdrop-blur rounded-lg p-3 border border-yellow-500/20">
                                                                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                                                                    <Zap className="w-3 h-3" />
                                                                    ELO Rating
                                                                </div>
                                                                <div className="text-2xl font-bold text-yellow-400">
                                                                    {agent.ranking.eloRating}
                                                                </div>
                                                            </div>
                                                            <div className="bg-gradient-to-br from-gray-800/50 to-gray-700/50 backdrop-blur rounded-lg p-3 border border-gray-600/20">
                                                                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                                                                    <Activity className="w-3 h-3" />
                                                                    Games
                                                                </div>
                                                                <div className="text-2xl font-bold text-white">
                                                                    {agent.ranking.gamesPlayed}
                                                                </div>
                                                            </div>
                                                            <div className="bg-gradient-to-br from-green-900/30 to-green-800/30 backdrop-blur rounded-lg p-3 border border-green-500/20">
                                                                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                                                                    <TrendingUp className="w-3 h-3" />
                                                                    Wins
                                                                </div>
                                                                <div className="text-2xl font-bold text-green-400">
                                                                    {agent.ranking.wins}
                                                                </div>
                                                            </div>
                                                            <div className="bg-gradient-to-br from-gray-800/50 to-gray-700/50 backdrop-blur rounded-lg p-3 border border-gray-600/20">
                                                                <div className="text-gray-400 text-xs mb-1">Draws</div>
                                                                <div className="text-2xl font-bold text-gray-400">
                                                                    {agent.ranking.draws}
                                                                </div>
                                                            </div>
                                                            <div className="bg-gradient-to-br from-red-900/30 to-red-800/30 backdrop-blur rounded-lg p-3 border border-red-500/20">
                                                                <div className="text-gray-400 text-xs mb-1">Losses</div>
                                                                <div className="text-2xl font-bold text-red-400">
                                                                    {agent.ranking.losses}
                                                                </div>
                                                            </div>
                                                            <div className="bg-gradient-to-br from-blue-900/30 to-blue-800/30 backdrop-blur rounded-lg p-3 border border-blue-500/20">
                                                                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                                                                    <Target className="w-3 h-3" />
                                                                    Win Rate
                                                                </div>
                                                                <div className="text-2xl font-bold text-blue-400">
                                                                    {getWinRate(agent)}%
                                                                </div>
                                                            </div>
                                                            <div className="bg-gradient-to-br from-gray-800/50 to-gray-700/50 backdrop-blur rounded-lg p-3 border border-gray-600/20">
                                                                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                                                                    <Clock className="w-3 h-3" />
                                                                    Avg Time
                                                                </div>
                                                                <div className="text-lg font-bold text-gray-300">
                                                                    {agent.ranking.avgMoveTimeMs ? `${agent.ranking.avgMoveTimeMs}ms` : '-'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="bg-gray-900/50 backdrop-blur rounded-lg p-4 text-center text-gray-500 border border-gray-700/50">
                                                            <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                                            No matches played yet
                                                        </div>
                                                    )}

                                                    {agent.lastMatchAt && (
                                                        <div className="mt-3 text-sm text-gray-500">
                                                            Last match: {new Date(agent.lastMatchAt).toLocaleString()}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}

                                            {/* Version History Toggle */}
                                            {hasMultipleVersions && (
                                                <button
                                                    onClick={() => toggleVersionHistory(agentName)}
                                                    className="w-full bg-gray-800/30 hover:bg-gray-800/50 border border-purple-500/20 hover:border-purple-500/30 rounded-lg p-3 text-purple-300 hover:text-purple-200 transition-all flex items-center justify-center gap-2"
                                                >
                                                    {isExpanded ? (
                                                        <>
                                                            <TrendingDown className="w-4 h-4" />
                                                            Hide {versions.length - 1} older version{versions.length - 1 > 1 ? 's' : ''}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <TrendingUp className="w-4 h-4" />
                                                            Show {versions.length - 1} older version{versions.length - 1 > 1 ? 's' : ''}
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Upload History Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-6">
                            <Activity className="w-6 h-6 text-purple-400" />
                            <h2 className="text-3xl font-bold text-white">Upload History</h2>
                        </div>
                        {history.length === 0 ? (
                            <div className="bg-gray-800/50 backdrop-blur border border-purple-500/20 rounded-xl p-6 text-center text-gray-400 shadow-lg shadow-purple-500/10">
                                <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                No upload history
                            </div>
                        ) : (
                            <div className="bg-gray-800/50 backdrop-blur border border-purple-500/20 rounded-xl overflow-hidden shadow-lg shadow-purple-500/10">
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead className="bg-gray-900/50">
                                            <tr>
                                                <th className="px-6 py-4 text-left text-sm font-semibold text-purple-400">
                                                    Date
                                                </th>
                                                <th className="px-6 py-4 text-left text-sm font-semibold text-purple-400">
                                                    Status
                                                </th>
                                                <th className="px-6 py-4 text-left text-sm font-semibold text-purple-400">
                                                    Message
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-purple-500/10">
                                            {history.map((entry) => (
                                                <tr key={entry.id} className="hover:bg-purple-900/20 transition-all duration-200">
                                                    <td className="px-6 py-4 text-gray-300 text-sm">
                                                        <Clock className="w-3 h-3 inline mr-1 text-gray-500" />
                                                        {new Date(entry.uploadedAt).toLocaleString()}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span
                                                            className={`px-3 py-1 rounded-full text-xs font-semibold ${entry.success
                                                                    ? 'bg-green-900/50 text-green-300 border border-green-500/30'
                                                                    : 'bg-red-900/50 text-red-300 border border-red-500/30'
                                                                }`}
                                                        >
                                                            {entry.success ? 'SUCCESS' : 'FAILED'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-gray-400 text-sm">
                                                        {entry.success ? 'Agent uploaded successfully' : entry.errorMessage}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                </div>

                {updateCodeModalOpen && selectedAgentId && (
                    <div className="fixed inset-0 z-50 overflow-y-auto">
                        <UpdateCodeModal
                            agentId={selectedAgentId}
                            onClose={() => {
                                setUpdateCodeModalOpen(false);
                                setSelectedAgentId(null);
                            }}
                            onSuccess={() => {
                                setUpdateCodeModalOpen(false);
                                setSelectedAgentId(null);
                                fetchDashboardData();
                            }}
                        />
                    </div>
                )}

                {opponentSelectModalOpen && selectedAgentForMatch && (
                    <OpponentSelectModal
                        agentId={selectedAgentForMatch}
                        agents={agents.filter(a => a.active)}
                        onClose={() => {
                            setOpponentSelectModalOpen(false);
                            setSelectedAgentForMatch(null);
                        }}
                        onSelectOpponent={(opponentId) => {
                            startExhibitionMatch(selectedAgentForMatch, opponentId);
                        }}
                    />
                )}
            </div>
        </div>
    );
}

interface UpdateCodeModalProps {
    agentId: string;
    onClose: () => void;
    onSuccess: () => void;
}

function UpdateCodeModal({ agentId, onClose, onSuccess }: UpdateCodeModalProps) {
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [agentName, setAgentName] = useState('');
    const [currentVersion, setCurrentVersion] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [uploadedFileName, setUploadedFileName] = useState('');
    const [isLargeFile, setIsLargeFile] = useState(false);
    const [fileReadProgress, setFileReadProgress] = useState(0);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isReading, setIsReading] = useState(false);
    const [validationStatus, setValidationStatus] = useState<{
        status: string;
        position: number;
        error?: string;
        agentId?: string;
    } | null>(null);
    const [queueId, setQueueId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        fetchAgentCode();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, []);

    const fetchAgentCode = async () => {
        try {
            const response = await fetch(`/api/agents/${agentId}/code`, {
                headers: {
                    'x-access-code': localStorage.getItem('fragmentarena_code') || '',
                },
            });

            if (!response.ok) {
                throw new Error('Failed to fetch agent code');
            }

            const data = await response.json();
            setCode(data.agent.codeText);
            setAgentName(data.agent.name);
            setCurrentVersion(data.agent.version);
            setError('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const pollValidationStatus = async (id: string) => {
        try {
            const response = await fetch(`/api/agents/validation/${id}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-access-code': localStorage.getItem('fragmentarena_code') || '',
                },
            });

            if (!response.ok) {
                throw new Error('Failed to fetch validation status');
            }

            const data = await response.json();
            setValidationStatus(data);

            if (data.status === 'passed') {
                // Validation passed - clear polling and close modal
                if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                }
                setSuccess('Agent validated successfully.');
                setSubmitting(false);
                setTimeout(() => {
                    onSuccess();
                }, 1500);
            } else if (data.status === 'failed') {
                // Validation failed - clear polling and show error
                if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                }
                setError(data.error || 'Validation failed');
                setSubmitting(false);
            }
        } catch (err) {
            console.error('Failed to poll validation status:', err);
        }
    };

    const handleFileRead = (file: File) => {
        if (file.name !== 'agent.py') {
            setError('File must be named "agent.py"');
            return;
        }

        const isLarge = file.size > 1024 * 1024;
        setIsLargeFile(isLarge);
        setIsReading(true);
        setFileReadProgress(0);

        const reader = new FileReader();

        reader.onprogress = (e) => {
            if (e.lengthComputable) {
                const progress = Math.round((e.loaded / e.total) * 100);
                setFileReadProgress(progress);
            }
        };

        reader.onload = (e) => {
            const content = e.target?.result as string;
            setCode(content);
            setUploadedFileName(file.name);
            setFileReadProgress(100);
            setIsReading(false);
            setError('');
        };

        reader.onerror = () => {
            setError('Failed to read file');
            setIsReading(false);
            setFileReadProgress(0);
        };

        reader.readAsText(file);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleFileRead(file);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file) {
            handleFileRead(file);
        }
    };

    const handleSubmit = async () => {
        if (!code.trim()) {
            setError('Code cannot be empty');
            return;
        }

        setSubmitting(true);
        setError('');
        setUploadProgress(0);

        return new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const progress = Math.round((e.loaded / e.total) * 100);
                    setUploadProgress(progress);
                }
            });

            xhr.addEventListener('load', () => {
                try {
                    const data = JSON.parse(xhr.responseText);

                    if (xhr.status !== 200) {
                        throw new Error(data.error || 'Failed to update agent');
                    }

                    // Agent submitted for validation
                    setQueueId(data.queueId);
                    setValidationStatus({
                        status: data.status,
                        position: data.position,
                    });

                    setUploadProgress(0);

                    // Start polling for validation status
                    pollValidationStatus(data.queueId);
                    pollIntervalRef.current = setInterval(() => {
                        pollValidationStatus(data.queueId);
                    }, 2000);

                    resolve();
                } catch (err) {
                    setError(err instanceof Error ? err.message : 'An error occurred');
                    setSubmitting(false);
                    setUploadProgress(0);
                    reject(err);
                }
            });

            xhr.addEventListener('error', () => {
                setError('Network error occurred during update');
                setSubmitting(false);
                setUploadProgress(0);
                reject(new Error('Network error'));
            });

            xhr.addEventListener('abort', () => {
                setError('Update was cancelled');
                setSubmitting(false);
                setUploadProgress(0);
                reject(new Error('Update cancelled'));
            });

            xhr.open('POST', `/api/agents/${agentId}/update`);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('x-access-code', localStorage.getItem('fragmentarena_code') || '');
            xhr.send(JSON.stringify({
                code: code,
            }));
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
            <div className="bg-gray-900/95 backdrop-blur border border-purple-500/30 rounded-xl max-w-5xl w-full max-h-[95vh] sm:max-h-[90vh] flex flex-col shadow-2xl shadow-purple-500/20">
                {/* Header */}
                <div className="p-4 sm:p-6 border-b border-purple-500/20 flex justify-between items-start sm:items-center bg-gradient-to-r from-purple-900/20 to-transparent">
                    <div>
                        <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-white flex items-center gap-2">
                            <Code className="w-6 h-6 sm:w-8 sm:h-8 text-purple-400" />
                            Update Agent Code
                        </h2>
                        <p className="text-purple-300 text-xs sm:text-sm mt-1">
                            {agentName} v{currentVersion}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl sm:text-3xl transition-colors"
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                    {loading ? (
                        <div className="text-center text-gray-400 py-12">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
                            Loading code...
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {error && (
                                <div className="bg-red-900/50 backdrop-blur border border-red-600/50 rounded-lg p-4">
                                    <p className="text-red-200">{error}</p>
                                </div>
                            )}

                            {/* Version Info */}
                            <div className="bg-gray-800/50 backdrop-blur border border-purple-500/20 rounded-lg p-4">
                                <div className="flex items-center gap-4">
                                    <div>
                                        <span className="text-gray-400 text-sm">Current Version:</span>
                                        <span className="text-white font-bold ml-2">v{currentVersion}</span>
                                    </div>
                                    <span className="text-purple-500">→</span>
                                    <div>
                                        <span className="text-gray-400 text-sm">New Version:</span>
                                        <span className="text-purple-400 font-bold ml-2">v{currentVersion + 1}</span>
                                    </div>
                                </div>
                            </div>

                            {/* File Upload Button */}
                            <div className="mb-4">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full bg-gradient-to-r from-purple-600/20 to-blue-600/20 hover:from-purple-600/30 hover:to-blue-600/30 border-2 border-dashed border-purple-500/50 hover:border-purple-400 text-purple-300 hover:text-purple-200 px-6 py-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-3 shadow-lg"
                                >
                                    <Upload className="w-5 h-5" />
                                    Click to Upload agent.py or Drag & Drop Below
                                </button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".py"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                />
                            </div>

                            {/* Code Editor with Drag and Drop */}
                            <div>
                                <label className="block text-gray-300 mb-2 font-semibold flex items-center gap-2">
                                    <Code className="w-4 h-4" />
                                    Agent Code
                                    <span className="text-xs text-gray-500 font-normal">(or drag & drop agent.py file below)</span>
                                </label>
                                {isDragging ? (
                                    <div
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                        className="w-full h-96 border-2 border-dashed border-purple-400 bg-purple-500/20 rounded-lg flex items-center justify-center transition-all scale-[1.02]"
                                    >
                                        <div className="text-center">
                                            <div className="p-4 rounded-full bg-purple-500/30 inline-block mb-3">
                                                <Upload className="w-8 h-8 text-purple-300 animate-bounce" />
                                            </div>
                                            <p className="text-white font-semibold mb-1">Drop your agent.py file here</p>
                                            <p className="text-sm text-purple-300">File will replace current code</p>
                                        </div>
                                    </div>
                                ) : isReading ? (
                                    <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-8 text-center">
                                        <p className="text-blue-400 font-semibold mb-4">Reading File...</p>
                                        <div className="w-full max-w-md mx-auto">
                                            <div className="bg-gray-800/50 rounded-full h-3 overflow-hidden border border-blue-500/30">
                                                <div
                                                    className="bg-gradient-to-r from-purple-600 to-blue-600 h-full transition-all duration-300 flex items-center justify-end pr-2"
                                                    style={{ width: `${fileReadProgress}%` }}
                                                >
                                                    <span className="text-xs font-bold text-white drop-shadow-lg">
                                                        {fileReadProgress}%
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : uploadedFileName ? (
                                    <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-8 text-center">
                                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
                                            <Code className="w-8 h-8 text-green-400" />
                                        </div>
                                        <p className="text-green-400 font-semibold text-lg mb-2">
                                            {isLargeFile ? 'Large File Loaded' : 'File Loaded'}
                                        </p>
                                        <p className="text-gray-400 mb-1">{uploadedFileName}</p>
                                        <p className="text-sm text-gray-500 mb-4">
                                            {code.length >= 1024 * 1024
                                                ? `${(code.length / 1024 / 1024).toFixed(2)} MB`
                                                : `${(code.length / 1024).toFixed(2)} KB`} loaded
                                        </p>
                                        <button
                                            onClick={() => {
                                                setIsLargeFile(false);
                                                setUploadedFileName('');
                                                fetchAgentCode();
                                            }}
                                            className="text-sm text-purple-400 hover:text-purple-300 underline"
                                        >
                                            Clear and show code editor
                                        </button>
                                    </div>
                                ) : (
                                    <div
                                        onDragOver={handleDragOver}
                                        className="relative"
                                    >
                                        <textarea
                                            value={code}
                                            onChange={(e) => {
                                                setCode(e.target.value);
                                                setIsLargeFile(false);
                                                setUploadedFileName('');
                                            }}
                                            onDragOver={handleDragOver}
                                            className="w-full h-96 bg-gray-900/50 backdrop-blur text-gray-100 font-mono text-sm p-4 rounded-lg border border-purple-500/30 hover:border-purple-400/50 focus:border-purple-500 focus:outline-none resize-none focus:shadow-lg focus:shadow-purple-500/20 transition-all"
                                            placeholder="Paste your Python agent code here..."
                                            spellCheck={false}
                                        />
                                        {uploadedFileName && !isLargeFile && (
                                            <div className="absolute top-2 right-2 bg-green-900/80 backdrop-blur px-3 py-1 rounded text-xs text-green-300 border border-green-500/30">
                                                Loaded: {uploadedFileName}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-purple-500/20 bg-gradient-to-r from-transparent to-purple-900/20">
                    {/* Upload Progress */}
                    {submitting && uploadProgress > 0 && (
                        <div className="mb-4 bg-blue-900/20 border border-blue-500/30 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-blue-300 font-semibold text-sm">Update Progress</p>
                                <p className="text-blue-200 text-xs font-bold">{uploadProgress}%</p>
                            </div>
                            <div className="bg-gray-800/50 rounded-full h-2 overflow-hidden border border-blue-500/30">
                                <div
                                    className="bg-gradient-to-r from-blue-600 to-purple-600 h-full transition-all duration-300 relative overflow-hidden"
                                    style={{ width: `${uploadProgress}%` }}
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Validation Status */}
                    {validationStatus && !error && !success && (
                        <div className="mb-4 bg-blue-900/30 border border-blue-500/50 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400 mt-0.5"></div>
                                <div className="flex-1">
                                    <p className="text-blue-200 font-semibold mb-2">
                                        {validationStatus.status === 'pending' && 'Queued for Validation'}
                                        {validationStatus.status === 'testing' && 'Testing Agent...'}
                                    </p>

                                    {validationStatus.status === 'pending' && validationStatus.position > 0 && (
                                        <p className="text-blue-300 text-sm">
                                            Position in queue: <span className="font-semibold">{validationStatus.position}</span>
                                        </p>
                                    )}

                                    {validationStatus.status === 'testing' && (
                                        <p className="text-blue-300 text-sm">
                                            Running validation test (max 14 seconds)...
                                        </p>
                                    )}

                                    <div className="mt-3 bg-blue-500/20 rounded-full h-2 overflow-hidden">
                                        <div className="bg-blue-500 h-full animate-pulse" style={{ width: '60%' }}></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="mb-4 bg-red-900/30 border border-red-500/50 rounded-lg p-4 flex items-start gap-3">
                            <div className="text-red-400 text-xl">⚠</div>
                            <div>
                                <p className="text-red-200 font-semibold mb-1">Validation Failed</p>
                                <p className="text-red-300 text-sm">{error}</p>
                                <button
                                    onClick={() => { setError(''); setValidationStatus(null); }}
                                    className="mt-3 text-sm text-red-200 hover:text-red-100 underline"
                                >
                                    Try Again
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Success Message */}
                    {success && (
                        <div className="mb-4 bg-green-900/30 border border-green-500/50 rounded-lg p-4 flex items-start gap-3">
                            <div className="text-green-400 text-xl">✓</div>
                            <div>
                                <p className="text-green-200">{success}</p>
                                <p className="text-green-300 mt-1 text-sm">Refreshing dashboard...</p>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            disabled={submitting}
                            className="bg-gray-700/50 backdrop-blur hover:bg-gray-600/50 text-white px-6 py-2 rounded-lg font-semibold transition-all disabled:bg-gray-800/50 disabled:cursor-not-allowed shadow-lg"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || loading}
                            className="bg-purple-600/80 backdrop-blur hover:bg-purple-700/80 text-white px-6 py-2 rounded-lg font-semibold transition-all disabled:bg-gray-600/50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20"
                        >
                            {submitting ? 'Updating...' : 'Update Agent'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface OpponentSelectModalProps {
    agentId: string;
    agents: Agent[];
    onClose: () => void;
    onSelectOpponent: (opponentId: string | undefined) => void;
}

function OpponentSelectModal({ agentId, agents, onClose, onSelectOpponent }: OpponentSelectModalProps) {
    const currentAgent = agents.find(a => a.id === agentId);
    const otherAgents = agents.filter(a => a.id !== agentId);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900/95 backdrop-blur border border-purple-500/30 rounded-xl max-w-2xl w-full shadow-2xl shadow-purple-500/20">
                <div className="p-6 border-b border-purple-500/20 flex justify-between items-center bg-gradient-to-r from-purple-900/20 to-transparent">
                    <div>
                        <h2 className="text-3xl font-bold text-white flex items-center gap-2">
                            <Target className="w-8 h-8 text-purple-400" />
                            Select Opponent
                        </h2>
                        <p className="text-purple-300 text-sm mt-1">
                            Choose challenger for {currentAgent?.name} v{currentAgent?.version}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-3xl transition-colors"
                    >
                        ×
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <button
                        onClick={() => onSelectOpponent(undefined)}
                        className="w-full text-left bg-gradient-to-r from-purple-900/30 to-purple-800/30 backdrop-blur hover:from-purple-800/40 hover:to-purple-700/40 border border-purple-500/30 rounded-xl p-4 transition-all shadow-lg hover:shadow-purple-500/20"
                    >
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-purple-400" />
                                    Random Opponent
                                </h3>
                                <p className="text-purple-300 text-sm mt-1">Match against a similar ELO-rated agent from any player</p>
                            </div>
                            <div className="text-purple-400 text-2xl">→</div>
                        </div>
                    </button>

                    {otherAgents.length > 0 && (
                        <>
                            <div className="text-purple-400 text-sm font-semibold uppercase pt-2 flex items-center gap-2">
                                <Shield className="w-4 h-4" />
                                Your Other Agents
                            </div>
                            {otherAgents.map((agent) => (
                                <button
                                    key={agent.id}
                                    onClick={() => onSelectOpponent(agent.id)}
                                    className="w-full text-left bg-gray-800/50 backdrop-blur hover:bg-gray-700/50 border border-purple-500/20 rounded-xl p-4 transition-all shadow-lg hover:shadow-purple-500/10"
                                >
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-lg font-bold text-white">{agent.name}</h3>
                                                <span className="text-sm text-purple-400">v{agent.version}</span>
                                                {agent.active && (
                                                    <span className="px-2 py-1 bg-green-900/50 text-green-300 text-xs rounded-full border border-green-500/30">
                                                        ONLINE
                                                    </span>
                                                )}
                                            </div>
                                            {agent.ranking && (
                                                <div className="flex items-center gap-3 text-sm mt-1">
                                                    <span className="text-yellow-400">
                                                        <Zap className="w-3 h-3 inline mr-1" />
                                                        ELO: {agent.ranking.eloRating}
                                                    </span>
                                                    <span className="text-blue-400">
                                                        <Target className="w-3 h-3 inline mr-1" />
                                                        Win Rate: {
                                                            agent.ranking.gamesPlayed > 0
                                                                ? ((agent.ranking.wins / agent.ranking.gamesPlayed) * 100).toFixed(1)
                                                                : 0
                                                        }%
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-green-400 text-2xl">→</div>
                                    </div>
                                </button>
                            ))}
                        </>
                    )}
                </div>

                <div className="p-6 border-t border-purple-500/20 flex justify-end bg-gradient-to-r from-transparent to-purple-900/20">
                    <button
                        onClick={onClose}
                        className="bg-gray-700/50 backdrop-blur hover:bg-gray-600/50 text-white px-6 py-2 rounded-lg font-semibold transition-all shadow-lg"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
