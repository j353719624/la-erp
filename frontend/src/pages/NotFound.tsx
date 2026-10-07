import { useNavigate, useLocation } from 'react-router-dom';
import { Compass, ArrowLeft, Home, Search } from 'lucide-react';

/**
 * 404 兜底页（2026-09-11 易用性修复）
 *
 * 此前 `path="*"` 直接 `<Navigate to="/dashboard" />` —— 用户点错链接/收藏失效/输错地址时
 * 被静默送到仪表盘，不知道发生了什么（也看不到自己去过哪）。现在明确告知并给出口。
 */
export function NotFound() {
  const navigate = useNavigate();
  const loc = useLocation();

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
          <Compass className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">页面不存在</h1>
        <p className="text-sm text-gray-500 mt-2">
          地址 <code className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 break-all">{loc.pathname}</code> 没有对应的页面，
          可能是链接过期、书签失效，或该功能已被调整。
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button onClick={() => navigate(-1)} className="btn-secondary flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            返回上一页
          </button>
          <button onClick={() => navigate('/dashboard')} className="btn-primary flex items-center gap-2">
            <Home className="w-4 h-4" />
            回到仪表盘
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-4 flex items-center justify-center gap-1">
          <Search className="w-3.5 h-3.5" />
          提示：也可以从左侧菜单进入对应功能
        </p>
      </div>
    </div>
  );
}

export default NotFound;
