import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Users, RefreshCw } from 'lucide-react';
import { Modal, Input, Select } from 'antd';
import { message } from '@/utils/appMessage';
import { shareholderApi, Shareholder, HOLDER_TYPE_TEXT } from '@/api/finance';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { Pagination } from '@/components/Pagination';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { confirmAction } from '@/utils/confirm';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

/**
 * 股东档案（2026-09-11）
 *
 * 客户反馈"分红只能填一个总额，不知道每个股东拿多少、各扣多少税"。
 * 本页维护股东（自然人/法人）+ 持股比例，税金计提的「分红」页签据此按股东拆分：
 *  - 自然人股东：分红代扣个人所得税（默认 20%）
 *  - 法人股东：居民企业之间股息红利免征企业所得税（默认不扣）
 */
const n = (v: string | number | undefined) => Number(v ?? 0);

const emptyForm = {
  name: '',
  holder_type: 'natural',
  tax_no: '',
  share_ratio: '',
  capital: '',
  phone: '',
  bank_name: '',
  bank_account: '',
  is_active: true,
  remark: '',
};

export function ShareholderList() {
  // [2026-09-18 权限细化] 新增=shareholder_create；编辑=shareholder_edit；删除=shareholder_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ page: 1, page_size: 10, keyword: '' });
  const [list, setList] = useState<Shareholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [applied, setApplied] = useState(String(urlFilters.keyword || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);

  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    syncUrl({ keyword: applied, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, pagination.page, pagination.page_size]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await shareholderApi.list({
        page: pagination.page,
        page_size: pagination.page_size,
        keyword: applied || undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return;
        setList(res.data?.list ?? []);
        setPagination((p) => ({ ...p, total: res.data?.total ?? 0 }));
      }
    } catch {
      /* 静默 */
    } finally {
      if (isCurrent(seq)) setLoading(false);
    }
  }, [pagination.page, pagination.page_size, applied, nextSeq, isCurrent]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 全部股东（不受搜索/分页影响）的比例合计——分红拆分是否等于 100% 一目了然
  const ratioSum = useMemo(() => list.reduce((s, x) => s + n(x.share_ratio), 0), [list]);
  const activeRatioSum = useMemo(
    () => list.filter((x) => x.is_active !== false).reduce((s, x) => s + n(x.share_ratio), 0),
    [list],
  );

  const openCreate = () => {
    setEditId('');
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (s: Shareholder) => {
    setEditId(s.id);
    setForm({
      name: s.name || '',
      holder_type: s.holder_type || 'natural',
      tax_no: s.tax_no || '',
      share_ratio: String(n(s.share_ratio)),
      capital: String(n(s.capital)),
      phone: s.phone || '',
      bank_name: s.bank_name || '',
      bank_account: s.bank_account || '',
      is_active: s.is_active !== false,
      remark: s.remark || '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      message.warning('请填写股东名称');
      return;
    }
    const ratio = Number(form.share_ratio || 0);
    if (!(ratio >= 0 && ratio <= 100)) {
      message.warning('持股比例应在 0~100 之间（如 40 表示 40%）');
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        holder_type: form.holder_type,
        tax_no: form.tax_no.trim() || undefined,
        share_ratio: ratio,
        capital: Number(form.capital || 0),
        phone: form.phone.trim() || undefined,
        bank_name: form.bank_name.trim() || undefined,
        bank_account: form.bank_account.trim() || undefined,
        is_active: form.is_active,
        remark: form.remark.trim() || undefined,
      };
      const res = editId ? await shareholderApi.update(editId, data) : await shareholderApi.create(data);
      if (res.code === 0) {
        message.success(editId ? '已更新' : '已创建');
        setOpen(false);
        fetchList();
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: Shareholder) => {
    const ok = await confirmAction({
      title: `删除股东「${s.name}」？`,
      content: '已计提的历史分红记录不受影响；删除后新分红将无法选择该股东。',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await shareholderApi.remove(s.id);
      if (res.code === 0) {
        message.success('已删除');
        fetchList();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const labelCls = 'block text-sm text-gray-600 mb-1';
  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Shareholder) => ReactNode;
  }
  const TH_C = 'px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'name', header: '股东', cell: (s) => <span className="font-medium text-gray-900">{s.name}</span> },
    {
      key: 'holder_type',
      header: '类型',
      cell: (s) => (
        <span className={`px-2 py-0.5 rounded text-xs ${s.holder_type === 'corporate' ? 'bg-indigo-50 text-indigo-600' : 'bg-teal-50 text-teal-600'}`}>
          {HOLDER_TYPE_TEXT[s.holder_type] || s.holder_type}
        </span>
      ),
    },
    { key: 'tax_no', header: '证件号 / 统一社会信用代码', cell: (s) => <span className="text-gray-600">{s.tax_no || '-'}</span> },
    { key: 'share_ratio', header: '持股比例', cell: (s) => <span className="font-medium text-gray-900">{n(s.share_ratio)}%</span> },
    { key: 'capital', header: '出资额', cell: (s) => <span className="text-gray-700">{n(s.capital) ? `¥${format.currency(n(s.capital))}` : '-'}</span> },
    { key: 'phone', header: '联系方式', cell: (s) => <span className="text-gray-600">{s.phone || '-'}</span> },
    { key: 'bank_account', header: '收款账户', cell: (s) => <span className="text-gray-600">{s.bank_account ? `${s.bank_name || ''} ${s.bank_account}`.trim() : '-'}</span> },
    {
      key: 'is_active',
      header: '状态',
      cell: (s) => (
        s.is_active !== false ? (
          <span className="px-2 py-0.5 rounded text-xs bg-green-50 text-green-600">启用</span>
        ) : (
          <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">停用</span>
        )
      ),
    },
    {
      key: '__actions',
      header: '操作',
      cellCls: `${TD} whitespace-nowrap`,
      cell: (s) => (
        <RowActions
          actions={[
            ...(has('shareholder_edit')
              ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(s) }]
              : []),
            ...(has('shareholder_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(s) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'shareholder-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="股东档案"
        subtitle="维护股东与持股比例；税金计提「分红」按股东拆分，自然人代扣 20% 个税、法人免税"
        extra={
          <div className="flex items-center gap-2">
            <button onClick={fetchList} className="btn-secondary flex items-center gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">刷新</span>
            </button>
            {has('shareholder_create') && (
              <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新增股东</span>
              </button>
            )}
          </div>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <Input.Search
            allowClear
            placeholder="搜索股东名称 / 证件号"
            defaultValue={keyword}
            style={{ maxWidth: 320 }}
            onSearch={(v) => {
              setPagination((p) => ({ ...p, page: 1 }));
              setApplied(v.trim());
            }}
            onChange={(e) => {
              if (!e.target.value) {
                setPagination((p) => ({ ...p, page: 1 }));
                setApplied('');
              }
            }}
          />
          <div className="text-xs text-gray-500 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-gray-400" />
            当前页持股比例合计 <span className={activeRatioSum > 100 ? 'text-red-600 font-medium' : 'text-gray-800 font-medium'}>{activeRatioSum}%</span>
            {activeRatioSum !== 100 && (
              <span className="text-amber-600">（不等于 100%：分红仍按比例折算，剩余份额不会分出去）</span>
            )}
          </div>
          <div className="ml-auto">{viewMenu}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH_C}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={4} /></td></tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-6">
                    <ListEmpty
                      keyword={applied}
                      onClear={() => { setKeyword(''); setApplied(''); setPagination((p) => ({ ...p, page: 1 })); }}
                      title="还没有股东档案"
                      description="点右上角「新增股东」录入股东与持股比例，之后分红就能按股东逐个计算"
                    />
                  </td>
                </tr>
              ) : (
                list.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(s)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {!loading && list.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-medium text-gray-800">
                  {visibleColumns.map((c, i) => (
                    <td key={c.key} className="px-6 py-3">
                      {i === 0 ? '本页合计' : c.key === 'share_ratio' ? `${ratioSum}%` : c.key === 'capital' ? `¥${format.currency(list.reduce((s, x) => s + n(x.capital), 0))}` : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        </div>
      </div>

      <Modal
        title={editId ? '编辑股东' : '新增股东'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={640}
      >
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>股东名称 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="如：张三 / 某某投资有限公司" />
            </div>
            <div>
              <label className={labelCls}>股东类型 *</label>
              <Select
                value={form.holder_type}
                onChange={(v) => setForm({ ...form, holder_type: v })}
                style={{ width: '100%' }}
                options={[
                  { value: 'natural', label: '自然人（分红代扣 20% 个税）' },
                  { value: 'corporate', label: '法人（居民企业间股息红利免税）' },
                ]}
              />
            </div>
            <div>
              <label className={labelCls}>证件号 / 统一社会信用代码</label>
              <input value={form.tax_no} onChange={(e) => setForm({ ...form, tax_no: e.target.value })} className={inputCls} placeholder="自然人身份证号 / 企业统一社会信用代码"  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className={labelCls}>持股比例（%，如 40 表示 40%）</label>
              <input type="text" inputMode="decimal" value={form.share_ratio} onChange={(e) => setForm({ ...form, share_ratio: e.target.value })} className={inputCls} placeholder="40" />
            </div>
            <div>
              <label className={labelCls}>出资额（认缴/实缴）</label>
              <input type="text" inputMode="decimal" value={form.capital} onChange={(e) => setForm({ ...form, capital: e.target.value })} className={inputCls} placeholder="600000" />
            </div>
            <div>
              <label className={labelCls}>联系电话</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>开户银行</label>
              <input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>银行账号（分红打款用）</label>
              <input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} className={inputCls}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
          </div>
          <div>
            <label className={labelCls}>备注</label>
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 accent-blue-600" />
            启用（停用后分红拆分时不再纳入）
          </label>
          <div className="text-xs text-gray-400">
            提示：分红由「财务 → 税金计提 → 分红」发起，可一键按持股比例拆分到各股东，并自动计算自然人的代扣个税。
          </div>
        </div>
      </Modal>
    </div>
  );
}
