import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { api, ApiError } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  sessionError: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isBetaReader: boolean;
  login: (username: string, password: string) => Promise<User>;
  updateAdminAccount: (input: { username: string; currentPassword: string; newPassword?: string; confirmPassword?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => api.getToken());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [sessionError, setSessionError] = useState<string | null>(null);

  const refreshUser = async () => {
    setIsLoading(true);
    setSessionError(null);
    const currentToken = api.getToken();
    if (!currentToken) {
      setUser(null);
      setToken(null);
      setIsLoading(false);
      return;
    }

    try {
      const res = await api.get<{ user: User }>('/auth/me');
      setUser(res.user);
      setToken(currentToken);
    } catch (err: any) {
      console.warn('[Auth] Session restore failed:', err?.message);
      if (err instanceof ApiError && err.status === 401) {
        api.clearToken();
        setUser(null);
        setToken(null);
      } else {
        setSessionError(err?.message || 'Không thể kết nối máy chủ. Vui lòng thử lại.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { username, password });
    api.setToken(res.token);
    setToken(res.token);
    setUser(res.user);
    setSessionError(null);
    return res.user;
  };

  const updateAdminAccount: AuthContextType['updateAdminAccount'] = async (input) => {
    const res = await api.patch<{ token: string; user: User }>('/admin/account', input);
    api.setToken(res.token);
    setToken(res.token);
    setUser(res.user);
    setSessionError(null);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Ignore network errors on logout
    } finally {
      api.clearToken();
      setToken(null);
      setUser(null);
    }
  };

  const isAuthenticated = Boolean(user && token);
  const isAdmin = user?.role === 'ADMIN';
  const isBetaReader = user?.role === 'BETA_READER';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        sessionError,
        isAuthenticated,
        isAdmin,
        isBetaReader,
        login,
        updateAdminAccount,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
