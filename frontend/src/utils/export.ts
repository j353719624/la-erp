import { message } from '@/utils/appMessage';
import { PERM_IMPORT_EXPORT, hasPermissionNow } from '@/hooks/usePermission';

/**
 * 通用导出工具（CSV，带 UTF-8 BOM，Excel 打开中文不乱码）
 */

export function downloadCSV(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>): void {
  // 2026-09-12：导出统一由 import_export 权限码管控（与后端同码），无权限直接拦截（体验账户等角色不落盘）
  if (!hasPermissionNow(PERM_IMPORT_EXPORT)) {
    message.warning('无导出权限（请管理员在角色中分配「数据导入导出」）');
    return;
  }
  // 防 CSV 公式注入：以 = + - @ 或制表符/回车开头时前缀单引号，防止 Excel 打开时执行公式
  const escape = (cell: string | number | null | undefined) => {
    let s = String(cell ?? '');
    if (s && /^[=+\-@\t\r]/.test(s)) {
      s = "'" + s;
    }
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  const content = '\ufeff' + lines.join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // ⚠️ 延迟释放：紧跟 click 同步 revoke 会让部分浏览器（Firefox / Safari / 手机端 WebView）
  // 在下载真正开始前就丢掉 blob URL，表现为「点了导出没反应」（2026-09-11 交付前回归实测：
  // 点击后马上 fetch 该 blob → net::ERR_FILE_NOT_FOUND）
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
