import { http } from './request';
import { message } from '@/utils/appMessage';
import { PERM_IMPORT_EXPORT, hasPermissionNow } from '@/hooks/usePermission';

/** 保存 Blob 为本地文件（触发浏览器下载） */
export function saveBlob(blob: Blob, filename: string): void {
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

/**
 * 后端全量导出：先调用导出接口（format=csv|xlsx）返回 {filename, count}，
 * 再从下载接口取文件内容保存。返回是否成功。
 */
export async function exportFromBackend(
  path: string,
  format: 'csv' | 'xlsx',
  params?: Record<string, unknown>
): Promise<boolean> {
  // 2026-09-12：导出统一由 import_export 权限码管控（与后端同码），无权限直接拦截
  if (!hasPermissionNow(PERM_IMPORT_EXPORT)) {
    message.warning('无导出权限（请管理员在角色中分配「数据导入导出」）');
    return false;
  }
  try {
    const res = await http.get<{ filename: string; count: number }>(path, { ...(params || {}), format });
    if (res.code === 0 && res.data?.filename) {
      const blob = await http.download(`/v1/export/download/${res.data.filename}`);
      saveBlob(blob, res.data.filename);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
