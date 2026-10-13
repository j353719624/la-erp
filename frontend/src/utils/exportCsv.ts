import { message } from '@/utils/appMessage';
import { PERM_IMPORT_EXPORT, hasPermissionNow } from '@/hooks/usePermission';

/**
 * CSV 导出工具（通用）
 * - 带 UTF-8 BOM，Excel 直接打开不乱码
 * - 自动处理逗号/引号/换行转义
 */
export function exportCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): void {
  // 2026-09-12：导出统一由 import_export 权限码管控（与后端同码）
  if (!hasPermissionNow(PERM_IMPORT_EXPORT)) {
    message.warning('无导出权限（请管理员在角色中分配「数据导入导出」）');
    return;
  }
  const BOM = '\uFEFF';
  // 防 CSV 公式注入：以 = + - @ 或制表符/回车开头时前缀单引号，防止 Excel 打开时执行公式
  const esc = (v: string | number | null | undefined): string => {
    let s = String(v ?? '');
    if (s && /^[=+\-@\t\r]/.test(s)) {
      s = "'" + s;
    }
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const content = [
    headers.map(esc).join(','),
    ...rows.map((r) => r.map(esc).join(',')),
  ].join('\n');

  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放（同 utils/export.ts）：同步 revoke 会让部分浏览器下载未开始就丢 blob → 「点了没反应」
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
