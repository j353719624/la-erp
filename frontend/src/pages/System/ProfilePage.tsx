import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, User as UserIcon, Palette, Zap, ArrowUp, ArrowDown, X } from 'lucide-react';
import { Segmented, Select } from 'antd';
import { message } from '@/utils/appMessage';
import { useAuthStore } from '@/store/auth';
import { useAppStore } from '@/store/app';
import { http } from '@/utils/request';
import { PageHeader } from '@/components/PageHeader';
import {
  PAGE_SIZE_CHOICES,
  readPreferences,
  writePreferences,
  type Density,
  type ThemeMode,
} from '@/utils/preferences';
import {
  QUICK_LINKS_MAX,
  quickLinkOptions,
  readQuickLinks,
  saveQuickLinks,
  type QuickLink,
} from '@/utils/quickLinks';

export function ProfilePage() {
  const navigate = useNavigate();
  const location = useLocation();
  // [2026-09-16] 从任意页面进的个人中心都能原路返回（顶栏头像入口来自各处）；
  // 直接打开 /profile（无导航历史）时回仪表盘，避免 navigate(-1) 退无可退
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/dashboard'));
  const { user } = useAuthStore();
  // [P-01 2026-09-13] 界面偏好：主题三态 / 表格密度 / 默认每页条数（即时生效 + 存本机）
  const { theme, setTheme, density, setDensity, personalMode } = useAppStore();
  const [pageSize, setPageSize] = useState<number>(() => readPreferences().pageSize);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handlePageSize = (size: number) => {
    writePreferences({ pageSize: size });
    setPageSize(size);
    message.success(size > 0 ? `默认每页 ${size} 条（下次打开列表页生效）` : '已改为跟随各列表页默认');
  };

  const handleResetPreferences = () => {
    setTheme('light');
    setDensity('comfortable');
    writePreferences({ pageSize: 0 });
    setPageSize(0);
    message.success('已恢复默认偏好（浅色 / 舒适 / 跟随各页默认）');
  };

  // [P-05 2026-09-14] 我的快捷方式：配置顶栏「首页」旁的常用入口（本机存储，最多 6 个，保存即刷新顶栏）
  const { permissions } = useAuthStore();
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>(() => readQuickLinks());
  const has = (code?: string) => !code || permissions.includes('*') || permissions.includes(code);
  const quickOptions = useMemo(() => quickLinkOptions(has, personalMode), [permissions, personalMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const persistQuick = (next: QuickLink[]) => {
    setQuickLinks(next);
    saveQuickLinks(next);
    message.success('已保存，顶栏快捷方式已刷新');
  };
  const addQuickLink = (path: string) => {
    const opt = quickOptions.find((o) => o.path === path);
    if (!opt) return;
    persistQuick([...quickLinks, opt]);
  };
  const removeQuickLink = (index: number) => persistQuick(quickLinks.filter((_, i) => i !== index));
  const moveQuickLink = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= quickLinks.length) return;
    const next = [...quickLinks];
    [next[index], next[j]] = [next[j], next[index]];
    persistQuick(next);
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) {
      message.warning('请填写完整密码信息');
      return;
    }
    if (newPassword.length < 6) {
      message.warning('新密码至少 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      message.warning('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      const res = await http.post('/v1/users/change-password', {
        old_password: oldPassword,
        new_password: newPassword,
      });
      if (res.code === 0) {
        message.success('密码修改成功，请重新登录');
        // [FIX-Rev] F5：改密成功后清除“默认密码”提示标志
        useAuthStore.getState().setNeedChangePassword(false);
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        message.error(res.message || '修改失败');
      }
    } catch (err) {
message.error(err instanceof Error && err.message ? err.message : '修改失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="个人中心" subtitle="账户信息与安全设置" onBack={goBack} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-5 flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-blue-500" />
            账户信息
          </h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                <UserIcon className="w-8 h-8 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-gray-800">{user?.name || user?.username}</p>
                <p className="text-sm text-gray-400">{user?.role?.name || '—'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <p className="text-xs text-gray-400">用户名</p>
                <p className="text-sm text-gray-700 mt-1">{user?.username}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">邮箱</p>
                <p className="text-sm text-gray-700 mt-1">{user?.email || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">手机号</p>
                <p className="text-sm text-gray-700 mt-1">{user?.phone || '—'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-5 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-500" />
            修改密码
          </h2>
          <div className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">当前密码</label>
              <input
                type="password"
                value={oldPassword}
                onChange={e => setOldPassword(e.target.value)}
                className="form-input"
                placeholder="请输入当前密码"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">新密码</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="form-input"
                placeholder="至少 6 位"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">确认新密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="form-input"
                placeholder="再次输入新密码"
              />
            </div>
            <button onClick={handleChangePassword} disabled={saving} className="btn-primary">
              {saving ? '提交中...' : '修改密码'}
            </button>
          </div>
        </div>
      </div>

      {/* [P-01 2026-09-13] 界面偏好：个人级设置（存本机，不跨设备同步）；改完即时生效 */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-5 flex items-center gap-2">
          <Palette className="w-5 h-5 text-purple-500" />
          界面偏好
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">主题</label>
            <Segmented
              value={theme}
              onChange={(v) => setTheme(v as ThemeMode)}
              options={[
                { label: '浅色', value: 'light' },
                { label: '深色', value: 'dark' },
                { label: '跟随系统', value: 'system' },
              ]}
            />
            <p className="text-xs text-gray-400 mt-2">
              「跟随系统」会随 Windows/手机深色模式实时切换；头部月亮/太阳按钮为快捷开关（会退出跟随系统）。
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">表格密度</label>
            <Segmented
              value={density}
              onChange={(v) => setDensity(v as Density)}
              options={[
                { label: '舒适', value: 'comfortable' },
                { label: '紧凑', value: 'compact' },
              ]}
            />
            <p className="text-xs text-gray-400 mt-2">紧凑模式压低表格行高，一屏多看几行（客户门户不受影响）。</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">默认每页条数</label>
            <Select
              value={pageSize}
              onChange={handlePageSize}
              style={{ width: 200 }}
              options={[
                { value: 0, label: '跟随各页默认' },
                ...PAGE_SIZE_CHOICES.map((n) => ({ value: n, label: `${n} 条/页` })),
              ]}
            />
            <p className="text-xs text-gray-400 mt-2">对列表页生效（URL 未指定每页条数时）；分页条上的切换依然优先。</p>
          </div>
        </div>
        <div className="mt-5 pt-4 border-t border-gray-100">
          <button onClick={handleResetPreferences} className="btn-secondary">恢复默认偏好</button>
        </div>
      </div>

      {/* [P-05 2026-09-14] 我的快捷方式：配置顶栏「首页」右侧的常用入口（本机存储，最多 6 个） */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Zap className="w-5 h-5 text-indigo-500" />
          我的快捷方式
        </h2>
        <p className="text-xs text-gray-400 mb-5">
          最多 {QUICK_LINKS_MAX} 个，显示在顶栏「首页」右侧（手机/窄屏收在 ⚡ 菜单里）；点击直达，按顺序排列。仅保存在本机浏览器，不随账号同步。
        </p>
        <div className="max-w-3xl space-y-3">
          <Select
            showSearch
            value={null}
            placeholder={
              quickLinks.length >= QUICK_LINKS_MAX
                ? `已达上限（${QUICK_LINKS_MAX} 个），请先移除再加`
                : '搜索并添加常用页面（如：销售订单、库存流水）'
            }
            style={{ width: 360, maxWidth: '100%' }}
            disabled={quickLinks.length >= QUICK_LINKS_MAX}
            options={quickOptions
              .filter((o) => !quickLinks.some((l) => l.path === o.path))
              .map((o) => ({ value: o.path, label: `${o.label} · ${o.path}` }))}
            onChange={(path) => addQuickLink(path)}
            filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          />
          {quickLinks.length === 0 ? (
            <p className="text-sm text-gray-400">尚未配置——从上方下拉选择常用页面添加（仅显示你有权限访问的菜单）。</p>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
              {quickLinks.map((l, i) => (
                <li key={l.path} className="flex items-center gap-2 px-3 py-2 bg-white">
                  <span className="text-sm text-gray-700 flex-1 truncate">
                    {l.label}
                    <span className="text-xs text-gray-400 ml-2">{l.path}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => moveQuickLink(i, -1)}
                    disabled={i === 0}
                    className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="上移"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveQuickLink(i, 1)}
                    disabled={i === quickLinks.length - 1}
                    className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="下移"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeQuickLink(i)}
                    className="p-1 text-gray-400 hover:text-red-600"
                    title="移除"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
