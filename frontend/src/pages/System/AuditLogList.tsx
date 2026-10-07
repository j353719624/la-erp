import { useCallback, useEffect, useState } from 'react';
import { Search, Clock, Download } from 'lucide-react';
import { http } from '@/utils/request';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Pagination } from '@/components/Pagination';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { exportCsv } from '@/utils/exportCsv';
import { format } from '@/utils/format';
import { message } from '@/utils/appMessage';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

interface AuditLogItem {
  id: string;
  username: string;
  action: string;
  method: string;
  path: string;
  summary: string;
  ip: string;
  status_code: number;
  duration_ms: number;
  created_at: string;
}

interface AuditListResult {
  total: number;
  list: AuditLogItem[];
}

const ACTION_TEXT: Record<string, string> = {
  create: '新增',
  update: '修改',
  delete: '删除',
  write: '写入',
};

const ACTION_COLOR: Record<string, string> = {
  create: 'bg-green-50 text-green-600',
  update: 'bg-blue-50 text-blue-600',
  delete: 'bg-red-50 text-red-600',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function AuditLogList() {
  const [list, setList] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（排障时把链接发给同事，条件不丢）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ username: '', action: '', start_date: '', end_date: '', page: 1, page_size: 20 });
  const [username, setUsername] = useState(urlFilters.username);
  const [action, setAction] = useState(urlFilters.action);
  // [2026-09-12] 日期区间筛选（U-02）：快捷区间 + 起止日期，条件写 URL（排障链接可直接发给同事）
  const [dateRange, setDateRange] = useState({ start_date: urlFilters.start_date, end_date: urlFilters.end_date });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL
  useEffect(() => {
    syncUrl({ username, action, start_date: dateRange.start_date, end_date: dateRange.end_date, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, action, dateRange.start_date, dateRange.end_date, pagination.page, pagination.page_size]);
  // 请求竞态守卫：快速切换搜索/筛选/翻页时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await http.get<AuditListResult>('/v1/audit-logs', {
        page: pagination.page,
        page_size: pagination.page_size,
        username: username || undefined,
        action: action || undefined,
        // [2026-09-12] 日期区间（U-02）：end_date 含当天整天（后端 parseEndDate 口径）
        start_date: dateRange.start_date || undefined,
        end_date: dateRange.end_date || undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch {
      // 静默
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, username, action, dateRange.start_date, dateRange.end_date, nextSeq, isCurrent]);

  // [2026-09-12] 导出 CSV（S-04）：按**当前筛选条件分页拉取全量**（后端 ClampPageSize 钳制 1000/页，
  // 单次请求 page_size>1000 会被截到 1000），内容与列表同口径；权限由 exportCsv 统一校验（import_export）
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const PAGE = 1000; // 与后端 middleware.MaxPageSize 对齐（超限会被钳制）
      const MAX = 10000; // 导出上限：防超大 CSV 拖垮浏览器
      const all: AuditLogItem[] = [];
      let total = 0;
      for (let p = 1; all.length < MAX; p += 1) {
        const res = await http.get<AuditListResult>('/v1/audit-logs', {
          page: p,
          page_size: PAGE,
          username: username || undefined,
          action: action || undefined,
          start_date: dateRange.start_date || undefined,
          end_date: dateRange.end_date || undefined,
        });
        if (res.code !== 0) {
          message.error(res.message || '导出失败');
          return;
        }
        total = res.data?.total ?? 0;
        const batch = res.data?.list ?? [];
        all.push(...batch);
        if (batch.length < PAGE) break; // 已到末页
      }
      const rows = all.slice(0, MAX).map((l) => [
        formatTime(l.created_at),
        l.username,
        ACTION_TEXT[l.action] || l.action,
        `${l.method} ${l.path}`,
        l.ip,
        l.status_code,
        l.duration_ms,
      ]);
      exportCsv(
        `操作日志_${format.today()}.csv`,
        ['时间', '用户', '操作', '接口', 'IP', '状态码', '耗时(ms)'],
        rows,
      );
      message.success(total > rows.length ? `已导出 ${rows.length} 条（共 ${total} 条，超出 ${MAX} 上限部分未导出）` : `已导出 ${rows.length} 条`);
    } catch (err) {
message.error(err instanceof Error && err.message ? err.message : '导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: AuditLogItem) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-3 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'created_at', header: '时间', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => <span>{formatTime(item.created_at)}</span> },
    { key: 'username', header: '用户', cellCls: `${TD} font-medium text-gray-900`, cell: (item) => <span>{item.username || '-'}</span> },
    {
      key: 'action',
      header: '操作',
      cell: (item) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLOR[item.action] || 'bg-gray-100 text-gray-600'}`}>
          {ACTION_TEXT[item.action] || item.action}
        </span>
      ),
    },
    {
      key: 'path',
      header: '接口',
      cellCls: 'px-6 py-3 max-w-[320px]',
      cell: (item) => (
        <span className="text-gray-600 text-sm font-mono text-xs truncate block">
          <span className="text-gray-400">{item.method}</span> {item.path}
        </span>
      ),
    },
    { key: 'ip', header: 'IP', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => <span>{item.ip}</span> },
    {
      key: 'status_code',
      header: '状态',
      cell: (item) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.status_code < 400 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
          {item.status_code}
        </span>
      ),
    },
    { key: 'duration_ms', header: '耗时', cellCls: `${TD} text-gray-500 text-sm`, cell: (item) => <span>{item.duration_ms}ms</span> },
  ];
  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享（本表无操作列，全部列均可隐藏）
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'audit-log-list',
    columns: rowCols,
    locked: { leading: ['created_at'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="操作日志"
        subtitle="系统写操作审计记录"
        extra={
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm text-gray-400">
              <Clock className="w-4 h-4" />
              保留最近操作记录
            </span>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="btn-secondary flex items-center gap-1.5"
              title="按当前筛选条件导出 CSV（最多 10000 条）——留档/审计用"
            >
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">{exporting ? '导出中…' : '导出 CSV'}</span>
            </button>
          </div>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索用户名..."
              value={username}
              onChange={(e) => { setUsername(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
             autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
          </div>
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
            className="form-input md:w-40"
          >
            <option value="">全部操作</option>
            <option value="create">新增</option>
            <option value="update">修改</option>
            <option value="delete">删除</option>
          </select>
          {/* [2026-09-12] 日期区间筛选（U-02）：快捷区间 + 起止日期（排障链接可直接发给同事，日期也随 URL 带走） */}
          <DateRangeFilter value={dateRange} onChange={(v) => { setDateRange(v); setPagination(prev => ({ ...prev, page: 1 })); }} />
          <div className="md:ml-auto">{viewMenu}</div>
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
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={8} /></td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6">
                  {username || action || dateRange.start_date || dateRange.end_date ? (
                    // [2026-09-13 审查修复] 空态区分筛选态：此前无条件显示"暂无操作日志"，筛了条件没结果会误导
                    <EmptyState
                      title="没有符合当前条件的操作日志"
                      description={`当前条件：${[
                        username ? `用户「${username}」` : '',
                        action ? `动作「${action}」` : '',
                        dateRange.start_date || dateRange.end_date ? `日期 ${dateRange.start_date || '不限'} ~ ${dateRange.end_date || '不限'}` : '',
                      ].filter(Boolean).join(' + ')}`}
                      action={
                        <button type="button" className="btn-secondary" onClick={() => { setUsername(''); setAction(''); setDateRange({ start_date: '', end_date: '' }); setPagination(prev => ({ ...prev, page: 1 })); }}>
                          清空筛选
                        </button>
                      }
                    />
                  ) : (
                    <EmptyState title="暂无操作日志" description="系统写操作将自动记录于此" />
                  )}
                </td></tr>
              ) : (
                list.map(item => (
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

        {!loading && list.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        )}
      </div>
    </div>
  );
}
