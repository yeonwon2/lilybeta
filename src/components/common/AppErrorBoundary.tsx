import React, { Component, type ErrorInfo, type ReactNode } from 'react';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[LilyBeta render error]', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="font-bold text-xl">Không thể hiển thị trang</h1>
          <p>Vui lòng tải lại trang. Bản nháp đã lưu trên thiết bị sẽ được giữ nguyên.</p>
          <button className="px-4 py-2 rounded-xl bg-purple-900 text-white" onClick={() => window.location.reload()}>Tải lại trang</button>
        </div>
      );
    }
    return this.props.children;
  }
}
