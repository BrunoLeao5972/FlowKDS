import React, { createContext, useContext, useMemo, useState } from 'react';

interface AuthContextType {
  token: string | null;
  username: string | null;
  isAuthenticated: boolean;
  permissions: string[];
  hasPermission: (perm: string) => boolean;
  login: (username: string, password: string) => Promise<string[]>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const STORAGE_TOKEN = 'kds_auth_token';
const STORAGE_USER = 'kds_auth_user';
const STORAGE_PERMISSIONS = 'kds_auth_permissions';
const ALL_PERMISSIONS = ['admin', 'kitchen', 'display', 'settings'];

function getApiBase() {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (window.location.port === '5173') {
    return `${window.location.protocol}//${window.location.hostname}:8081`;
  }
  return window.location.origin;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_TOKEN));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem(STORAGE_USER));
  const [permissions, setPermissions] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_PERMISSIONS);
      return stored ? JSON.parse(stored) : ALL_PERMISSIONS;
    } catch {
      return ALL_PERMISSIONS;
    }
  });

  const login = async (user: string, password: string): Promise<string[]> => {
    const resp = await fetch(`${getApiBase()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });

    if (!resp.ok) {
      throw new Error('invalid_credentials');
    }

    const data = await resp.json();
    const nextToken = data.token || 'auth-disabled';
    const nextPermissions: string[] = data.permissions || ALL_PERMISSIONS;

    localStorage.setItem(STORAGE_TOKEN, nextToken);
    localStorage.setItem(STORAGE_USER, user);
    localStorage.setItem(STORAGE_PERMISSIONS, JSON.stringify(nextPermissions));
    setToken(nextToken);
    setUsername(user);
    setPermissions(nextPermissions);
    return nextPermissions;
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    localStorage.removeItem(STORAGE_PERMISSIONS);
    setToken(null);
    setUsername(null);
    setPermissions([]);
  };

  const value = useMemo(
    () => ({
      token,
      username,
      isAuthenticated: !!token,
      permissions,
      hasPermission: (perm: string) => permissions.includes(perm),
      login,
      logout,
    }),
    [token, username, permissions]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
