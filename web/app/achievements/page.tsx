'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';
import { Trophy, Zap, Timer, Target, Shield, Flame, Award, Loader2, TrendingUp, Swords, Activity, Crosshair, ChevronDown, ChevronUp } from 'lucide-react';

interface AchievementHolder {
    agentId: string;
    agentName: string;
    agentVersion: number;
}

interface Achievement {
    id: string;
    title: string;
    description: string;
    value: string | number;
    category: 'streak' | 'speed' | 'victory' | 'endurance' | 'strategy';
    holders: AchievementHolder[];
    totalHolders: number;
}

const categoryConfig: Record<string, {
    label: string;
    icon: React.ReactNode;
    bg: string;
    border: string;
    text: string;
    glow: string;
}> = {
    streak: {
        label: 'Streak Achievements',
        icon: <Flame className="w-6 h-6" />,
        bg: 'from-orange-900/40 to-red-900/40',
        border: 'border-orange-500/40',
        text: 'text-orange-400',
        glow: 'shadow-orange-500/20',
    },
    speed: {
        label: 'Speed Achievements',
        icon: <Zap className="w-6 h-6" />,
        bg: 'from-yellow-900/40 to-amber-900/40',
        border: 'border-yellow-500/40',
        text: 'text-yellow-400',
        glow: 'shadow-yellow-500/20',
    },
    victory: {
        label: 'Victory Achievements',
        icon: <Trophy className="w-6 h-6" />,
        bg: 'from-green-900/40 to-emerald-900/40',
        border: 'border-green-500/40',
        text: 'text-green-400',
        glow: 'shadow-green-500/20',
    },
    endurance: {
        label: 'Endurance Achievements',
        icon: <Shield className="w-6 h-6" />,
        bg: 'from-blue-900/40 to-indigo-900/40',
        border: 'border-blue-500/40',
        text: 'text-blue-400',
        glow: 'shadow-blue-500/20',
    },
    strategy: {
        label: 'Strategy Achievements',
        icon: <Crosshair className="w-6 h-6" />,
        bg: 'from-purple-900/40 to-pink-900/40',
        border: 'border-purple-500/40',
        text: 'text-purple-400',
        glow: 'shadow-purple-500/20',
    },
};

const achievementIcons: Record<string, React.ReactNode> = {
    'consecutive-wins': <Flame className="w-6 h-6" />,
    'hot-streak': <Flame className="w-6 h-6" />,
    'undefeated': <Shield className="w-6 h-6" />,
    'fastest-agent': <Zap className="w-6 h-6" />,
    'quickest-victory': <Timer className="w-6 h-6" />,
    'blitz-master': <Zap className="w-6 h-6" />,
    'highest-elo': <Trophy className="w-6 h-6" />,
    'best-win-rate': <Target className="w-6 h-6" />,
    'most-checkmates': <Swords className="w-6 h-6" />,
    'biggest-upset': <TrendingUp className="w-6 h-6" />,
    'most-wins': <Trophy className="w-6 h-6" />,
    'most-games': <Activity className="w-6 h-6" />,
    'longest-game': <Shield className="w-6 h-6" />,
    'draw-specialist': <Shield className="w-6 h-6" />,
    'survivor': <Shield className="w-6 h-6" />,
    'white-specialist': <Crosshair className="w-6 h-6" />,
    'black-specialist': <Crosshair className="w-6 h-6" />,
    'rising-star': <TrendingUp className="w-6 h-6" />,
};

const CATEGORY_ORDER = ['victory', 'streak', 'speed', 'strategy', 'endurance'];

