import { useState, useEffect } from 'react';
import { Plus, PackageX, ArchiveX, ScanLine } from 'lucide-react';
import { productionApi } from '@/api/production';
import { productApi } from '@/api/product';
import { http } from '@/utils/request';
import { SerialNumber } from '@/types/production';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { BarcodeInput } from '@/components/BarcodeInput';
import { SearchSelect } from '@/components/SearchSelect';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';
import { useTableView } from '@/hooks/useTableView';
import { loadOptions } from '@/utils/loadOptions';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

const STATUS: Record<string, { text: string; cls: string }> = {
  in_stock: { text: '在库', cls: 'bg-green-50 text-green-600' },
  out: { text: '已出库', cls: 'bg-blue-50 text-blue-600' },
  scrapped: { text: '已报废', cls: 'bg-red-50 text-red-600' },
};

export function SerialNumberList() {
  // [2026-09-18 权限细化·批 2 生产] 登记=serial_number_create；出库/报废=serial_number_edit（无删除）
  const { has } = usePermission();
  const [items, setItems] = useState<SerialNumber[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const [status, setStatus] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [form, setForm] = useState({ product_id: '', warehouse_id: '', serial_nos: '', source_no: '', remark: '' });

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => { setPagination(prev => ({ ...prev, page: 1 })); }, [keyword, status]);
  useEffect(() => { fetchList(); }, [pagination.page, debouncedKeyword, status]);

  const fetchList = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { status?: string; keyword?: string } = {
        page: pagination.page, page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined, status: status || undefined,
      };
      const res = await productionApi.serialNumberList(params);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setItems(res.data?.list || []);
        setPagination(prev => ({ ...prev, total: res.data?.total || 0 }));
      }
    } catch { /* 静默 */ }
    finally { if (isCurrent(seq)) setLoading(false); } // [FIX-Rev] 仅最新请求结束才收起 loading
  };

  const openRegister = async () => {
    setModalOpen(true);
    setForm({ product_id: '', warehouse_id: '', serial_nos: '', source_no: '', remark: '' });
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它（此前 Promise.all 一拒全空）
      const [p, w] = await loadOptions([
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        http.get('/v1/warehouses', { page: 1, page_size: 1000 }),
      ], '序列号登记');
      setProducts((p as any)?.data?.list || []);
      setWarehouses((w as any)?.data?.list || []);
    } catch { /* 静默 */ }
  };

  const handleRegister = async () => {
    if (!form.product_id) { message.warning('请选择产品'); return; }
    const nos = form.serial_nos.split(/[\n,，\s]+/).filter(Boolean);
    if (!nos.length) { message.warning('请输入至少一个序列号'); return; }
    setSaving(true);
    try {
      const prod = products.find(x => x.id === form.product_id);
      const wh = warehouses.find(x => x.id === form.warehouse_id);
      const res = await productionApi.registerSerialNumbers({
        product_id: form.product_id, product_code: prod?.code, product_name: prod?.name,
        warehouse_id: form.warehouse_id || null, warehouse_name: wh?.name || '',
        serial_nos: nos, source_no: form.source_no, remark: form.remark,
      });
      if (res.code === 0) {
        message.success(`已登记 ${(res.data as any)?.registered || nos.length} 个序列号`);
        setModalOpen(false);
        fetchList();
      } else { message.error(res.message || '登记失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '登记失败'); }
    finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<any>, okMsg: string, title: string, danger = false) => {
    if (!(await confirmAction({ title, danger }))) return;
    try {
      const res = await fn();
      if (res.code === 0) { message.success(okMsg); fetchList(); }
      else { message.error(res.message || '操作失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '操作失败'); }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: SerialNumber) => ReactNode;
  }
  const TH_L = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_C = 'px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-3';
  const rowCols: RowCol[] = [
    { key: 'serial_no', header: '序列号', cellCls: `${TD} font-mono text-sm font-medium text-gray-900`, cell: (item) => <span>{item.serial_no}</span> },
    { key: 'product', header: '产品', cellCls: `${TD} text-sm text-gray-700`, cell: (item) => <span>{item.product_name || '-'}</span> },
    { key: 'warehouse', header: '仓库', cellCls: `${TD} text-sm text-gray-600`, cell: (item) => <span>{item.warehouse_name || '-'}</span> },
    { key: 'source_no', header: '来源单据', cellCls: `${TD} text-sm text-gray-500`, cell: (item) => <span>{item.source_no || '-'}</span> },
    {
      key: 'status',
      header: '状态',
      headCls: TH_C,
      cellCls: 'px-4 py-3 text-center',
      cell: (item) => {
        const st = STATUS[item.status || 'in_stock'] || STATUS.in_stock;
        return <span className={`px-2 py-1 rounded-full text-xs font-medium ${st.cls}`}>{st.text}</span>;
      },
    },
    { key: 'registered_at', header: '登记时间', cellCls: `${TD} text-sm text-gray-500`, cell: (item) => <span>{(item.registered_at || '').replace('T', ' ').slice(0, 16)}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (item) => (
        <div className="flex items-center justify-end gap-1">
          {item.status === 'in_stock' && has('serial_number_edit') && (
            <>
              <button onClick={() => act(() => productionApi.serialNumberOut(item.id!), '已出库', `确定出库序列号 ${item.serial_no}？`)} title="出库" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><PackageX className="w-4 h-4" /></button>
              <button onClick={() => act(() => productionApi.serialNumberScrap(item.id!), '已报废', `确定报废序列号 ${item.serial_no}？`, true)} title="报废" className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"><ArchiveX className="w-4 h-4" /></button>
            </>
          )}
          {item.status === 'out' && <span className="text-xs text-gray-400">{item.out_at ? item.out_at.replace('T', ' ').slice(0, 16) : ''}</span>}
        </div>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'serial-number-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="序列号追踪"
        subtitle="单品级序列号台账（登记入库 / 出库 / 报废）"
        extra={
          has('serial_number_create') && (
            <button onClick={openRegister} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /><span className="hidden md:inline">登记序列号</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-4 flex-wrap">
            <BarcodeInput
              className="flex-1 min-w-[160px] max-w-md"
              value={keyword}
              onChange={setKeyword}
              onDetect={setKeyword}
              placeholder="扫码或搜索序列号 / 产品…"
            />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="form-select w-28">
              <option value="">全部状态</option>
              <option value="in_stock">在库</option>
              <option value="out">已出库</option>
              <option value="scrapped">已报废</option>
            </select>
            <div className="ml-auto">{viewMenu}</div>
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
              ) : items.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-8"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无序列号" description="登记序列号后在此跟踪" /></td></tr>
              ) : (
                items.map((item) => (
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

        {!loading && items.length > 0 && (
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))} loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        )}
      </div>

      <Modal open={modalOpen} onCancel={() => setModalOpen(false)} title="登记序列号入库" width={520}
        onOk={handleRegister} okText={saving ? '登记中...' : '登记'} confirmLoading={saving}>
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-sm text-gray-600 mb-1">产品 *</label>
            <SearchSelect
              required
              value={form.product_id}
              onChange={(v) => setForm(prev => ({ ...prev, product_id: v ?? '' }))}
              placeholder="请选择产品"
              options={products.map(x => ({ value: x.id, label: productOptionLabel(x), search: productOptionSearch(x) }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">仓库</label>
            <SearchSelect
              value={form.warehouse_id}
              onChange={(v) => setForm(prev => ({ ...prev, warehouse_id: v ?? '' }))}
              placeholder="请选择仓库"
              options={warehouses.map(x => ({ value: x.id, label: x.name }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">序列号（每行一个，或逗号/空格分隔） *</label>
            <textarea value={form.serial_nos} onChange={(e) => setForm(prev => ({ ...prev, serial_nos: e.target.value }))}
              rows={4} placeholder={'SN202608180001\nSN202608180002'} className={inputCls}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">来源单号</label>
              <input value={form.source_no} onChange={(e) => setForm(prev => ({ ...prev, source_no: e.target.value }))} placeholder="如：STIN..." className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">备注</label>
              <input value={form.remark} onChange={(e) => setForm(prev => ({ ...prev, remark: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <p className="flex items-center gap-1 text-xs text-gray-400"><ScanLine className="w-3.5 h-3.5" /> 序列号全局唯一，重复登记会被拒绝</p>
        </div>
      </Modal>
    </div>
  );
}
