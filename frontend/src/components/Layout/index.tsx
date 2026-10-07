import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from 'antd';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from '@/components/CommandPalette';
import { useAppStore } from '@/store/app';
import { useAuthStore } from '@/store/auth';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { http } from '@/utils/request';

interface LayoutProps {
  children: React.ReactNode;
}

// 客服通 kefu-widget 单例初始化标志（SPA 生命周期内只 init 一次；
// 模块级变量跨 Layout 挂载保持，避免路由切换重复绑定 trigger）
let kefuWidgetInited = false;

export function Layout({ children }: LayoutProps) {
  const { sidebarCollapsed, mobileMenuOpen, setSidebarCollapsed } = useAppStore();
  const needChangePassword = useAuthStore((s) => s.needChangePassword);
  const navigate = useNavigate();

  // 三档布局（支持手机横屏/平板，便于录入与阅读）：
  //  <768px          手机竖屏/窄屏：抽屉式侧栏（汉堡触发）
  //  768~1199px      手机横屏/平板/小窗：固定“图标窄侧栏”(64px) 且自动折叠，内容最大化
  //  >=1200px        桌面/大屏：完整侧栏（用户可自行折叠/展开）
  const isMobile = !useMediaQuery('(min-width: 768px)');
  const isDesktopWide = useMediaQuery('(min-width: 1200px)');

  // 中等宽度（横屏手机/平板）自动进入折叠态，充分利用宽度；
  // 回到大屏(>=1200)时若此前是系统自动折叠则恢复展开（用户手动折叠则不干预）
  const autoCollapsedForNarrow = useRef(false);
  useEffect(() => {
    if (!isMobile && !isDesktopWide) {
      // 仅“原本展开”时才记录为系统自动折叠（回大屏自动恢复展开）；
      // 用户手动折叠的（刷新后仍折叠）不在此列，避免回大屏被强行展开（2026-09-12）
      if (!useAppStore.getState().sidebarCollapsed) {
        setSidebarCollapsed(true);
        autoCollapsedForNarrow.current = true;
      }
    } else if (isDesktopWide && autoCollapsedForNarrow.current) {
      setSidebarCollapsed(false);
      autoCollapsedForNarrow.current = false;
    }
  }, [isMobile, isDesktopWide, setSidebarCollapsed]);

  // 公司信息（打印抬头/客服昵称同源）+「个人模式」开关：**独立于客服控件**拉取。
  // [2026-09-22 审查修复] 此前这两件事写在同一个 effect 里，且被 `if (!KefuWidget?.init) return`
  // 挡住——客服脚本缺失/被拦截时 personalMode 永不写入 → 审批入口不收敛；
  // 又因 `kefuWidgetInited` 一次性守卫 + 登出不重置，SPA 内换公司/重登会残留旧值。
  // 现在：单独 effect + 依赖 用户名/公司（登录/切公司即重拉），失败安全回退「标准模式」。
  const authUser = useAuthStore((s) => s.user);
  const authCompany = useAuthStore((s) => s.company);
  const [companyInfo, setCompanyInfo] = useState<{ loaded: boolean; name: string }>({ loaded: false, name: '' });
  useEffect(() => {
    let cancelled = false;
    // 仅认证可读（完整 /v1/settings 需 system 权限，无权限角色会被 403 误踢）
    http
      .get('/v1/settings/company')
      .then((res: any) => {
        if (cancelled) return;
        const ok = res?.code === 0;
        setCompanyInfo({
          loaded: true,
          name: ok && res.data?.company?.name ? String(res.data.company.name).trim() : '',
        });
        // 「个人模式」全站唯一分发点（业务员没有 setting 权限，读不到完整 /v1/settings），
        // 写入 app store 供侧边栏/单据页做 UI 收敛（隐藏审批入口）
        useAppStore.getState().setPersonalMode(ok && res.data?.personal_mode === true);
      })
      .catch(() => {
        if (cancelled) return;
        // 拉取失败 → 安全回退「标准模式」（宁可不收敛，也不误隐藏审批入口）
        setCompanyInfo({ loaded: true, name: '' });
        useAppStore.getState().setPersonalMode(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authUser?.username, authCompany]);

  // 接入客服通客服浮窗：source=erp（客服后台显示 [专业版ERP]）+ 自动携带本机机器码
  // 身份昵称 = 公司名称(系统设置「公司设置」，与打印抬头同源)-登录用户名：
  // 客服端一眼分辨是哪家公司/哪位在咨询；服务端来源稳定（localStorage 清理/换机不失效）；
  // 用户在客服页自行改名后（localStorage 记忆）优先于此系统身份
  useEffect(() => {
    if (kefuWidgetInited || !companyInfo.loaded) return;
    const KefuWidget = window.KefuWidget;
    if (!KefuWidget?.init) return;
    kefuWidgetInited = true;
    const user = useAuthStore.getState().user;
    const baseNick = user?.name || user?.username || '';
    const companyName = companyInfo.name;
    KefuWidget.init({
      source: 'erp',
      trigger: '.kefu-trigger',
      machineUrl: '/api/v1/license/machine-code',
      // uid=登录用户名：集中部署/同机多人时客服会话按 uid 隔离(机器码是服务器/共用的, 防串台)
      uid: user?.username || '',
      nickname: companyName ? (baseNick ? companyName + '-' + baseNick : companyName) : baseNick,
    });
  }, [companyInfo]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar isMobile={isMobile} isCompact={!isMobile && !isDesktopWide} />
      <Header isMobile={isMobile} />
      {/* 移动端抽屉打开时遮罩背景，锁定滚动 */}
      {isMobile && mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => useAppStore.getState().setMobileMenuOpen(false)}
        />
      )}
      <main
        className={`pt-16 transition-all duration-300 min-w-0 ${
          !isMobile ? (sidebarCollapsed ? 'ml-20' : 'ml-64') : 'ml-0'
        }`}
      >
        <div className="p-4 md:p-6 pb-[calc(6rem+env(safe-area-inset-bottom))]">
          {needChangePassword && (
            <Alert
              type="warning"
              showIcon
              className="mb-4"
              message="您正在使用系统默认密码（admin123），为保障数据安全请尽快修改"
              action={
                <button
                  type="button"
                  className="text-blue-600 hover:text-blue-700 font-medium"
                  onClick={() => navigate('/profile')}
                >
                  立即修改
                </button>
              }
            />
          )}
          {children}
        </div>
      </main>

      {/* 命令面板（易用性 P1）：Ctrl/⌘+K 唤起，输入关键词直接跳到任意功能页 */}
      <CommandPalette />
    </div>
  );
}
