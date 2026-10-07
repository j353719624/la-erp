import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Plus, Search, Play, Download, RefreshCw, Trash2, Pencil, Eye } from 'lucide-react';
import { customReportApi, CustomReportDefinition, CustomReportRunResult } from '@/api/report';
import { format } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PaginationParams } from '@/types';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { RecordDetailModal } from '@/components/RecordDetailModal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
const CATEGORY_TEXT: Record<string, string> = {
  sales: '销售', purchase: '采购', inventory: '库存', finance: '财务', custom: '自定义',
};

const PRESET_SQL: Record<string, string> = {
  sales: `SELECT so.order_no AS "订单号", so.customer_name AS "客户", so.total_amount AS "金额", so.order_date AS "日期"
FROM sales_orders so WHERE so.deleted_at IS NULL AND so.status IN ('confirmed','approved','closed') ORDER BY so.created_at DESC LIMIT 20`,
  inventory: `SELECT p.code AS "商品编码", p.name AS "商品名称", b.warehouse_id AS "仓库", b.qty_available AS "可用数量", b.avg_cost AS "平均成本", (b.qty_available * b.avg_cost) AS "库存价值"
FROM inventory_balances b JOIN products p ON p.id = b.product_id ORDER BY b.qty_available DESC LIMIT 20`,
  finance: `SELECT a.code AS "科目编码", a.name AS "科目名称", ve.direction AS "方向", ve.amount AS "金额"
FROM voucher_entries ve JOIN accounts a ON a.id = ve.account_id WHERE ve.deleted_at IS NULL ORDER BY ve.id DESC LIMIT 20`,
};

