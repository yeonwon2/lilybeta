import React, { useState, useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminReviewWorkspace = lazy(() => import('./pages/admin/review/AdminReviewWorkspace').then(m => ({ default: m.AdminReviewWorkspace })));
const BetaDashboard = lazy(() => import('./pages/beta/BetaDashboard').then(m => ({ default: m.BetaDashboard })));
const BetaBookDetail = lazy(() => import('./pages/beta/BetaBookDetail').then(m => ({ default: m.BetaBookDetail })));
const BetaReaderView = lazy(() => import('./pages/beta/BetaReaderView').then(m => ({ default: m.BetaReaderView })));

export const AppContent: React.FC = () => {
  const { user, isAuthenticated, isLoading, sessionError, refreshUser } = useAuth();
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname || '/');

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Redirect root based on auth status and role
  useEffect(() => {
    if (!isLoading && !sessionError) {
      if (!isAuthenticated) {
        if (currentPath !== '/login') {
          navigate('/login');
        }
      } else if (currentPath === '/' || currentPath === '/login') {
        if (user?.role === 'ADMIN') {
          navigate('/admin');
        } else {
          navigate('/beta');
        }
      }
    }
  }, [isLoading, isAuthenticated, user?.role, currentPath, sessionError]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF8F5]">
        <div className="w-8 h-8 rounded-full border-2 border-lily-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (sessionError) {
    return (
      <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-bold">Không thể khôi phục phiên đăng nhập</h1>
        <p>{sessionError}</p>
        <button className="px-4 py-2 rounded-xl bg-purple-900 text-white" onClick={() => void refreshUser()}>Thử lại</button>
      </div>
    );
  }

  // 1. Login Page
  if (currentPath === '/login') {
    return (
      <LoginPage
        onLoginSuccess={(role) => {
          if (role === 'ADMIN') {
            navigate('/admin');
          } else {
            navigate('/beta');
          }
        }}
      />
    );
  }

  // 2a. Admin Review Workspace: /admin/books/:bookId/review/:chapterIndex?
  const reviewMatch = currentPath.match(/^\/admin\/books\/([^/]+)\/review(?:\/(\d+))?$/);
  if (reviewMatch) {
    const bookId = reviewMatch[1];
    const chapterIndex = reviewMatch[2] ? parseInt(reviewMatch[2], 10) : 1;
    return (
      <ProtectedRoute
        requiredRole="ADMIN"
        onRedirectToLogin={() => navigate('/login')}
        onNavigateHome={() => navigate('/beta')}
      >
        <AdminReviewWorkspace
          bookId={bookId}
          initialChapterIndex={chapterIndex}
          onBack={() => navigate('/admin')}
        />
      </ProtectedRoute>
    );
  }

  // 2b. Admin Dashboard (/admin)
  if (currentPath.startsWith('/admin')) {
    return (
      <ProtectedRoute
        requiredRole="ADMIN"
        onRedirectToLogin={() => navigate('/login')}
        onNavigateHome={() => navigate('/beta')}
      >
        <AdminDashboard onNavigate={navigate} />
      </ProtectedRoute>
    );
  }

  // 3. Reader View: /beta/books/:bookId/read/:chapterIndex
  const readMatch = currentPath.match(/^\/beta\/books\/([^/]+)\/read\/(\d+)$/);
  if (readMatch) {
    const bookId = readMatch[1];
    const chapterIndex = parseInt(readMatch[2], 10) || 1;
    return (
      <ProtectedRoute
        onRedirectToLogin={() => navigate('/login')}
        onNavigateHome={() => navigate('/beta')}
      >
        <BetaReaderView
          bookId={bookId}
          initialChapterIndex={chapterIndex}
          onBackToBook={() => navigate(`/beta/books/${bookId}`)}
        />
      </ProtectedRoute>
    );
  }

  // 4. Book Detail: /beta/books/:bookId
  const bookDetailMatch = currentPath.match(/^\/beta\/books\/([^/]+)$/);
  if (bookDetailMatch) {
    const bookId = bookDetailMatch[1];
    return (
      <ProtectedRoute
        onRedirectToLogin={() => navigate('/login')}
        onNavigateHome={() => navigate('/beta')}
      >
        <BetaBookDetail
          bookId={bookId}
          onBack={() => navigate('/beta')}
          onOpenChapter={(chapterIndex) => navigate(`/beta/books/${bookId}/read/${chapterIndex}`)}
        />
      </ProtectedRoute>
    );
  }

  // 5. Beta Dashboard: /beta
  return (
    <ProtectedRoute
      onRedirectToLogin={() => navigate('/login')}
      onNavigateHome={() => navigate(user?.role === 'ADMIN' ? '/admin' : '/beta')}
    >
      <BetaDashboard onSelectBook={(bookId) => navigate(`/beta/books/${bookId}`)} />
    </ProtectedRoute>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <Suspense fallback={<div role="status" className="min-h-screen flex items-center justify-center">Đang tải trang...</div>}>
        <AppContent />
      </Suspense>
    </AuthProvider>
  );
};
