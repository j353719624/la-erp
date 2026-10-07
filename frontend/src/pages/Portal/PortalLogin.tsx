import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Lock, User, AlertCircle } from 'lucide-react';
import { portalApi } from '@/api/portal';
import { portalStorage } from '@/utils/request';

export function PortalLogin() {
  const navigate = useNavigate();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError('');
    if (!account || !password) {
      setError('请输入账号和密码');
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      // [2026-09-17 手机登录修复] 账号去首尾空格提交（手机键盘尾随空格会误报「账号或密码错误」）
      const res = await portalApi.login(account.trim(), password);
      if (res.code === 0 && res.data?.access_token) {
        portalStorage.setToken(res.data.access_token);
        if (res.data.customer_id) portalStorage.setCustomerId(res.data.customer_id);
        if (res.data.customer_name) portalStorage.setCustomerName(res.data.customer_name);
        navigate('/portal');
      } else {
        setError(res.message || '登录失败');
      }
    } catch (err: any) {
      setError(err.message || '登录失败，请重试');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="portal-shell min-h-screen bg-gradient-to-br from-teal-900 via-teal-800 to-cyan-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* [移动端修复] 登录卡片改为实心白卡（原 bg-white/10 半透明+模糊在手机上对比度极低，卡片几乎不可见） */}
        <div className="bg-white rounded-2xl p-8 shadow-2xl border border-gray-100">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <Store className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">客户自助下单</h1>
            <p className="text-gray-500">浏览商品 · 在线下单 · 订单跟踪</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg mb-6">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
              <span className="text-sm text-red-600">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">登录账号</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={account}
                  onChange={e => setAccount(e.target.value)}
                  placeholder="请输入管理员为您开通的账号"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">登录密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
            >
              {loading ? '登录中...' : '进入商城'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => navigate('/login')}
              className="text-sm text-teal-600 hover:text-teal-800 underline"
            >
              企业内部人员登录 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