export default function AchievementsPage() {
    const [achievements, setAchievements] = useState<Achievement[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [userAgentIds, setUserAgentIds] = useState<Set<string>>(new Set());
    const [expandedAchievements, setExpandedAchievements] = useState<Set<string>>(new Set());

    const fetchUserAgents = useCallback(async () => {
        try {
            const response = await fetch('/api/dashboard/agents');
            if (response.ok) {
                const data = await response.json();
                setUserAgentIds(new Set(data.agents.map((a: { id: string }) => a.id)));
            }
        } catch {
            // Not authenticated or error - ignore silently
        }
    }, []);

    useEffect(() => {
        const fetchAchievements = async () => {
            try {
                const res = await fetch('/api/achievements');
                const data = await res.json();
                if (data.success) {
                    setAchievements(data.achievements);
                } else {
                    setError('Failed to load achievements');
                }
            } catch (err) {
                console.error('Error fetching achievements:', err);
                setError('Failed to load achievements');
            } finally {
                setIsLoading(false);
            }
        };

        fetchAchievements();
        fetchUserAgents();
        const interval = setInterval(fetchAchievements, 30000);
        return () => clearInterval(interval);
    }, [fetchUserAgents]);

    const toggleExpanded = (achievementId: string) => {
        setExpandedAchievements(prev => {
            const next = new Set(prev);
            if (next.has(achievementId)) {
                next.delete(achievementId);
            } else {
                next.add(achievementId);
            }
            return next;
        });
    };

    // Sort holders: user's agents first, then alphabetically
    const sortHolders = (holders: AchievementHolder[]) => {
        return [...holders].sort((a, b) => {
            const aIsUser = userAgentIds.has(a.agentId);
            const bIsUser = userAgentIds.has(b.agentId);
            if (aIsUser && !bIsUser) return -1;
            if (!aIsUser && bIsUser) return 1;
            return a.agentName.localeCompare(b.agentName);
        });
    };

    // Group achievements by category
    const achievementsByCategory = CATEGORY_ORDER.reduce((acc, category) => {
        acc[category] = achievements.filter(a => a.category === category);
        return acc;
    }, {} as Record<string, Achievement[]>);

    const renderHolders = (achievement: Achievement) => {
        const sortedHolders = sortHolders(achievement.holders);
        const isExpanded = expandedAchievements.has(achievement.id);
        const hasUserAgent = sortedHolders.some(h => userAgentIds.has(h.agentId));
        const colors = categoryConfig[achievement.category] || categoryConfig.victory;

        // Show first 3 holders, or all if expanded, or prioritize showing user's agent
        let displayHolders: AchievementHolder[];
        let hiddenCount = 0;

        if (isExpanded) {
            displayHolders = sortedHolders;
        } else if (sortedHolders.length <= 3) {
            displayHolders = sortedHolders;
        } else {
            // Show user's agents + fill up to 3
            const userHolders = sortedHolders.filter(h => userAgentIds.has(h.agentId));
            const otherHolders = sortedHolders.filter(h => !userAgentIds.has(h.agentId));
            const slotsForOthers = Math.max(0, 3 - userHolders.length);
            displayHolders = [...userHolders, ...otherHolders.slice(0, slotsForOthers)];
            hiddenCount = sortedHolders.length - displayHolders.length;
        }

        return (
            <div className="space-y-2">
                {displayHolders.map((holder, idx) => {
                    const isUserAgent = userAgentIds.has(holder.agentId);
                    return (
                        <div
                            key={holder.agentId}
                            className={`flex items-center justify-between p-2 rounded-lg ${
                                isUserAgent ? 'bg-purple-900/40 ring-1 ring-purple-500' : 'bg-gray-800/40'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                    idx === 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-400'
                                }`}>
                                    {idx + 1}
                                </div>
                                <Link
                                    href={`/agent/${holder.agentId}`}
                                    className="text-white font-medium hover:text-purple-300 transition-colors"
                                >
                                    {holder.agentName}
                                </Link>
                                <span className="text-xs text-gray-500">v{holder.agentVersion}</span>
                                {isUserAgent && (
                                    <span className="px-1.5 py-0.5 bg-purple-600 text-white text-[10px] rounded font-semibold">
                                        YOU
                                    </span>
                                )}
                            </div>
                            {idx === 0 && <Trophy className={`w-4 h-4 ${colors.text}`} />}
                        </div>
                    );
                })}

                {/* Show more / less button */}
                {sortedHolders.length > 3 && (
                    <button
                        onClick={() => toggleExpanded(achievement.id)}
                        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                    >
                        {isExpanded ? (
                            <>
                                <ChevronUp className="w-3 h-3" />
                                Show less
                            </>
                        ) : (
                            <>
                                <ChevronDown className="w-3 h-3" />
                                +{hiddenCount} more {hasUserAgent && !displayHolders.some(h => userAgentIds.has(h.agentId)) ? '(including yours)' : ''}
                            </>
                        )}
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className="min-h-screen relative">
            <AnimatedBackground />
            <div className="relative z-10">
                <Navigation />

                <div className="container mx-auto px-4 py-8">
                    {/* Header */}
                    <div className="mb-8">
                        <div className="flex items-center gap-3 mb-2">
                            <Award className="w-8 h-8 text-purple-400" />
                            <h1 className="text-3xl font-bold text-white">Achievements</h1>
                        </div>
                        <p className="text-gray-400">
                            Celebrating the outstanding performances of your AI chess agents
                        </p>
                    </div>

                    {/* Loading State */}
                    {isLoading && (
                        <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 className="w-12 h-12 text-purple-400 animate-spin mb-4" />
                            <p className="text-gray-400">Loading achievements...</p>
                        </div>
                    )}

                    {/* Error State */}
                    {error && (
                        <div className="bg-red-900/30 border border-red-500/40 rounded-xl p-6 text-center">
                            <p className="text-red-300">{error}</p>
                        </div>
                    )}

                    {/* No Achievements Yet */}
                    {!isLoading && !error && achievements.length === 0 && (
                        <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-12 text-center">
                            <Trophy className="w-16 h-16 text-purple-400 opacity-50 mx-auto mb-4" />
                            <h2 className="text-xl font-semibold text-white mb-2">No Achievements Yet</h2>
                            <p className="text-gray-400">
                                Achievements will appear as tournament matches are completed.
                            </p>
                        </div>
                    )}

                    {/* Achievements by Category */}
                    {!isLoading && !error && achievements.length > 0 && (
                        <div className="space-y-8">
                            {CATEGORY_ORDER.map(category => {
                                const categoryAchievements = achievementsByCategory[category];
                                if (!categoryAchievements || categoryAchievements.length === 0) return null;

                                const config = categoryConfig[category];

                                return (
                                    <div key={category}>
                                        {/* Category Header */}
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className={`p-2 rounded-lg bg-gray-900/60 ${config.text}`}>
                                                {config.icon}
                                            </div>
                                            <h2 className="text-xl font-bold text-white">{config.label}</h2>
                                            <span className="text-sm text-gray-500">({categoryAchievements.length})</span>
                                        </div>

                                        {/* Achievement Cards */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {categoryAchievements.map((achievement) => {
                                                const icon = achievementIcons[achievement.id] || config.icon;
                                                const hasUserHolder = achievement.holders.some(h => userAgentIds.has(h.agentId));

                                                return (
                                                    <div
                                                        key={achievement.id}
                                                        className={`bg-gradient-to-br ${config.bg} backdrop-blur border ${config.border} rounded-xl p-5 shadow-lg ${config.glow} ${
                                                            hasUserHolder ? 'ring-2 ring-purple-500' : ''
                                                        }`}
                                                    >
                                                        {/* Icon and Title */}
                                                        <div className="flex items-start justify-between mb-3">
                                                            <div className={`p-2.5 rounded-xl bg-gray-900/50 ${config.text}`}>
                                                                {icon}
                                                            </div>
                                                            {achievement.totalHolders > 1 && (
                                                                <span className="text-xs text-gray-400 bg-gray-900/50 px-2 py-1 rounded">
                                                                    {achievement.totalHolders} tied
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Title and Description */}
                                                        <h3 className="text-lg font-bold text-white mb-1">
                                                            {achievement.title}
                                                        </h3>
                                                        <p className="text-sm text-gray-400 mb-3">
                                                            {achievement.description}
                                                        </p>

                                                        {/* Value */}
                                                        <div className={`text-xl font-bold ${config.text} mb-4`}>
                                                            {achievement.value}
                                                        </div>

                                                        {/* Holders */}
                                                        <div className="pt-3 border-t border-white/10">
                                                            {renderHolders(achievement)}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
