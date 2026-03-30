import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function ProtectedRoute({ children, permission }: { children: React.ReactElement; permission?: string }) {
  const { isAuthenticated, hasPermission } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (permission && !hasPermission(permission)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Acesso negado</h2>
          <p className="text-muted-foreground text-sm">Você não tem permissão para acessar esta página.</p>
        </div>
      </div>
    );
  }

  return children;
}
