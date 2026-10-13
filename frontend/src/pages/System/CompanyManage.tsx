import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Ban, RotateCcw, Building2, AlertCircle } from 'lucide-react';
import { Modal, Input, Switch } from 'antd';
import { message } from '@/utils/appMessage';
import { companyApi, CompanyInfo } from '@/api/company';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { confirmAction } from '@/utils/confirm';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

/**
 * 公司管理（多公司部署控制台，2026-09-17）。
 *
 * - 每家公司 = 独立数据库，数据完全隔离；本页管理公司的创建/改名/启停用；
 * - 仅默认公司的 super_admin 可操作（后端双重校验，其余情况 403 → 页面顶部提示）；
 * - 新建公司默认空公司（预设字典/科目/单号/模板等结构数据，不含业务演示数据）；
 *   勾选「含演示数据」则附带示例商品/供应商（仅供体验，正式使用请勿勾选）。
 */

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,19}$/;

const STATUS_TEXT: Record<string, { text: string; cls: string }> = {
  active: { text: '启用中', cls: 'bg-green-50 text-green-600' },
  disabled: { text: '已停用', cls: 'bg-gray-100 text-gray-500' },
  pending: { text: '创建中', cls: 'bg-amber-50 text-amber-600' },
  error: { text: '初始化失败', cls: 'bg-red-50 text-red-600' },
};

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function CompanyManage() {
  const [list, setList] = useState<CompanyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ code: string; name: string; with_demo_data: boolean }>({
    code: '',
    name: '',
    with_demo_data: false,
  });

  const fetchList = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await companyApi.list();
      if (res.code === 0) {
        setList(Array.isArray(res.data) ? res.data : []);
      } else {
        setLoadError(res.message || '加载失败');
      }
    } catch (err) {
      // 透传后端原因（403 时 = 非默认公司 / 非超管的中文提示）
      setLoadError(err instanceof Error && err.message ? err.message : '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const openCreate = () => {
    setEditing(null);
    setForm({ code: '', name: '', with_demo_data: false });
    setModalOpen(true);
  };

  const openRename = (item: CompanyInfo) => {
    setEditing(item);
    setForm({ code: item.code, name: item.name, with_demo_data: false });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    if (editing) {
      const name = form.name.trim();
      if (!name) {
        message.warning('请填写公司名称');
        return;
      }
      setSaving(true);
      try {
        const res = await companyApi.update(editing.id, { name });
        if (res.code === 0) {
          message.success('已保存');
          setModalOpen(false);
          void fetchList();
        } else {
          message.error(res.message || '保存失败');
        }
      } catch (err) {
        message.error(err instanceof Error && err.message ? err.message : '保存失败');
      } finally {
        setSaving(false);
      }
      return;
    }

    const code = form.code.trim().toLowerCase();
    const name = form.name.trim();
    if (!CODE_PATTERN.test(code)) {
      message.warning('公司编码需以小写字母开头，仅含小写字母/数字/下划线，2~20 位');
      return;
    }
    if (!name) {
      message.warning('请填写公司名称');
      return;
    }
    setSaving(true);
    try {
      const res = await companyApi.create({ code, name, with_demo_data: form.with_demo_data });
      if (res.code === 0) {
        message.success(`公司「${name}」创建完成（独立数据库，数据与其他公司完全隔离）`);
        setModalOpen(false);
        void fetchList();
      } else {
        message.error(res.message || '创建失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (item: CompanyInfo) => {
    const disabling = item.status !== 'disabled';
    const ok = await confirmAction({
      title: disabling ? `停用公司「${item.name}」？` : `启用公司「${item.name}」？`,
      content: disabling
        ? '停用后该公司所有账号将无法登录与访问（数据保留，可随时重新启用）。'
        : '启用后该公司账号可重新登录使用。',
      danger: disabling,
    });
    if (!ok) return;
    try {
      const res = await companyApi.update(item.id, { status: disabling ? 'disabled' : 'active' });
      if (res.code === 0) {
        message.success(disabling ? '已停用' : '已启用');
        void fetchList();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '操作失败');
    }
  };

  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';

  const rowCols: { key: string; header: string; headCls?: string; cellCls?: string; cell: (item: CompanyInfo) => ReactNode }[] = [
    {
      key: 'name',
      header: '公司名称',
      cell: (item) => (
        <span className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{item.name}</span>
          {item.is_default && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-600">默认公司</span>
          )}
        </span>
      ),
    },
    { key: 'code', header: '编码', cellCls: `${TD} text-gray-500 text-sm font-mono`, cell: (item) => item.code },
    {
      key: 'status',
      header: '状态',
      cell: (item) => {
        const s = STATUS_TEXT[item.status] || { text: item.status, cls: 'bg-gray-100 text-gray-500' };
        return (
          <span className="flex flex-col items-center gap-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.text}</span>
            {item.status === 'error' && item.last_error && (
              <span className="text-[11px] text-red-400 max-w-[220px] truncate" title={item.last_error}>
                {item.last_error}
              </span>
            )}
          </span>
        );
      },
    },
    { key: 'db_size', header: '数据库', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => formatSize(item.db_size) },
    {
      key: 'loaded',
      header: '运行状态',
      cellCls: `${TD} text-sm`,
      cell: (item) =>
        item.status !== 'active' ? (
          <span className="text-gray-300">—</span>
        ) : item.loaded ? (
          <span className="text-green-600">运行中</span>
        ) : (
          <span className="text-gray-400">待加载</span>
        ),
    },
    { key: 'created_at', header: '创建时间', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => item.created_at || '—' },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (item) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => openRename(item)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="重命名">
            <Pencil className="w-4 h-4" />
          </button>
          {!item.is_default && (
            <button
              onClick={() => toggleStatus(item)}
              className={`p-1.5 rounded-lg transition-colors ${item.status === 'disabled' ? 'text-green-600 hover:bg-green-50' : 'text-red-500 hover:bg-red-50'}`}
              title={item.status === 'disabled' ? '启用' : '停用'}
            >
              {item.status === 'disabled' ? <RotateCcw className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
            </button>
          )}
        </div>
      ),
    },
  ];

  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'company-manage',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="公司管理"
        subtitle="一套部署服务多家公司：每家公司独立数据库、独立配置（元数据/模板/单号/用户权限）"
        extra={
          !loadError && (
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建公司</span>
            </button>
          )
        }
      />

      {loadError && (
        <div className="card p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-gray-800 font-medium mb-1">无法打开公司管理</p>
              <p className="text-sm text-gray-500">{loadError}</p>
              <p className="text-xs text-gray-400 mt-2">
                说明：公司管理为部署级功能，仅「默认公司」的超级管理员（admin）可操作。
              </p>
            </div>
            <button onClick={() => void fetchList()} className="btn-secondary text-sm shrink-0">
              重试
            </button>
          </div>
        </div>
      )}

      {!loadError && (
        <div className="card">
          <div className="p-4 border-b border-gray-100 flex items-center gap-2">
            <div className="flex items-center gap-2 text-gray-400">
              <Building2 className="w-4 h-4" />
              <span className="text-sm">公司之间数据完全隔离；停用公司不影响其他公司与部署运行</span>
            </div>
            <div className="ml-auto">{viewMenu}</div>
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
                  <tr>
                    <td colSpan={visibleColumns.length} className="px-6 py-4">
                      <TableSkeleton rows={4} />
                    </td>
                  </tr>
                ) : list.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length} className="px-6">
                      <EmptyState title="暂无公司" description="点击右上角「新建公司」为另一家公司开出独立账套" />
                    </td>
                  </tr>
                ) : (
                  list.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
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
      )}

      <Modal
        title={editing ? `重命名公司（编码 ${editing.code} 不可修改）` : '新建公司'}
        open={modalOpen}
        onOk={handleSave}
        confirmLoading={saving}
        onCancel={() => setModalOpen(false)}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        destroyOnHidden
      >
        {!editing && (
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-sm text-gray-600">
                公司编码 *
              </div>
              <Input
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                placeholder="如：acme（登录时按编码定位公司，创建后不可修改）"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>
        )}
        <div className="space-y-4 mt-4">
          <div>
            <div className="mb-2 text-sm text-gray-600">
              公司名称 *
            </div>
            <Input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="请输入公司名称（显示在登录页与打印抬头）"
              maxLength={50}
            />
          </div>
          {!editing && (
            <div className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm text-gray-700">含演示数据</div>
                <div className="text-xs text-gray-400 mt-0.5">附带示例商品/供应商，仅供体验；正式使用请勿勾选</div>
              </div>
              <Switch checked={form.with_demo_data} onChange={(v) => setForm((p) => ({ ...p, with_demo_data: v }))} />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
