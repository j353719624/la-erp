import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Pencil, Trash2, CheckCircle2, X, Undo2 } from 'lucide-react';
import { loanApi } from '@/api/inventory';
import { LoanOrder } from '@/types/inventory';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { Modal, InputNumber } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
const TYPE_TEXT: Record<string, string> = { out: '借出', in: '借入' };
const STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  returned: '已归还',
  cancelled: '已取消',
};
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-600',
  returned: 'bg-green-100 text-green-600',
  cancelled: 'bg-red-100 text-red-600',
};

export function LoanList() {
  const navigate = useNavigate();
  // [2026-09-18 权限细化] 新增=loan_order_create；编辑/确认/归还=loan_order_edit；删除=loan_order_delete
  const { has } = usePermission();
  const [loans, setLoans] = useState<LoanOrder[]>([]);
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
  const [detail, setDetail] = useState<LoanOrder | null>(null);

  // 归还弹窗状态
  const [returnTarget, setReturnTarget] = useState<LoanOrder | null>(null);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [returnSerials, setReturnSerials] = useState<Record<string, string>>({});
  const [returning, setReturning] = useState(false);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchLoans();
  }, [pagination.page, pagination.page_size, debouncedKeyword, status]);

  const fetchLoans = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { status?: string; party_name?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        status: status || undefined,
        party_name: debouncedKeyword || undefined,
      };
      const response = await loanApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setLoans(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch loans:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, no: string) => {
    if (!(await confirmAction({ title: `确定删除 ${no} 吗？`, danger: true }))) return;
    try {
      const response = await loanApi.delete(id);
      if (response.code === 0) {
        message.success(`${no} 已删除`);
        fetchLoans();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '删除失败');
    }
  };

  const handleConfirm = async (id: string, no: string, type: string) => {
    const act = type === 'out' ? '借出' : '借入';
    if (!(await confirmAction({ title: `确定确认${act}单 ${no} 吗？`, content: '确认后将按明细生成库存流水，不可撤销', danger: true }))) return;
    try {
      const response = await loanApi.confirm(id);
      if (response.code === 0) {
        message.success(`${no} 已确认`);
        fetchLoans();
      } else {
        message.error(response.message || '确认失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '确认失败');
    }
  };

  const handleCancel = async (id: string, no: string) => {
    if (!(await confirmAction({ title: `确定取消 ${no} 吗？`, danger: true }))) return;
    try {
      const response = await loanApi.cancel(id);
      if (response.code === 0) {
        message.success(`${no} 已取消`);
        fetchLoans();
      } else {
        message.error(response.message || '取消失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '取消失败');
    }
  };

  const openReturn = (lo: LoanOrder) => {
    const qtyMap: Record<string, number> = {};
    (lo.edges?.lines || lo.lines || []).forEach((l: any) => {
      qtyMap[l.id] = Number(l.qty) - Number(l.returned_qty || 0);
    });
    setReturnQty(qtyMap);
    setReturnSerials({});
    setReturnTarget(lo);
  };

  const handleReturnSubmit = async () => {
    if (!returnTarget) return;
    const lines = Object.entries(returnQty)
      .filter(([, q]) => q > 0)
      .map(([line_id, qty]) => ({
        line_id,
        qty,
        // 序列号商品归还需填写序列号（逗号分隔），非序列号商品留空即可
        serial_nos: (returnSerials[line_id] || '').split(/[,，]\s*/).filter(Boolean),
      }));
    if (lines.length === 0) {
      message.warning('请填写归还数量');
      return;
    }
    setReturning(true);
    try {
      const response = await loanApi.returnItems(returnTarget.id, lines);
      if (response.code === 0) {
        message.success('归还成功');
        setReturnTarget(null);
        fetchLoans();
      } else {
        message.error(response.message || '归还失败');
      }
    } catch (err: any) {
      message.error(err?.message || '归还失败');
    } finally {
      setReturning(false);
    }
  };

  const lines = (lo: LoanOrder) => lo.edges?.lines || lo.lines || [];

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: LoanOrder) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'loan_no', header: '单号', cell: (lo) => <span className="font-medium text-gray-900">{lo.loan_no}</span> },
    {
      key: 'loan_type',
      header: '类型',
      cell: (lo) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${lo.loan_type === 'out' ? 'bg-orange-100 text-orange-600' : 'bg-violet-100 text-violet-600'}`}>
          {TYPE_TEXT[lo.loan_type] || lo.loan_type}
        </span>
      ),
    },
    { key: 'party_name', header: '往来方', cell: (lo) => <span className="text-gray-700">{lo.party_name || '-'}</span> },
    { key: 'warehouse', header: '仓库', cell: (lo) => <span className="text-gray-500">{lo.edges?.warehouse?.name || lo.warehouse_name || '-'}</span> },
    { key: 'total_qty', header: '数量', headCls: TH_R, cellCls: `${TD} text-right`, cell: (lo) => <span className="text-gray-500">{lo.total_qty}</span> },
    { key: 'total_amount', header: '金额', headCls: TH_R, cellCls: `${TD} text-right`, cell: (lo) => <span className="font-medium text-gray-900">¥{format.currency(lo.total_amount)}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (lo) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[lo.status] || ''}`}>{STATUS_TEXT[lo.status] || lo.status}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD}`,
      cell: (lo) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            { key: 'detail', label: '查看详情', icon: <Eye className="w-4 h-4" />, onClick: () => setDetail(lo) },
            ...(lo.status === 'draft'
              ? [
                  ...(has('loan_order_edit')
                    ? [
                        { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/inventory/loans/${lo.id}`) },
                        { key: 'confirm', label: '确认', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => handleConfirm(lo.id, lo.loan_no, lo.loan_type) },
                        { key: 'cancel', label: '取消', icon: <X className="w-4 h-4" />, onClick: () => handleCancel(lo.id, lo.loan_no) },
                      ]
                    : []),
                  ...(has('loan_order_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(lo.id, lo.loan_no) }]
                    : []),
                ]
              : []),
            ...(lo.status === 'confirmed' && has('loan_order_edit')
              ? [{ key: 'return', label: '归还', icon: <Undo2 className="w-4 h-4" />, onClick: () => openReturn(lo) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'loan-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="借出借入"
        subtitle="借出/借入及归还管理（仅影响库存，不涉资金）"
        extra={
          has('loan_order_create') && (
            <button onClick={() => navigate('/inventory/loans/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              新建借出/借入
            </button>
          )
        }
      />

      <div className="card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Search className="w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
              placeholder="搜索往来方..."
              className="form-input"
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-select">
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="confirmed">已确认</option>
            <option value="returned">已归还</option>
            <option value="cancelled">已取消</option>
          </select>
          <button onClick={fetchLoans} className="btn-primary">查询</button>
          <div className="ml-auto">{viewMenu}</div>
        </div>
      </div>

      <div className="card p-0">
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
                <tr><td colSpan={visibleColumns.length}><TableSkeleton /></td></tr>
              ) : loans.length === 0 ? (
                <tr><td colSpan={visibleColumns.length}><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无借出借入单" /></td></tr>
              ) : (
                loans.map((lo) => (
                  <tr key={lo.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(lo)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-gray-100">
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(p => ({ ...p, page }))}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        </div>
      </div>

      {/* 详情弹窗 */}
      <Modal open={!!detail} onCancel={() => setDetail(null)} footer={null} title={`借出借入单 ${detail?.loan_no || ''}`} width={720}>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><div className="text-gray-400">类型</div><div className="font-medium">{TYPE_TEXT[detail.loan_type]}</div></div>
              <div><div className="text-gray-400">往来方</div><div className="font-medium">{detail.party_name || '-'}</div></div>
              <div><div className="text-gray-400">仓库</div><div className="font-medium">{detail.edges?.warehouse?.name || '-'}</div></div>
              <div><div className="text-gray-400">状态</div><div className="font-medium">{STATUS_TEXT[detail.status]}</div></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2 text-left text-xs text-gray-500">商品</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">数量</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">已归还</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">成本</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">金额</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines(detail).map((l: any) => (
                    <tr key={l.id || l.line_no}>
                      <td className="px-4 py-2 text-sm text-gray-700">{l.product_code} - {l.product_name}</td>
                      <td className="px-4 py-2 text-right text-sm">{l.qty}</td>
                      <td className="px-4 py-2 text-right text-sm text-green-600">{l.returned_qty || 0}</td>
                      <td className="px-4 py-2 text-right text-sm">¥{format.currency(l.unit_cost)}</td>
                      <td className="px-4 py-2 text-right text-sm">¥{format.currency(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.remark && <div className="text-sm text-gray-500">备注：{detail.remark}</div>}
          </div>
        )}
      </Modal>

      {/* 归还弹窗 */}
      <Modal
        open={!!returnTarget}
        onCancel={() => setReturnTarget(null)}
        title={`归还 ${returnTarget?.loan_no || ''}（${returnTarget ? TYPE_TEXT[returnTarget.loan_type] : ''}）`}
        onOk={handleReturnSubmit}
        okText="确认归还"
        confirmLoading={returning}
        width={640}
      >
        {returnTarget && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">填写每行的归还数量（借出归还=入库，借入归还=出库）</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2 text-left text-xs text-gray-500">商品</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">已借数量</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">已归还</th>
                    <th className="px-4 py-2 text-right text-xs text-gray-500">本次归还</th>
                    <th className="px-4 py-2 text-left text-xs text-gray-500">归还序列号（逗号分隔，序列号商品必填）</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines(returnTarget).map((l: any) => {
                    const remain = Number(l.qty) - Number(l.returned_qty || 0);
                    return (
                      <tr key={l.id}>
                        <td className="px-4 py-2 text-sm text-gray-700">{l.product_code} - {l.product_name}</td>
                        <td className="px-4 py-2 text-right text-sm">{l.qty}</td>
                        <td className="px-4 py-2 text-right text-sm text-green-600">{l.returned_qty || 0}</td>
                        <td className="px-4 py-2 text-right">
                          <InputNumber
                            min={0}
                            max={remain}
                            precision={4}
                            value={returnQty[l.id] ?? 0}
                            onChange={(v) => setReturnQty(prev => ({ ...prev, [l.id]: v || 0 }))}
                            style={{ width: 110 }}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={returnSerials[l.id] || ''}
                            onChange={(e) => setReturnSerials(prev => ({ ...prev, [l.id]: e.target.value }))}
                            placeholder="SN0001, SN0002"
                            className="form-input w-48"
                           autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
