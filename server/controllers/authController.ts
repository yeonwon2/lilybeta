import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { queryOne, run } from '../db/database.js';
import { accountToken } from '../services/accountSession.js';

export const login = async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Vui lòng điền đầy đủ tên đăng nhập và mật khẩu' });
    return;
  }

  const cleanUsername = String(username).trim().toLowerCase();
  const user = await queryOne<any>(
    'SELECT * FROM profiles WHERE lower(username) = ?',
    cleanUsername
  );

  if (!user) {
    res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
    return;
  }

  const isMatch = bcrypt.compareSync(password, user.password_hash);
  if (!isMatch) {
    res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
    return;
  }

  if (!user.is_active) {
    res.status(403).json({ error: 'Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ Quản trị viên.' });
    return;
  }

  const token = accountToken(user);

  // Log activity
  try {
    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const detailsObj = { ip: req.ip, userAgent: req.headers['user-agent'] };
    await run(
      'INSERT INTO beta_activity_logs (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)',
      logId,
      user.id,
      'LOGIN',
      JSON.stringify(detailsObj),
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Failed to write activity log:', err);
  }

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      isActive: Boolean(user.is_active),
      createdAt: user.created_at,
    },
  });
};

export const me = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Chưa đăng nhập' });
    return;
  }

  const user = await queryOne<any>(
    'SELECT id, username, display_name, role, is_active, created_at, updated_at FROM profiles WHERE id = ?',
    req.user.id
  );

  if (!user || !user.is_active) {
    res.status(401).json({ error: 'Tài khoản không tồn tại hoặc đã bị vô hiệu hóa' });
    return;
  }

  res.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      isActive: Boolean(user.is_active),
      createdAt: user.created_at,
    },
  });
};

export const logout = (_req: Request, res: Response): void => {
  res.json({ success: true, message: 'Đăng xuất thành công' });
};
