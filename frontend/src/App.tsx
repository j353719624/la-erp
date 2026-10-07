import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AppRoutes } from '@/routes';
import { useAuthStore } from '@/store/auth';
import { useAppStore } from '@/store/app';
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import { bindMessage } from '@/utils/appMessage';
import { bindModalConfirm } from '@/utils/confirm';

/**
 * 把 App context 里的 message / modal 实例绑定给全局工具模块：
 *  - `@/utils/appMessage` 的 message：消除 antd 静态方法告警（700+ 处调用写法不变）
 *  - `@/utils/confirm` 的 confirmAction：确认弹窗也能消费主题/暗色模式
 */
function MessageBridge() {
  const { message, modal } = AntdApp.useApp();
  useEffect(() => {
    bindMessage(message);
    bindModalConfirm(modal.confirm as unknown as Parameters<typeof bindModalConfirm>[0]);
  }, [message, modal]);
  return null;
}

function App() {
  const { initAuth, refreshPermissions } = useAuthStore();
  const { theme, initTheme } = useAppStore();

  useEffect(() => {
    initAuth();
    initTheme();
    // 启动时刷新权限快照：系统升级新增权限码/管理员调整角色后，刷新页面即生效（无需重新登录）
    void refreshPermissions();
  }, [initAuth, initTheme, refreshPermissions]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          // 与 Tailwind blue-600 统一，保证 AntD 组件（确认弹窗/message/Popconfirm）与全局品牌色一致
          colorPrimary: '#2563eb',
          borderRadius: 8,
        },
      }}
    >
      <AntdApp>
        <MessageBridge />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
        <PWAInstallPrompt />
      </AntdApp>
    </ConfigProvider>
  );
}

export default App;
