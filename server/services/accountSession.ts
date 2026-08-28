import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function credentialVersion(user: { id: string; username: string; password_hash: string }): string {
  return createHmac('sha256', config.jwtSecret).update(JSON.stringify([user.id, user.username, user.password_hash])).digest('hex');
}
export function accountToken(user: { id: string; username: string; role: string; password_hash: string }): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, credentialVersion: credentialVersion(user) }, config.jwtSecret, { expiresIn: '7d' });
}
export function publicAccount(user: any) {
  return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, isActive: Boolean(user.is_active), createdAt: user.created_at };
}
