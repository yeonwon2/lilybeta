import { credentialVersion } from '../services/accountSession.js';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../db/database.js';
import { config } from '../config.js';

export const JWT_SECRET = config.jwtSecret;

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'BETA_READER';
  isActive: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Chưa đăng nhập hoặc thiếu mã xác thực' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; role: string; credentialVersion?: string };
    
    // Always query database to verify fresh status and check if account has been disabled
    const userRow = await queryOne<any>(
      'SELECT id, username, display_name, role, is_active, password_hash FROM profiles WHERE id = ?',
      payload.id
    );

    if (!userRow) {
      res.status(401).json({ error: 'Tài khoản không tồn tại' });
      return;
    }

    if (!userRow.is_active) {
      res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ Quản trị viên.' });
      return;
    }

    const obsoleteSession = payload.credentialVersion
      ? payload.credentialVersion !== credentialVersion(userRow)
      : userRow.role === 'ADMIN' && !!await queryOne('SELECT id FROM beta_activity_logs WHERE user_id = ? AND action = ? LIMIT 1', userRow.id, 'ADMIN_ACCOUNT_CHANGED');
    if (obsoleteSession) {
      res.status(401).json({ error: 'Thông tin đăng nhập đã thay đổi. Vui lòng đăng nhập lại.' });
      return;
    }

    req.user = {
      id: userRow.id,
      username: userRow.username,
      displayName: userRow.display_name,
      role: userRow.role,
      isActive: Boolean(userRow.is_active),
    };

    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' });
    } else {
      next(err);
    }
  }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user || req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền thực hiện thao tác này' });
    return;
  }
  next();
};

/**
 * IDOR Defense Firewall:
 * Ensures only ADMIN or explicitly assigned BETA_READER with ACTIVE assignment can access book/chapter data.
 */
export const requireBookAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Yêu cầu đăng nhập' });
    return;
  }

  // Admin has universal access
  if (req.user.role === 'ADMIN') {
    next();
    return;
  }

  const bookId = req.params.id || req.params.bookId;
  if (!bookId) {
    res.status(400).json({ error: 'Thiếu mã nhận diện tác phẩm' });
    return;
  }

  // Check assignment strictly in database with status ACTIVE
  const assignment = await queryOne(
    'SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status = ?',
    bookId,
    req.user.id,
    'ACTIVE'
  );

  if (!assignment) {
    res.status(403).json({ 
      error: 'Truy cập bị từ chối: Bạn không có phân công hoạt động đối với tác phẩm này.',
      code: 'FORBIDDEN_BOOK_ACCESS'
    });
    return;
  }

  next();
};