export function CustomReportList() {
  const [list, setList] = useState<CustomReportDefinition[]>([]);
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
  const [category, setCategory] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CustomReportDefinition | null>(null);
  // [易用性] 「查看」只读详情（列表列 + 备注/创建时间）
  const [detail, setDetail] = useState<CustomReportDefinition | null>(null);
  const [form, setForm] = useState({
    report_code: '', report_name: '', category: 'custom', query_sql: '', remark: '',
  });
  const [preview, setPreview] = useState<CustomReportRunResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runResult, setRunResult] = useState<CustomReportRunResult | null>(null);
  const [runningId, setRunningId] = useState('');

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { keyword?: string; category?: string } = {
        page: pagination.page, page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined, category: category || undefined,
      };
      const res = await customReportApi.list(params);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch { /* 静默 */ } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  useEffect(() => { fetchList(); }, [pagination.page, pagination.page_size, debouncedKeyword, category]);

  const openCreate = () => {
    setEditing(null);
    setForm({ report_code: '', report_name: '', category: 'custom', query_sql: '', remark: '' });
    setPreview(null);
    setModalOpen(true);
  };

  const openEdit = (r: CustomReportDefinition) => {
    setEditing(r);
    setForm({ report_code: r.report_code, report_name: r.report_name, category: r.category || 'custom', query_sql: r.query_sql, remark: r.remark || '' });
    setPreview(null);
    setModalOpen(true);
  };

  const applyPreset = (cat: string) => {
    setForm(prev => ({ ...prev, category: cat, query_sql: PRESET_SQL[cat] || prev.query_sql }));
    setPreview(null);
  };

  const handlePreview = async () => {
    if (!form.query_sql.trim()) { message.warning('请先填写查询 SQL'); return; }
    setPreviewLoading(true);
    try {
      const res = await customReportApi.runSQL(form.query_sql);
      if (res.code === 0) {
        setPreview(res.data);
        message.success(`预览成功：${res.data.total} 行`);
      } else message.error(res.message || 'SQL 执行失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : 'SQL 执行失败，请检查语句后重试'); }
    finally { setPreviewLoading(false); }
  };

  const handleSave = async () => {
    if (!form.report_code || !form.report_name || !form.query_sql.trim()) {
      message.warning('请填写报表编码/名称/查询 SQL');
      return;
    }
    setSaving(true);
    try {
      const data = {
        report_code: form.report_code, report_name: form.report_name,
        category: form.category, query_sql: form.query_sql, remark: form.remark || undefined,
      };
      const res = editing
        ? await customReportApi.update(editing.id, data)
        : await customReportApi.create(data);
      if (res.code === 0) {
        message.success(editing ? '报表已更新' : `报表 ${res.data?.report_code} 已创建`);
        setModalOpen(false);
        fetchList();
      } else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败，请稍后重试'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (r: CustomReportDefinition) => {
    if (!(await confirmAction({ title: `确定删除报表 ${r.report_code} 吗？`, danger: true }))) return;
    const res = await customReportApi.delete(r.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); }
    else message.error(res.message || '删除失败');
  };

  const handleRun = async (r: CustomReportDefinition) => {
    setRunningId(r.id);
    setRunResult(null);
    try {
      const res = await customReportApi.run(r.id);
      if (res.code === 0) setRunResult(res.data);
      else message.error(res.message || '执行失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '执行失败，请稍后重试'); }
    finally { setRunningId(''); }
  };

  const handleExport = async (r: CustomReportDefinition) => {
    // 统一 http.download：自动携带 token、走 blob 拦截器与错误归一化（P3 修复，替代手写 XHR）
    try {
      const blob = await customReportApi.download(r.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${r.report_code}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '导出失败');
    }
  };

  const renderResult = (res: CustomReportRunResult | null, emptyText: string) => {
    if (!res) return <div className="py-8 text-center text-gray-400 text-sm">{emptyText}</div>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="bg-gray-50">
              {(res.labels || res.columns || []).map((col, i) => (
                <th key={i} className="px-3 py-2 text-left text-xs font-medium text-gray-500">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {res.rows.length === 0 ? (
              <tr><td colSpan={(res.columns || []).length || 1} className="px-3 py-6 text-center text-gray-400">无数据</td></tr>
            ) : res.rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-gray-50">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-sm text-gray-700">{cell == null ? '-' : String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // [易用性] 列描述符：列表表格与「查看」详情共用同一份（避免两处字段映射不同步）
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (r: CustomReportDefinition) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase';
  const TD = 'px-6 py-4';
  const statusText = (s?: string) => (s === 'active' ? '启用' : s === 'draft' ? '草稿' : '停用');
  const statusCls = (s?: string) => (s === 'active' ? 'bg-green-50 text-green-600' : s === 'draft' ? 'bg-yellow-50 text-yellow-600' : 'bg-gray-100 text-gray-500');
  const runBtn = (r: CustomReportDefinition) => (
    <RowActions
      actions={[
        { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => setDetail(r) },
        {
          key: 'run',
          label: runningId === r.id ? '运行中…' : '运行',
          icon: runningId === r.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />,
          disabled: runningId === r.id,
          onClick: () => handleRun(r),
        },
        { key: 'export', label: '导出 CSV', icon: <Download className="w-4 h-4" />, onClick: () => handleExport(r) },
        { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(r) },
        { key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(r) },
      ]}
    />
  );
  const rowCols: RowCol[] = [
    { key: 'report_code', header: '编码', headCls: TH_L, cellCls: `${TD} font-medium text-gray-900`, cell: (r) => r.report_code },
    { key: 'report_name', header: '名称', headCls: TH_L, cellCls: `${TD} text-gray-600`, cell: (r) => r.report_name },
    { key: 'category', header: '分类', headCls: TH_L, cellCls: TD, cell: (r) => <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{CATEGORY_TEXT[r.category || 'custom'] || r.category}</span> },
    { key: 'query_sql', header: 'SQL', headCls: TH_L, cellCls: `${TD} text-gray-500 text-sm max-w-xs truncate`, cell: (r) => r.query_sql },
    { key: 'status', header: '状态', headCls: TH_L, cellCls: TD, cell: (r) => <span className={`px-2 py-0.5 rounded text-xs ${statusCls(r.status)}`}>{statusText(r.status)}</span> },
    { key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`, cell: runBtn },
  ];

  // [2026-09-12] 详情补充列：未进列表但详情应可见（详情不受列表裁剪）
  const detailCols: RowCol[] = [...rowCols, { key: 'remark', header: '备注', headCls: TH_L, cellCls: `${TD} text-gray-500 text-sm`, cell: (r) => r.remark || '-' }];

  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  // ⚠️ 下方「查询结果」表格是**运行 SQL 后的动态列**，不接入视图（列不固定，接入反而会丢列）
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'custom-report-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="自定义报表"
        subtitle="配置只读 SQL 生成报表，支持预览与导出"
        extra={
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" />
            <span className="hidden md:inline">新建报表</span>
          </button>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" placeholder="搜索报表编码/名称..." value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
            />
          </div>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-select md:w-40">
            <option value="">全部分类</option>
            {Object.entries(CATEGORY_TEXT).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          <div className="md:ml-auto">{viewMenu}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => <th key={c.key} className={c.headCls}>{c.header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无自定义报表" description="点击右上角「新建报表」配置查询 SQL" /></td></tr>
              ) : list.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  {visibleColumns.map((c) => <td key={c.key} className={c.cellCls}>{c.cell(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        </div>
      </div>

      {/* [易用性] 只读详情：字段名 : 值（含未进列表的备注等字段） */}
      <RecordDetailModal
        open={!!detail}
        title={detail ? `报表详情 · ${detail.report_code}` : '报表详情'}
        record={detail}
        columns={detailCols}
        onClose={() => setDetail(null)}
      />

      {/* 运行结果 */}
      {runResult && (
        <div className="card">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800">查询结果</h2>
            <span className="text-xs text-gray-500">{runResult.total} 行（最多 1000 行）</span>
          </div>
          <div className="p-4">{renderResult(runResult, '')}</div>
        </div>
      )}

      {/* 新建/编辑 */}
      <Modal title={editing ? `编辑报表 ${editing.report_code}` : '新建自定义报表'} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} width={860}>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">报表编码 *</label>
              <input type="text" value={form.report_code} onChange={(e) => setForm(prev => ({ ...prev, report_code: e.target.value }))} className="form-input" placeholder="如：SALES_TOP"  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">报表名称 *</label>
              <input type="text" value={form.report_name} onChange={(e) => setForm(prev => ({ ...prev, report_name: e.target.value }))} className="form-input" placeholder="如：销售 Top 20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">分类</label>
              <select value={form.category} onChange={(e) => setForm(prev => ({ ...prev, category: e.target.value }))} className="form-select">
                {Object.entries(CATEGORY_TEXT).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
              <input type="text" value={form.remark} onChange={(e) => setForm(prev => ({ ...prev, remark: e.target.value }))} className="form-input" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">快速模板</label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => applyPreset('sales')} className="btn-secondary text-xs px-3 py-1">销售订单</button>
              <button type="button" onClick={() => applyPreset('inventory')} className="btn-secondary text-xs px-3 py-1">库存余额</button>
              <button type="button" onClick={() => applyPreset('finance')} className="btn-secondary text-xs px-3 py-1">科目流水</button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">查询 SQL（只读，仅支持 SELECT） *</label>
            <textarea
              value={form.query_sql}
              onChange={(e) => setForm(prev => ({ ...prev, query_sql: e.target.value }))}
              rows={6}
              className="form-input font-mono text-xs"
              placeholder="SELECT ... FROM ... WHERE ..."
            />
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={handlePreview} disabled={previewLoading} className="btn-secondary flex items-center gap-1 text-sm">
              {previewLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              试运行预览
            </button>
            {preview && <span className="text-xs text-gray-500">共 {preview.total} 行</span>}
          </div>
          {preview && <div className="border border-gray-200 rounded-lg p-3 max-h-64 overflow-auto">{renderResult(preview, '')}</div>}

          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {saving ? '保存中...' : '保存报表'}
            </button>
            <button onClick={() => setModalOpen(false)} className="px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">取消</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
