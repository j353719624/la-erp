import { useCallback, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { employeeChangeApi, EmployeeChange, EMPLOYEE_CHANGE_TYPE_TEXT, EMPLOYEE_CHANGE_TYPE_COLOR } from '@/api/hr';
import { format } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

/**
 * 人事异动流水（入转调离留痕，2026-09-19 人事第三批③）
 *
 * 只读审计：由员工档案的建档/编辑自动追加（入职/转正/调岗/调部门/调薪/离职/复职），
 * 不提供手工新增/编辑/删除（防止审计被改写）。
 */
export function EmployeeChangeList() {
  const [list, setList] = useState<EmployeeChange[]>([]);
  const [loading, setLoading] = useState(true);
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', change_type: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [changeType, setChangeType] = useState(String(urlFilters.change_type || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  useEffect(() => {
    syncUrl({ keyword, change_type: changeType, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, changeType, pagination.page, pagination.page_size]);

  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await employeeChangeApi.list({
        page: pagination.page, page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined, change_type: changeType || undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return;
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '加载失败');
    } finally { if (isCurrent(seq)) setLoading(false); }
  }, [pagination.page, pagination.page_size, debouncedKeyword, changeType, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: EmployeeChange) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'effective_date', header: '生效日期', cell: (c) => <span className="text-gray-600 text-sm">{format.date(c.effective_date)}</span> },
    { key: 'employee_name', header: '员工', cell: (c) => <span className="font-medium text-gray-900">{c.employee_name}</span> },
    {
      key: 'change_type',
      header: '异动类型',
      cell: (c) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${EMPLOYEE_CHANGE_TYPE_COLOR[c.change_type] || 'bg-gray-100 text-gray-500'}`}>
          {EMPLOYEE_CHANGE_TYPE_TEXT[c.change_type] || c.change_type}
        </span>
      ),
    },
    { key: 'before_value', header: '变更前', cell: (c) => <span className="text-gray-500 text-sm">{c.before_value || '—'}</span> },
    {
      key: 'after_value',
      header: '变更后',
      cell: (c) => (
        <span className="inline-flex items-center gap-1 text-gray-900 text-sm">
          {c.before_value ? <ArrowRight className="w-3 h-3 text-gray-300" /> : null}
          {c.after_value || '—'}
        </span>
      ),
    },
    { key: 'reason', header: '原因', cell: (c) => <span className="text-gray-500 text-sm">{c.reason || '-'}</span> },
    { key: 'created_at', header: '记录时间', cell: (c) => <span className="text-gray-400 text-xs">{format.date(c.created_at || '')}</span> },
  ];
  const { visibleColumns, menu: viewMenu } = useTableView({ pageKey: 'employee-change-list', columns: rowCols });

  const filterNote = changeType ? `类型「${EMPLOYEE_CHANGE_TYPE_TEXT[changeType] || changeType}」` : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="人事异动"
        subtitle="入转调离自动留痕（建档/调岗/调部门/调薪/离职/复职由员工档案变更自动生成，审计流水不可修改）"
      />
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <input type="text" placeholder="搜索员工姓名..." value={keyword} onChange={(e) => { setKeyword(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:max-w-xs" />
          <select value={changeType} onChange={(e) => { setChangeType(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:w-40">
            <option value="">全部类型</option>
            {Object.entries(EMPLOYEE_CHANGE_TYPE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="ml-auto flex items-center">{viewMenu}</div>
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
              {loading ? (<tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>)
                : list.length === 0 ? (
                  <tr><td colSpan={visibleColumns.length} className="px-6">
                    <ListEmpty
                      keyword={keyword}
                      filterNote={filterNote}
                      onClear={() => { setKeyword(''); setChangeType(''); setPagination(p => ({ ...p, page: 1 })); }}
                      title="暂无异动记录"
                      description="新增或编辑员工档案（调岗/调部门/调薪/离职等）后，这里会自动出现留痕记录"
                    />
                  </td></tr>
                )
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
        <div className="p-4 border-t border-gray-100">
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total} onPageChange={(page) => setPagination(p => ({ ...p, page }))} loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        </div>
      </div>
    </div>
  );
}
