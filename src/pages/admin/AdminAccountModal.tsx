import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export function AdminAccountModal({ onClose }: { onClose: () => void }) {
  const { user, updateAdminAccount } = useAuth();
  const [username, setUsername] = useState(user?.username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setError('');
    if (newPassword !== confirmPassword) { setError('Mật khẩu xác nhận không khớp.'); return; }
    setBusy(true);
    try {
      await updateAdminAccount({ username, currentPassword, newPassword, confirmPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setSuccess(true);
    } catch (err: any) { setError(err.message || 'Không thể lưu. Nếu mất kết nối, thử đăng nhập bằng thông tin mới để kiểm tra.'); }
    finally { setBusy(false); }
  }
  const inputStyle = 'w-full border border-ink-200 rounded-xl px-3 py-2.5 text-base focus:border-purple-500';
  return <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Tài khoản Admin">
    <section className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[90dvh] overflow-auto">
      <h2 className="font-bold text-lg mb-2">Tài khoản Admin</h2>
      {success ? <><p role="status" className="text-sm text-green-800 my-4">Đã cập nhật thông tin đăng nhập. Các phiên đăng nhập cũ đã hết hiệu lực. Truyện và tài khoản Beta Reader không thay đổi.</p><button className="px-4 py-2 rounded-xl bg-purple-700 text-white" onClick={onClose}>Đóng</button></> : <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-ink-500">Thay đổi tài khoản đang đăng nhập. Để trống mật khẩu mới nếu chỉ đổi tên đăng nhập.</p>
        <label className="block text-sm">Tên đăng nhập<input autoFocus className={inputStyle} autoComplete="username" required minLength={3} maxLength={50} value={username} disabled={busy} onChange={e => setUsername(e.target.value)} /></label>
        <label className="block text-sm">Mật khẩu hiện tại<input className={inputStyle} type="password" autoComplete="current-password" required value={currentPassword} disabled={busy} onChange={e => setCurrentPassword(e.target.value)} /></label>
        <label className="block text-sm">Mật khẩu mới (không bắt buộc)<input className={inputStyle} type="password" autoComplete="new-password" minLength={12} placeholder="Ít nhất 12 ký tự" value={newPassword} disabled={busy} onChange={e => setNewPassword(e.target.value)} /></label>
        <label className="block text-sm">Nhập lại mật khẩu mới<input className={inputStyle} type="password" autoComplete="new-password" required={!!newPassword} value={confirmPassword} disabled={busy} onChange={e => setConfirmPassword(e.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose}>Hủy</button><button type="submit" disabled={busy} className="px-4 py-2 bg-purple-700 text-white rounded-xl disabled:opacity-50">{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button></div>
      </form>}
    </section>
  </div>;
}
