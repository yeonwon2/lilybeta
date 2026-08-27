import React, { ReactNode, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { UserRole } from '../../types';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: UserRole;
  onRedirectToLogin: () => void;
  onNavigateHome: () => void;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredRole,
  onRedirectToLogin,
  onNavigateHome,
}) => {
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || !user)) onRedirectToLogin();
  }, [isLoading, isAuthenticated, user, onRedirectToLogin]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF8F5]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-lily-600 animate-spin" />
          <p className="text-ink-600 text-sm">Đang tải thông tin xác thực...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  if (requiredRole && user.role !== requiredRole) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#FAF8F5]">
        <div className="max-w-md w-full bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-rose-100 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-ink-900">Không có quyền truy cập</h2>
          <p className="text-sm text-ink-600">
            Trang này chỉ dành cho tài khoản có vai trò <span className="font-semibold text-rose-700">{requiredRole}</span>. Tài khoản của bạn hiện tại là <span className="font-semibold">{user.role}</span>.
          </p>
          <div className="pt-2">
            <button
              onClick={onNavigateHome}
              className="px-4 py-2 bg-lily-600 hover:bg-lily-700 text-white text-sm font-medium rounded-xl transition"
            >
              Về trang của bạn
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
