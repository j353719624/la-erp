import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Mail, Lock, Eye, EyeOff, AlertCircle, Building2 } from 'lucide-react';
import { authApi, LoginParams } from '@/api/auth';
import { companyApi, PublicCompany } from '@/api/company';
import { useAuthStore } from '@/store/auth';
import { http } from '@/utils/request';
import { storage } from '@/utils/storage';

export function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [formData, setFormData] = useState<LoginParams>({
    username: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // [物理保护] ref 锁：防双击/连发提交穿透（disabled 依赖渲染，双击在渲染前可并发双请求）
  const submittingRef = useRef(false);

  // 公司名称/Logo：取系统设置「公司设置」（同一来源也已用于打印抬头/客服昵称）。
  // 登录页为未登录状态，走免认证公开接口 /public/company（后端仅返回 name/logo）；
  // 未配置时降级为产品名与默认图标（2026-09-12：登录页按用户设置的公司名显示）。
  const [companyName, setCompanyName] = useState('');
  const [companyLogo, setCompanyLogo] = useState('');
  useEffect(() => {
    http.get('/v1/public/company')
      .then((res: any) => {
        const c = res?.code === 0 ? res?.data?.company : null;
        if (c?.name) setCompanyName(String(c.name).trim());
        if (c?.logo) setCompanyLogo(String(c.logo));
      })
      .catch(() => { /* 未配置/网络异常时保持产品名降级 */ });
  }, []);

  // 多公司（2026-09-17）：公司下拉（免认证公开接口）。
  // 仅当启用中的公司 ≥2 家时显示选择器——单公司部署与升级前体验完全一致；
  // 默认选中：上次登录公司（记忆）→ 默认公司 → 第一家。
  const [companies, setCompanies] = useState<PublicCompany[]>([]);
  const [companyCode, setCompanyCode] = useState('');
  useEffect(() => {
    companyApi.publicList()
      .then((res) => {
        if (res.code !== 0) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setCompanies(list);
        if (list.length > 1) {
          const remembered = storage.getCompany()?.code;
          const selected =
            list.find((c) => c.code === remembered) || list.find((c) => c.is_default) || list[0];
          setCompanyCode(selected?.code || '');
        }
      })
      .catch((err) => { console.warn('[company] 公司列表加载失败（保持单公司登录）', err); });
  }, []);
  const multiCompany = companies.length > 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return; // [物理保护] 第二击直接丢弃
    setError('');

    if (!formData.username || !formData.password) {
      setError('请输入用户名和密码');
      return;
    }
    if (multiCompany && !companyCode) {
      setError('请选择公司');
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      // [2026-09-17 手机登录修复] 用户名去首尾空格提交（手机键盘尾随空格会导致误报「用户名或密码错误」）；
      // 大小写保持原样，由输入框 autoCapitalize="none" 阻止手机键盘自动大写首字母
      const response = await authApi.login({ ...formData, username: formData.username.trim(), company: companyCode || undefined });
      if (response.code === 0) {
        login(
          response.data.user,
          response.data.access_token,
          response.data.refresh_token,
          response.data.permissions,
          response.data.need_change_password,
          response.data.company,
          response.data.company_is_default,
        );
        navigate('/dashboard');
      } else {
        setError(response.message);
      }
    } catch (err: any) {
      // [2026-09-17 审查修复] 透传拦截器兜底的中文原因（如「网络异常…」），避免只剩写死文案
      setError(err.response?.data?.message || (err instanceof Error && err.message ? err.message : '登录失败，请重试'));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* [移动端修复] 登录卡片改为实心白卡（原 bg-white/10 半透明+模糊在手机上对比度极低，卡片几乎不可见） */}
        <div className="bg-white rounded-2xl p-8 shadow-2xl border border-gray-100">
          <div className="text-center mb-8">
            {companyLogo ? (
              <img src={companyLogo} alt="logo" className="w-16 h-16 object-contain mx-auto mb-4" />
            ) : (
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                <Layers className="w-8 h-8 text-white" />
              </div>
            )}
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{companyName || 'LA-ERP 专业版'}</h1>
            <p className="text-gray-500">企业资源计划系统</p>
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg mb-6">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                <span className="text-red-600 text-sm">{error}</span>
              </div>
              {error.includes('用户名或密码错误') && (
                <p className="mt-1.5 pl-7 text-xs text-red-400">
                  提示：用户名区分大小写（手机键盘可能把首字母自动大写），且前后不能带空格
                </p>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {multiCompany && (
              <div>
                <label htmlFor="login-company" className="block text-gray-600 text-sm font-medium mb-2">公司</label>
                <div className="relative">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <select
                    id="login-company"
                    name="company"
                    value={companyCode}
                    onChange={(e) => setCompanyCode(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all appearance-none"
                  >
                    {companies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}{c.is_default ? '（默认）' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div>
              <label htmlFor="login-username" className="block text-gray-600 text-sm font-medium mb-2">用户名</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="login-username"
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  placeholder="请输入用户名"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-gray-600 text-sm font-medium mb-2">密码</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full pl-12 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2.5 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* [交互修复] 移除无功能的"记住我"与"忘记密码"死区控件（原为无 handler 的假按钮/假勾选，
              键盘党 Tab 到此处敲 Enter 无任何响应；待后端支持后再回归） */}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white font-medium rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  登录中...
                </span>
              ) : (
                '登 录'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            {/* 默认凭据提示仅在开发环境显示；打包版不得出现演示账号（生产安全） */}
            {import.meta.env.DEV && (
              <p className="text-gray-400 text-sm">开发环境默认账号：admin / admin123</p>
            )}
            <p className="text-gray-400 text-xs mt-1">首次登录后请及时修改默认密码</p>
          </div>
        </div>
      </div>
    </div>
  );
}
