import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// [2026-09-17 审查修复] 新版本部署后，仍在运行的旧页面（尤其 PWA 常驻标签页）点击未访问过的路由会
// 加载已被删除的旧 hash chunk：Vite 派发 vite:preloadError（无人接管时冒泡成整页 ErrorBoundary，
// 用户须手动重试——与「升级白屏」同族的另一半）。这里捕获后整页刷新一次：
// 5 分钟内最多 2 次（防拼包损坏时无限刷新；时间窗过期自动恢复额度）。
// ⚠️ sessionStorage 键仅本文件使用（≤5 分钟窗口，不入 localKeys 长期存储范畴）。
const PRELOAD_RELOAD_KEY = 'la_preload_reloads'
const PRELOAD_WINDOW_MS = 5 * 60 * 1000
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  try {
    const now = Date.now()
    const recent = (JSON.parse(sessionStorage.getItem(PRELOAD_RELOAD_KEY) || '[]') as number[]).filter(
      (t) => now - t < PRELOAD_WINDOW_MS,
    )
    if (recent.length >= 2) return // 连续刷新仍失败：不再循环（交给用户手动处理）
    recent.push(now)
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, JSON.stringify(recent))
  } catch {
    /* 隐私模式等无法写 sessionStorage：仍刷新一次 */
  }
  window.location.reload()
})

const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// [PWA 升级自愈 2026-09-17] 渲染未抛同步异常 → 清除 boot guard 计数（boot-guard.js 白屏自愈配套），
// 避免计数残留挡住未来的自动修复。放在 render 之后：渲染同步失败时不误清计数（计数上限保护仍然生效）。
try {
  sessionStorage.removeItem('la_boot_guard')
} catch {
  /* 隐私模式等场景忽略 */
}
