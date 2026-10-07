/**
 * 复制文本到剪贴板（带降级兜底）
 *
 * 背景：navigator.clipboard.writeText 仅在「安全上下文」(https / localhost)
 * 且获得 Clipboard 权限时可用；在 http://IP、iframe（如 VS Code 内置浏览器 /
 * 客服悬浮窗嵌入）等受限环境会抛 NotAllowedError / undefined → 按钮显示"复制失败"。
 * 此工具先尝试 Clipboard API，失败/不可用时降级到 document.execCommand('copy')
 * + 临时 textarea（老方法，兼容受限环境）。
 */
export async function copyText(text: string): Promise<boolean> {
  // 1) 现代 Clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒等 → 走降级
    }
  }
  // 2) 降级：临时 textarea + execCommand('copy')
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
