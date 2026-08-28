import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Sparkles, Lock, User as UserIcon, AlertCircle, Loader2 } from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: (role: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const user = await login(username.trim(), password);
      onLoginSuccess(user.role);
    } catch (err: any) {
      setError(err?.message || 'Đăng nhập không thành công. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-12 app-bg">
      <div className="max-w-md w-full space-y-8">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="inline-block p-3 rounded-3xl bg-white shadow-soft border border-ink-100/80 mb-1">
            <img
              src="/logo-icon.png"
              alt="LilyHub"
              className="w-14 h-14 object-contain drop-shadow-sm hover:scale-105 transition-transform"
            />
          </div>
          <div>
            <h1 className="text-3xl sm:text-4xl font-serif font-bold tracking-tight">
              <span className="text-[#1E1B4B]">Lily</span>
              <span className="text-[#9333EA] font-sans font-extrabold">Beta</span>
            </h1>
            <p className="text-xs sm:text-sm text-ink-500 max-w-xs mx-auto mt-1 leading-relaxed">
              Hệ thống đọc duyệt & hiệu đính bản thảo dành riêng cho Beta Reader của LilyHub
            </p>
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-card border border-ink-100/60 space-y-6">
          <h2 className="text-lg font-semibold text-ink-900">Đăng nhập tài khoản</h2>

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-ink-700 uppercase tracking-wider">
                Tên đăng nhập
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-ink-400">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ví dụ: admin hoặc tên beta reader"
                  required
                  autoFocus
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-ink-200 focus:border-lily-500 focus:ring-1 focus:ring-lily-500 text-sm text-ink-900 placeholder:text-ink-400 transition"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-ink-700 uppercase tracking-wider">
                Mật khẩu
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-ink-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-ink-200 focus:border-lily-500 focus:ring-1 focus:ring-lily-500 text-sm text-ink-900 placeholder:text-ink-400 transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-3 px-4 rounded-xl bg-lily-600 hover:bg-lily-700 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang xác thực...</span>
                </>
              ) : (
                <span>Đăng nhập</span>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-ink-100 text-center">
            <p className="text-xs text-ink-500 leading-relaxed">
              Tài khoản Beta Reader được tạo và cấp bởi Quản trị viên LilyHub.
              <br />
              Hệ thống không mở đăng ký tự do.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
