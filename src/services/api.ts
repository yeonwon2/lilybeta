const TOKEN_STORAGE_KEY = 'lilybeta_token';

import { RequestDeduplicator } from './requestDedupe';

export class ApiError extends Error {
  public status: number;
  public code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  private baseUrl = '/api';
  private memoryToken: string | null = null;
  private hasMemoryOverride = false;

  constructor(private timeoutMs = 20_000) {}

  public getToken(): string | null {
    if (this.hasMemoryOverride) return this.memoryToken;
    try {
      this.memoryToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      // Storage may be unavailable in private mode or blocked by browser policy.
    }
    return this.memoryToken;
  }

  public setToken(token: string | null): void {
    this.memoryToken = token;
    try {
      if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
      else localStorage.removeItem(TOKEN_STORAGE_KEY);
      this.hasMemoryOverride = false;
    } catch {
      // Keep this session usable even when persistence is unavailable.
      this.hasMemoryOverride = true;
    }
  }

  public clearToken(): void {
    this.setToken(null);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const controller = new AbortController();
    // Book imports may upload and persist thousands of chapters.
    const timeout = options.method === 'POST' && path === '/admin/books' ? 120_000 : this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      if (response.status === 204) return undefined as T;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new ApiError('Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.', response.ok ? 502 : response.status, 'INVALID_RESPONSE');
      }
      let data: any;
      try {
        data = await response.json();
      } catch (err) {
        if (controller.signal.aborted) throw err;
        throw new ApiError('Không thể đọc phản hồi từ máy chủ. Vui lòng thử lại.', 502, 'INVALID_RESPONSE');
      }
      if (!response.ok) {
        throw new ApiError(data?.error || response.statusText, response.status, data?.code);
      }
      return data as T;
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ApiError('Máy chủ phản hồi quá lâu. Vui lòng thử lại. Nếu vừa lưu dữ liệu, hãy kiểm tra trạng thái trước khi gửi lại.', 408, 'REQUEST_TIMEOUT');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  public get<T>(path: string, options?: { dedupe?: boolean }): Promise<T> {
    if (options?.dedupe === false) {
      return this.request<T>(path, { method: 'GET' });
    }
    const token = this.getToken() || 'anon';
    const key = `GET:${token}:${path}`;
    return RequestDeduplicator.dedupe(key, () => this.request<T>(path, { method: 'GET' }));
  }

  public post<T>(path: string, body?: any): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public patch<T>(path: string, body?: any): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
