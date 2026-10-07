import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import { currencyApi } from '@/api/finance';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';
import { confirmAction } from '@/utils/confirm';

interface Currency { id: string; code: string; name: string; symbol: string; is_base: boolean; exchange_rate: string; remark?: string; }

export function CurrencyList() {
  // [2026-09-18 权限细化] 新增=currency_create；编辑=currency_edit；删除=currency_delete
  const { has } = usePermission();
  const [list, setList] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<any>({ code: '', name: '', symbol: '', is_base: false, exchange_rate: '1' });
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await currencyApi.list();
      if (res.code === 0) setList(Array.isArray(res.data) ? res.data : []);
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const openCreate = () => { setEditId(''); setForm({ code: '', name: '', symbol: '', is_base: false, exchange_rate: '1' }); setOpen(true); };
  const openEdit = (c: Currency) => { setEditId(c.id); setForm({ code: c.code, name: c.name, symbol: c.symbol, is_base: c.is_base, exchange_rate: c.exchange_rate }); setOpen(true); };

  const handleSave = async () => {
    if (!form.code.trim()) { message.warning('请填写币种编码'); return; }
    setSaving(true);
    try {
      const data = { code: form.code, name: form.name, symbol: form.symbol, is_base: form.is_base, exchange_rate: parseFloat(form.exchange_rate) || 1 };
      const res = editId ? await currencyApi.update(editId, data) : await currencyApi.create(data);
      if (res.code === 0) { message.success(editId ? '已更新' : '已创建'); setOpen(false); fetchList(); } else { message.error(res.message || '保存失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setSaving(false); }
  };

  const handleDelete = async (c: Currency) => {
    if (!(await confirmAction({ title: `删除币种 ${c.code}？`, danger: true }))) return;
    const res = await currencyApi.remove(c.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); } else { message.error(res.message || '删除失败'); }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Currency) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'code', header: '编码', cell: (c) => <span className="font-medium text-gray-900">{c.code}</span> },
    { key: 'name', header: '名称', cell: (c) => <span className="text-gray-700">{c.name || '-'}</span> },
    { key: 'symbol', header: '符号', cell: (c) => <span className="text-gray-600">{c.symbol || '-'}</span> },
    { key: 'exchange_rate', header: '汇率（对本位币）', headCls: TH_R, cellCls: `${TD} text-right`, cell: (c) => <span className="text-gray-900">{format.currency(parseFloat(c.exchange_rate), 4)}</span> },
    {
      key: 'is_base',
      header: '本位币',
      cell: (c) => (
        c.is_base ? <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">本位币</span> : <span className="text-gray-400">-</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (c) => (
        <>
          {has('currency_edit') && (
            <button onClick={() => openEdit(c)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="编辑"><Pencil className="w-4 h-4" /></button>
          )}
          {!c.is_base && has('currency_delete') && <button onClick={() => handleDelete(c)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="删除"><Trash2 className="w-4 h-4" /></button>}
        </>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'currency-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="币种管理"
        subtitle="维护币种与本位币汇率，凭证支持多币种记账"
        extra={
          has('currency_create') && (
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /><span className="hidden md:inline">新增币种</span>
            </button>
          )
        }
      />
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <span className="text-sm text-gray-500">本位币不可删除；汇率用于外币单据折算</span>
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
              {loading ? (<tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={4} /></td></tr>)
                : list.length === 0 ? (<tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty title="暂无币种" description="点击右上角「新增币种」维护多币种汇率" /></td></tr>)
                : list.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((col) => (
                      <td key={col.key} className={col.cellCls || TD}>
                        {col.cell(c)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal title={editId ? '编辑币种' : '新增币种'} open={open} onCancel={() => setOpen(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消">
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-3">
            <Input placeholder="编码 *（如 USD）" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editId}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            <Input placeholder="请输入名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="请输入符号" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <Input type="number" placeholder="请输入汇率（对本位币）" value={form.exchange_rate} onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })} style={{ width: 200 }} />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={form.is_base} onChange={(e) => setForm({ ...form, is_base: e.target.checked })} />
              设为本位币（仅一个）
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
