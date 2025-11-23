'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Activity, Trophy, LayoutDashboard, Upload, Link as LinkIcon, LogOut, Menu, X } from 'lucide-react';
import { useState, useEffect } from 'react';

const navItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, requiresAuth: true },
  { href: '/live', label: 'Live', icon: Activity },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/link-agent', label: 'Link Agent', icon: LinkIcon, requiresAuth: true },
  { href: '/upload', label: 'Upload', icon: Upload, requiresAuth: true },
];

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const accessCode = localStorage.getItem('fragmentarena_code');
    setIsAuthenticated(!!accessCode);
  }, [pathname]);

  const handleLogout = () => {
    localStorage.removeItem('fragmentarena_code');
    localStorage.removeItem('fragmentarena_user_id');
    router.push('/');
  };

  const visibleItems = navItems.filter(item => {
    // Filter by auth requirement
    if (item.requiresAuth && !isAuthenticated) return false;
    return true;
  });

  return (
    <nav className="bg-gray-900/80 backdrop-blur-lg border-b border-purple-500/20 sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2 group">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-700 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">F</span>
            </div>
            <span className="text-xl font-bold">
              <span className="text-white">Fragment</span>
              <span className="text-purple-400">Arena</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    px-4 py-2 rounded-lg flex items-center space-x-2 transition-all duration-200
                    ${isActive
                      ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50'
                      : 'text-gray-300 hover:bg-gray-800/50 hover:text-white'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}

            {isAuthenticated && (
              <button
                onClick={handleLogout}
                className="ml-2 px-4 py-2 rounded-lg flex items-center space-x-2 text-gray-300 hover:bg-red-900/20 hover:text-red-400 transition-all duration-200"
              >
                <LogOut className="w-4 h-4" />
                <span className="text-sm font-medium">Logout</span>
              </button>
            )}

            {!isAuthenticated && pathname !== '/start' && (
              <Link
                href="/start"
                className="ml-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Get Started
              </Link>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-gray-300 hover:text-white"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-gray-800">
            <div className="flex flex-col space-y-2">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`
                      px-4 py-2 rounded-lg flex items-center space-x-2 transition-all duration-200
                      ${isActive
                        ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50'
                        : 'text-gray-300 hover:bg-gray-800/50 hover:text-white'
                      }
                    `}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                );
              })}

              {isAuthenticated && (
                <button
                  onClick={() => {
                    handleLogout();
                    setMobileMenuOpen(false);
                  }}
                  className="px-4 py-2 rounded-lg flex items-center space-x-2 text-gray-300 hover:bg-red-900/20 hover:text-red-400 transition-all duration-200"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="text-sm font-medium">Logout</span>
                </button>
              )}

              {!isAuthenticated && pathname !== '/start' && (
                <Link
                  href="/start"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors text-center"
                >
                  Get Started
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}