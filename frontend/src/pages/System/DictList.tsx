import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, BookOpen, Power, FolderPlus } from 'lucide-react';
import { Modal, Input, Button } from 'antd';
import { message } from '@/utils/appMessage';
import { http } from '@/utils/request';
import { invalidateDictCache } from '@/hooks/useDictItems';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { confirmAction } from '@/utils/confirm';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { usePermission } from '@/hooks/usePermission';
import { useTableView } from '@/hooks/useTableView';
import { RowActions } from '@/components/RowActions';
import type { RowAction } from '@/components/RowActions';
import type { ReactNode } from 'react';

interface DictType {
  type_code: string;
  type_name: string;
  count: number;
}

interface DictItem {
  id: string;
  type_code: string;
  type_name: string;
  item_code: string;
  item_name: string;
  sort_order: number;
  status: string;
  remark: string;
}

export function DictList() {
  // [2026-09-18 权限细化] 按钮级门控：新增类型·新增字典项=dict_create / 编辑·改名·停用启用=dict_edit / 删除=dict_delete
  const { has } = usePermission();
  const [types, setTypes] = useState<DictType[]>([]);
  const [activeType, setActiveType] = useState('');
  const [items, setItems] = useState<DictItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DictItem | null>(null);
  const [form, setForm] = useState<Partial<DictItem>>({});
  // [S-05 2026-09-13] 类型级入口：新建类型（含首项）/ 类型改名
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [typeForm, setTypeForm] = useState({ type_code: '', type_name: '', first_item_code: '', first_item_name: '' });
  const [typeSaving, setTypeSaving] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DictType | null>(null);
  const [renameName, setRenameName] = useState('');
  // 请求竞态守卫：字典类型快速切换时丢弃过期响应，防止 A 类型字典项挂到 B 类型下
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchTypes = useCallback(async () => {
    try {
      const res = await http.get<DictType[]>('/v1/dict/types');
      if (res.code === 0) {
        setTypes(res.data ?? []);
        if (res.data?.length && !activeType) setActiveType(res.data[0].type_code);
      }
    } catch {
      // 静默
    }
  }, [activeType]);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  const fetchItems = useCallback(async () => {
    if (!activeType) return;
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await http.get<DictItem[]>('/v1/dict/items', { type_code: activeType });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setItems(res.data ?? []);
      }
    } catch {
      // 静默
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [activeType, nextSeq, isCurrent]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const active = types.find(t => t.type_code === activeType);

  const openCreate = () => {
    setEditing(null);
    setForm({ type_code: activeType, type_name: active?.type_name || '', sort_order: items.length + 1 });
    setModalOpen(true);
  };

  const openEdit = (item: DictItem) => {
    setEditing(item);
    setForm({ ...item });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        const res = await http.put(`/v1/dict/items/${editing.id}`, form);
        if (res.code !== 0) { message.error(res.message || '更新失败'); return; }
        message.success('已更新');
      } else {
        const res = await http.post('/v1/dict/items', form);
        if (res.code !== 0) { message.error(res.message || '创建失败'); return; }
        message.success('已创建');
      }
      setModalOpen(false);
      // [S-05] 业务页面依赖字典缓存，改动后清掉（下次进入即拉到最新）
      invalidateDictCache(form.type_code || activeType);
      fetchTypes();
      fetchItems();
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    }
  };

  const handleDelete = async (item: DictItem) => {
    if (!(await confirmAction({ title: `确定删除字典项 ${item.item_name} 吗？`, danger: true }))) return;
    try {
      await http.delete(`/v1/dict/items/${item.id}`);
      message.success('已删除');
      invalidateDictCache(item.type_code);
      fetchTypes();
      fetchItems();
    } catch (e: any) {
      // [S-05] 被业务数据引用的项会被拒删（如「已被 112 条商品使用…请改用停用」），必须把原因告诉用户
      message.error(e?.message || '删除失败');
    }
  };

  // [S-05] 停用/启用：被业务数据引用的字典项不能删，改用停用（列表下拉自动隐藏，历史数据仍能显示名称）
  const toggleStatus = async (item: DictItem) => {
    const next = item.status === 'active' ? 'inactive' : 'active';
    try {
      await http.put(`/v1/dict/items/${item.id}`, { status: next });
      message.success(next === 'inactive' ? '已停用（业务下拉不再出现，历史数据仍显示名称）' : '已启用');
      invalidateDictCache(item.type_code);
      fetchItems();
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  // [S-05] 新建字典类型（含首个字典项——类型由字典项承载，无项不可见）
  const handleCreateType = async () => {
    setTypeSaving(true);
    try {
      await http.post('/v1/dict/types', typeForm);
      message.success('类型已创建，可继续添加字典项');
      setTypeModalOpen(false);
      const code = typeForm.type_code.trim().toLowerCase();
      setTypeForm({ type_code: '', type_name: '', first_item_code: '', first_item_name: '' });
      invalidateDictCache();
      await fetchTypes();
      setActiveType(code);
      fetchItems();
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    } finally {
      setTypeSaving(false);
    }
  };

  // [S-05] 类型改名（级联该类型全部字典项的 type_name）
  const handleRename = async () => {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) { message.warning('类型名称不能为空'); return; }
    try {
      await http.put(`/v1/dict/types/${renameTarget.type_code}`, { type_name: name });
      message.success('已改名');
      setRenameTarget(null);
      invalidateDictCache(renameTarget.type_code);
      fetchTypes();
    } catch (e: any) {
      message.error(e?.message || '改名失败');
    }
  };

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: DictItem) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'item_code', header: '编码', cellCls: `${TD} font-mono text-sm text-gray-700`, cell: (item) => <span>{item.item_code}</span> },
    { key: 'item_name', header: '名称', cellCls: `${TD} font-medium text-gray-900`, cell: (item) => <span>{item.item_name}</span> },
    { key: 'sort_order', header: '排序', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => <span>{item.sort_order}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
          {item.status === 'active' ? '启用' : '停用'}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      // [2026-09-14 统一操作列] 手写按钮迁移 RowActions：窄屏折叠「主操作 + ⋮」，操作列 ~88px
      cell: (item) => {
        // [2026-09-18 权限细化] 停用启用·编辑=dict_edit；删除=dict_delete
        const actions: RowAction[] = [
          ...(has('dict_edit')
            ? [
                {
                  key: 'toggle',
                  label: item.status === 'active' ? '停用（业务下拉不再出现，历史数据仍显示名称）' : '启用',
                  icon: <Power className="w-4 h-4" />,
                  onClick: () => toggleStatus(item),
                },
              ]
            : []),
          ...(has('dict_edit')
            ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, primary: true, onClick: () => openEdit(item) }]
            : []),
          ...(has('dict_delete')
            ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item) }]
            : []),
        ];
        return <RowActions actions={actions} />;
      },
    },
  ];
  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'dict-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="数据字典"
        subtitle="业务枚举与字典项管理"
        extra={
          activeType ? (
            has('dict_create') && (
              <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新增字典项</span>
              </button>
            )
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="card lg:col-span-1">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-500" />
              字典类型
            </h3>
            {has('dict_create') && (
              <button
                onClick={() => setTypeModalOpen(true)}
                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="新建类型（可被业务下拉使用）"
              >
                <FolderPlus className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="max-h-[480px] overflow-y-auto">
            {types.length === 0 ? (
              <div className="p-4 text-sm text-gray-400">暂无字典类型</div>
            ) : (
              types.map(t => (
                <div
                  key={t.type_code}
                  className={`group w-full flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-50 ${activeType === t.type_code ? 'bg-blue-50' : ''}`}
                >
                  <button
                    onClick={() => setActiveType(t.type_code)}
                    className="flex-1 flex items-center justify-between px-4 py-3 text-left min-w-0"
                  >
                    <span className={`text-sm truncate ${activeType === t.type_code ? 'text-blue-600 font-medium' : 'text-gray-700'}`}>
                      {t.type_name || t.type_code}
                    </span>
                    <span className="text-xs text-gray-400 ml-2 shrink-0">{t.count}</span>
                  </button>
                  {has('dict_edit') && (
                    <button
                      onClick={() => { setRenameTarget(t); setRenameName(t.type_name || ''); }}
                      className="p-1.5 mr-2 shrink-0 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      title="重命名类型"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card lg:col-span-3">
          <div className="p-4 border-b border-gray-100 flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-700">{active?.type_name || '字典项'}（{activeType || '-'}）</h3>
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
                  <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={6} /></td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={visibleColumns.length} className="px-6"><EmptyState title="暂无字典项" description="点击右上角新增" /></td></tr>
                ) : (
                  items.map(item => (
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
      </div>

      <Modal
        title={editing ? '编辑字典项' : '新增字典项'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">类型编码</label>
              <Input value={form.type_code} disabled onChange={e => setForm(p => ({ ...p, type_code: e.target.value }))}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">类型名称</label>
              <Input value={form.type_name} disabled />
              <p className="text-xs text-gray-400 mt-1">类型统一在左侧「重命名类型」处修改（会同步该类型全部字典项）</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">字典项编码 *</label>
              <Input value={form.item_code} placeholder="如：draft" onChange={e => setForm(p => ({ ...p, item_code: e.target.value }))}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">字典项名称 *</label>
              <Input value={form.item_name} placeholder="如：草稿" onChange={e => setForm(p => ({ ...p, item_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">排序</label>
              <Input type="number" value={form.sort_order ?? 0} onChange={e => setForm(p => ({ ...p, sort_order: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
              <select value={form.status || 'active'} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className="form-input">
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
            <Input value={form.remark} onChange={e => setForm(p => ({ ...p, remark: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {/* [S-05 2026-09-13] 新建字典类型（含首个字典项——类型由字典项承载，无项不可见） */}
      <Modal
        title="新建字典类型"
        open={typeModalOpen}
        onCancel={() => setTypeModalOpen(false)}
        onOk={handleCreateType}
        confirmLoading={typeSaving}
        okText="创建"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">类型编码 *</label>
              <Input value={typeForm.type_code} placeholder="如：lead_source" onChange={e => setTypeForm(p => ({ ...p, type_code: e.target.value }))}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">类型名称 *</label>
              <Input value={typeForm.type_name} placeholder="如：线索来源" onChange={e => setTypeForm(p => ({ ...p, type_name: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">首个字典项编码 *</label>
              <Input value={typeForm.first_item_code} placeholder="如：douyin" onChange={e => setTypeForm(p => ({ ...p, first_item_code: e.target.value }))}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">首个字典项名称 *</label>
              <Input value={typeForm.first_item_name} placeholder="如：抖音" onChange={e => setTypeForm(p => ({ ...p, first_item_name: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            类型由字典项承载：创建时一并建立首个字典项，之后在右侧「新增字典项」继续补充；业务页面按类型编码取用（代码：DictSelect typeCode）。
          </p>
        </div>
      </Modal>

      {/* [S-05] 类型改名（级联该类型全部字典项的 type_name） */}
      <Modal
        title={renameTarget ? `重命名类型：${renameTarget.type_code}` : ''}
        open={!!renameTarget}
        onCancel={() => setRenameTarget(null)}
        onOk={handleRename}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">类型名称 *</label>
          <Input value={renameName} onChange={e => setRenameName(e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">将同步更新该类型下全部 {renameTarget?.count ?? 0} 个字典项的显示名。</p>
        </div>
      </Modal>
    </div>
  );
}
