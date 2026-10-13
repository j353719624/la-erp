import { useCallback, useEffect, useState } from 'react';
import { Database, Plus, Download, RefreshCw, Trash2, History, ShieldAlert } from 'lucide-react';
import { Switch, InputNumber, Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { RowActions } from '@/components/RowActions';
import { backupApi, BackupInfo, BackupSettings } from '@/api/backup';
import { confirmAction } from '@/utils/confirm';
import { format } from '@/utils/format';
import { useTableView } from '@/hooks/useTableView';
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

function formatSize(bytes: number): string {
  if (!bytes && bytes !== 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function BackupList() {
  // [2026-09-18 权限细化] 按钮级门控：立即备份=backup_create / 恢复·保存设置=backup_edit / 删除备份=backup_delete（下载只读不门控）
  const { has } = usePermission();
  const [list, setList] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  // 自动备份设置
  const [settings, setSettings] = useState<BackupSettings>({ auto: true, keep: 7, dir: '' });
  const [settingsSaving, setSettingsSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backupApi.list();
      if (res.code === 0) setList(res.data ?? []);
    } catch {
      // 401 已跳登录
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await backupApi.getSettings();
      if (res.code === 0 && res.data) setSettings(res.data);
    } catch {
      // 忽略
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await backupApi.create();
      if (res.code === 0) {
        message.success(`手动备份完成：${res.data?.name}`);
        fetchList();
      } else {
        message.error(res.message || '备份失败');
      }
    } catch (err: any) {
      message.error(err.message || '备份失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (item: BackupInfo) => {
    try {
      const blob = await backupApi.download(item.name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.name;
      a.click();
      URL.revokeObjectURL(url);
      message.success('备份已开始下载');
    } catch (err: any) {
      message.error(err.message || '下载失败');
    }
  };

  const handleDelete = async (item: BackupInfo) => {
    if (!(await confirmAction({
      title: `删除备份 ${item.name}？`,
      content: '删除后不可恢复，请谨慎操作',
      danger: true,
    }))) return;
    try {
      const res = await backupApi.remove(item.name);
      if (res.code === 0) {
        message.success('备份已删除');
        fetchList();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (err: any) {
      message.error(err.message || '删除失败');
    }
  };

  const handleRestore = async (item: BackupInfo) => {
    if (!(await confirmAction({
      title: `从备份「${item.name}」恢复数据库？`,
      icon: <ShieldAlert className="w-5 h-5 text-red-600" />,
      content: (
        <div className="space-y-2 text-sm">
          <p className="text-red-600 font-medium">⚠️ 危险操作：将用该备份替换当前数据库！</p>
          <p>· 恢复为<strong>重启后生效</strong>（替换前会自动备份当前库，可回滚）</p>
          <p>· 恢复后需重启服务才能看到数据</p>
          <p className="text-gray-500">备份时间：{item.time}｜大小：{formatSize(item.size)}</p>
        </div>
      ),
      okText: '确认恢复',
      danger: true,
    }))) return;
    setRestoring(item.name);
    try {
      const res = await backupApi.restore(item.name);
      if (res.code === 0) {
        message.success(res.data?.message || '恢复已排队');
      } else {
        message.error(res.message || '恢复失败');
      }
    } catch (err: any) {
      message.error(err?.message || '恢复失败');
    } finally {
      setRestoring(null);
    }
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    try {
      const res = await backupApi.updateSettings(settings);
      if (res.code === 0) {
        message.success('自动备份设置已保存');
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (err: any) {
      message.error(err.message || '保存失败');
    } finally {
      setSettingsSaving(false);
    }
  };

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: BackupInfo) => ReactNode;
  }
  const TH_L = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'name', header: '文件名', cellCls: `${TD} font-mono text-sm text-gray-800`, cell: (item) => <span>{item.name}</span> },
    {
      key: 'type',
      header: '类型',
      cell: (item) => {
        const isAuto = item.name.startsWith('la-erp-backup-');
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${isAuto ? 'bg-teal-50 text-teal-700' : 'bg-blue-50 text-blue-700'}`}>
            {isAuto ? '自动' : '手动'}
          </span>
        );
      },
    },
    { key: 'size', header: '大小', headCls: TH_R, cellCls: `${TD} text-right text-gray-700 text-sm`, cell: (item) => <span>{formatSize(item.size)}</span> },
    { key: 'time', header: '时间', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => <span>{item.time}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      // [易用性] 行操作统一折叠；恢复中禁用主操作，防重复提交
      cell: (item) => (
        <RowActions
          actions={[
            // [2026-09-18 权限细化] 恢复=backup_edit；删除=backup_delete；下载只读不门控
            { key: 'download', label: '下载', icon: <Download className="w-4 h-4" />, onClick: () => handleDownload(item) },
            ...(has('backup_edit')
              ? [
                  {
                    key: 'restore',
                    label: restoring === item.name ? '恢复中…' : '恢复（重启后生效）',
                    icon: <History className="w-4 h-4" />,
                    disabled: restoring === item.name,
                    onClick: () => handleRestore(item),
                  },
                ]
              : []),
            ...(has('backup_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'backup-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="数据备份"
        subtitle="数据库备份 / 恢复 / 自动备份"
        extra={
          has('backup_create') && (
            <button onClick={handleCreate} disabled={creating} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              {creating ? '备份中...' : '立即备份'}
            </button>
          )
        }
      />

      {/* 自动备份设置 */}
      <div className="card p-6">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-teal-600" /> 自动备份
        </h3>
        <p className="text-sm text-gray-500 mt-1 mb-4">
          每天自动备份一次（备份文件存于备份目录，升级不覆盖）；仅清理自动备份，手动备份长期保留
        </p>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">启用每日自动备份</span>
            <Switch
              checked={settings.auto}
              onChange={(v) => setSettings(prev => ({ ...prev, auto: v }))}
              checkedChildren="开"
              unCheckedChildren="关"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">自动备份保留份数</span>
            <InputNumber
              min={1}
              max={90}
              value={settings.keep}
              onChange={(v) => setSettings(prev => ({ ...prev, keep: v ?? 7 }))}
              style={{ width: 100 }}
            />
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-sm text-gray-600 mb-1">备份目录（绝对路径）</label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={settings.dir}
              onChange={(e) => setSettings(prev => ({ ...prev, dir: e.target.value }))}
              placeholder="留空 = 默认数据目录 backups/（与数据库同盘）"
              className="form-input flex-1 min-w-[260px] max-w-xl"
            />
            {has('backup_edit') && (
              <button onClick={handleSaveSettings} disabled={settingsSaving} className="btn-secondary">
                {settingsSaving ? '保存中...' : '保存设置'}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            ⚠️ 安全建议：配置到<strong>不同的物理盘 / 网络存储</strong>（如飞牛第二块硬盘、NAS 共享目录），
            避免磁盘故障时数据与备份同时丢失。仅管理员可修改；保存时会校验目录可写。
          </p>
        </div>
      </div>

      {/* 备份列表 */}
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" /> 备份列表
          </h3>
          <div className="flex items-center gap-2">
            {viewMenu}
            <button onClick={fetchList} disabled={loading} className="btn-secondary flex items-center gap-2 text-sm">
              <RefreshCw className="w-4 h-4" /> 刷新
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-4"><EmptyState title="暂无备份" description="点击「立即备份」创建第一个数据库备份" /></td></tr>
              ) : (
                list.map((item) => (
                  <tr key={item.name} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
