import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children, tenantKey: urlTenantKey }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tenantKey, setTenantKey] = useState(urlTenantKey || null);

  const checkSession = useCallback(async () => {
    try {
      const response = await authAPI.getCurrentUser();
      setUser(response.data.user);
      if (response.data.user?.tenantKey) {
        setTenantKey(response.data.user.tenantKey);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = async (username, password) => {
    // Don't send tenantKey in body — let backend auto-resolve from Futursoft.
    // Explicit tenant key is sent via X-Tenant-Key header (from URL) by the API interceptor.
    const response = await authAPI.login({ username, password });
    setUser(response.data.user);
    if (response.data.user?.tenantKey) {
      setTenantKey(response.data.user.tenantKey);
    }
    return response.data.user;
  };

  const logout = async () => {
    try {
      await authAPI.logout();
    } catch {
      // ignore logout errors
    }
    setUser(null);
  };

  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{ user, loading, isAuthenticated, login, logout, tenantKey }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
