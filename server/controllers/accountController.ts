import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { queryOne, transaction } from '../db/database.js';
import { accountToken, publicAccount } from '../services/accountSession.js';

export async function updateAdminAccount(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  const { currentPassword, username, newPassword, confirmPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 1000 || (username !== undefined && typeof username !== 'string') || (newPassword !== undefined && typeof newPassword !== 'string')) {
    res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại và thông tin hợp lệ.' }); return;
  }
  // The account is always taken from the authenticated session, never a body-supplied ID/role.
  const user = await queryOne<any>('SELECT * FROM profiles WHERE id = ?', req.user!.id);
  if (!user || user.role !== 'ADMIN' || !user.is_active) { res.status(403).json({ error: 'Tài khoản Admin không còn hoạt động.' }); return; }
  if (!await bcrypt.compare(currentPassword, user.password_hash)) { res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác.' }); return; }
  const nextUsername = username === undefined ? user.username : username.trim().toLowerCase();
  const changePassword = typeof newPassword === 'string' && newPassword !== '';
  if (nextUsername !== user.username && !/^[\p{L}\p{N}_.-]{3,50}$/u.test(nextUsername)) {
    res.status(400).json({ error: 'Tên đăng nhập cần 3–50 ký tự: chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.' }); return;
  }
  if (changePassword && (newPassword.length < 12 || !newPassword.trim() || Buffer.byteLength(newPassword, 'utf8') > 72)) {
    res.status(400).json({ error: 'Mật khẩu mới cần ít nhất 12 ký tự và không vượt 72 byte UTF-8.' }); return;
  }
  if (changePassword && confirmPassword !== newPassword) { res.status(400).json({ error: 'Mật khẩu xác nhận không khớp.' }); return; }
  if (changePassword && await bcrypt.compare(newPassword, user.password_hash)) { res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại.' }); return; }
  if (nextUsername === user.username && !changePassword) { res.status(400).json({ error: 'Bạn chưa thay đổi thông tin nào.' }); return; }
  // Rotate the salt even on rename, so restoring an old username cannot revive old tokens.
  const nextHash = await bcrypt.hash(changePassword ? newPassword : currentPassword, 10);
  try {
    await transaction(async tx => {
      const duplicate = await tx.queryOne('SELECT id FROM profiles WHERE lower(username) = ? AND id <> ?', nextUsername, user.id);
      if (duplicate) throw Object.assign(new Error('Tên đăng nhập đã được sử dụng.'), { status: 409 });
      const result = await tx.run('UPDATE profiles SET username = ?, password_hash = ?, updated_at = ? WHERE id = ? AND username = ? AND password_hash = ? AND role = ? AND is_active = TRUE', nextUsername, nextHash, new Date().toISOString(), user.id, user.username, user.password_hash, 'ADMIN');
      if (result.changes !== 1) throw Object.assign(new Error('Thông tin tài khoản vừa thay đổi. Đăng nhập lại rồi thử lại.'), { status: 409 });
      // This event also revokes pre-upgrade tokens that have no credentialVersion claim.
      // Never log password values, hashes, or tokens.
      await tx.run('INSERT INTO beta_activity_logs (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)', randomUUID(), user.id, 'ADMIN_ACCOUNT_CHANGED', JSON.stringify({ usernameChanged: nextUsername !== user.username, passwordChanged: changePassword }), new Date().toISOString());
    });
  } catch (error: any) {
    if (error.status === 409 || error.code === '23505' || /UNIQUE constraint/.test(error.message || '')) { res.status(409).json({ error: error.status === 409 ? error.message : 'Tên đăng nhập đã được sử dụng.' }); return; }
    throw error;
  }
  const updated = { ...user, username: nextUsername, password_hash: nextHash };
  res.json({ token: accountToken(updated), user: publicAccount(updated) });
}
