import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Edit, Trash2, Network, Power, PowerOff } from 'lucide-react';
import { productionApi } from '@/api/production';
import { Bom, BomTreeResult, BomTreeNode } from '@/types/production';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
export function BomList() {
  // [2026-09-18 权限细化·批 2 生产] 新建=bom_create；启用/停用/编辑=bom_edit；删除=bom_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [boms, setBoms] = useState<Bom[]>([]);
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

  // 多级 BOM 结构树弹窗
  const [treeVisible, setTreeVisible] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeData, setTreeData] = useState<BomTreeResult | null>(null);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const openTree = async (id: string) => {
    setTreeVisible(true);
    setTreeLoading(true);
    setTreeData(null);
    try {
      const res = await productionApi.getBomTree(id);
      if (res.code === 0) {
        setTreeData(res.data || null);
      } else {
        message.error(res.message || '加载结构失败');
      }
    } catch (e) {
      console.error('Failed to load BOM tree:', e);
      message.error(e instanceof Error && e.message ? e.message : '加载结构失败');
    } finally {
      setTreeLoading(false);
    }
  };

  const fmt = (v: string | number | undefined, d = 2) => (v === undefined || v === null || v === '' ? '0' : Number(v).toFixed(d));

  useEffect(() => {
    fetchBoms();
  }, [pagination.page, pagination.page_size, debouncedKeyword]);

  const fetchBoms = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        page_size: pagination.page_size,
        // 后端 boms List 读 code（不读 keyword）——此前搜索失效
        code: debouncedKeyword || undefined,
      };
      const response = await productionApi.bomList(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        const list = response.data?.list || [];
        const mappedList = list.map((item: any) => ({
          id: item.id,
          bom_code: item.code,
          product_name: item.product_name,
          version: item.version,
          component_count: (item.edges?.items || []).length,
          status: item.status,
        }));
        setBoms(mappedList);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch BOMs:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, code: string) => {
    if (!(await confirmAction({ title: `确定删除BOM ${code} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await productionApi.deleteBom(id);
      if (response.code === 0) {
        message.success(`BOM ${code} 已删除`);
        fetchBoms();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete BOM:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // 启用/停用 BOM（调用后端 activate/deactivate 状态机接口）
  const handleToggleStatus = async (item: any, toActive: boolean) => {
    const action = toActive ? '启用' : '停用';
    if (!(await confirmAction({
      title: `确定${action}BOM ${item.bom_code} 吗？`,
      content: toActive ? '启用后该 BOM 可用于工单/MRP/组装' : '停用后新工单不可选用该 BOM',
      danger: !toActive,
    }))) return;
    try {
      const res = toActive
        ? await productionApi.activateBom(item.id)
        : await productionApi.deactivateBom(item.id);
      if (res.code === 0) {
        message.success(`BOM ${item.bom_code} 已${action}`);
        fetchBoms();
      } else {
        message.error(res.message || `${action}失败`);
      }
    } catch (err) {
      console.error('Failed to toggle BOM status:', err);
      message.error(err instanceof Error && err.message ? err.message : `${action}失败，请稍后重试`);
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Bom) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'bom_code', header: 'BOM编码', cell: (item) => <span className="font-medium text-gray-900">{item.bom_code}</span> },
    { key: 'product_name', header: '产品名称', cell: (item) => <span className="text-gray-900">{item.product_name}</span> },
    { key: 'version', header: '版本', cell: (item) => <span className="text-gray-500 text-sm">{item.version}</span> },
    { key: 'component_count', header: '组件数量', cell: (item) => <span className="text-gray-500 text-sm">{item.component_count}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(item.status)}`}>{format.statusText(item.status)}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (item) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            ...(has('bom_edit')
              ? [
                  item.status === 'inactive'
                    ? { key: 'toggle', label: '启用', icon: <Power className="w-4 h-4" />, onClick: () => handleToggleStatus(item, true) }
                    : { key: 'toggle', label: '停用', icon: <PowerOff className="w-4 h-4" />, onClick: () => handleToggleStatus(item, false) },
                ]
              : []),
            { key: 'tree', label: '多级结构', icon: <Network className="w-4 h-4" />, onClick: () => openTree(item.id) },
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => navigate(`/production/bom/${item.id}`) },
            ...(has('bom_edit')
              ? [{ key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, onClick: () => navigate(`/production/bom/${item.id}/edit`) }]
              : []),
            ...(has('bom_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.bom_code) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'bom-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="生产管理"
        subtitle="BOM管理"
        extra={
          has('bom_create') && (
            <button onClick={() => navigate('/production/bom/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建BOM</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索BOM编码或产品名称..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
            />
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
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : boms.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无BOM数据" /></td></tr>
              ) : (
                boms.map((item) => (
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

        {!loading && boms.length > 0 && (
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

      {/* 多级 BOM 结构树弹窗 */}
      <Modal
        open={treeVisible}
        onCancel={() => setTreeVisible(false)}
        width={860}
        footer={null}
        title={treeData ? `多级 BOM 结构 — ${treeData.product_name || treeData.code}（${treeData.product_code || ''}）` : '多级 BOM 结构'}
      >
        {treeLoading ? (
          <TableSkeleton rows={6} />
        ) : !treeData ? (
          <EmptyState title="暂无结构数据" />
        ) : (
          <div>
            <div className="flex flex-wrap gap-4 mb-3 text-sm text-gray-600">
              <span>BOM：<b className="text-gray-900">{treeData.code}</b></span>
              <span>版本：<b className="text-gray-900">{treeData.version}</b></span>
              <span>基准数量：<b className="text-gray-900">{fmt(treeData.qty_per, 0)}</b></span>
              <span>物料成本合计：<b className="text-blue-600">{format.currency(Number(treeData.total_cost || 0))}</b></span>
            </div>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">层级 · 物料</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">单位</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">数量</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">总用量</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">损耗%</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">单位成本</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">行成本</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">结构</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <TreeRows nodes={treeData.children || []} fmt={fmt} />
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// 递归渲染多级 BOM 树行
function TreeRows({ nodes, fmt, base = 0 }: { nodes: BomTreeNode[]; fmt: (v: string | number | undefined, d?: number) => string; base?: number }) {
  const rows: React.ReactNode[] = [];
  const walk = (list: BomTreeNode[], depth: number) => {
    list.forEach((n, idx) => {
      const isLast = idx === list.length - 1;
      rows.push(
        <tr key={`${n.product_id}-${depth}-${idx}`} className={depth > 0 ? 'bg-blue-50/30' : ''}>
          <td className="px-3 py-2">
            <div className="flex items-center" style={{ paddingLeft: `${depth * 22}px` }}>
              {/* 层级连接线 */}
              {depth > 0 && (
                <span className="mr-2 text-gray-400 select-none">
                  {base === 0 && depth > 0 ? (isLast ? '└─ ' : '├─ ') : '│ '}
                </span>
              )}
              <span className="text-xs text-gray-400 mr-2 w-4">L{depth + 1}</span>
              <span className="text-sm font-medium text-gray-900">{n.product_name}</span>
              {n.product_code && <span className="text-xs text-gray-400 ml-2">（{n.product_code}）</span>}
              {n.spec && <span className="text-xs text-gray-400 ml-2">{n.spec}</span>}
            </div>
          </td>
          <td className="px-3 py-2 text-sm text-gray-500">{n.unit_name || '-'}</td>
          <td className="px-3 py-2 text-right text-sm text-gray-600">{fmt(n.qty)}</td>
          <td className="px-3 py-2 text-right text-sm font-medium text-gray-900">{fmt(n.total_qty)}</td>
          <td className="px-3 py-2 text-right text-sm text-gray-500">{fmt(n.scrap_rate, 1)}</td>
          <td className="px-3 py-2 text-right text-sm text-gray-600">{format.currency(Number(n.unit_cost || 0))}</td>
          <td className="px-3 py-2 text-right text-sm text-gray-900">{format.currency(Number(n.line_cost || 0))}</td>
          <td className="px-3 py-2 text-center">
            {n.circular ? (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-md">循环!</span>
            ) : n.has_bom ? (
              <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">含子BOM</span>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </td>
        </tr>
      );
      if (n.children && n.children.length > 0) {
        walk(n.children, depth + 1);
      }
    });
  };
  walk(nodes, base);
  return <>{rows}</>;
}