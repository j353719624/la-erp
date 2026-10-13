import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
import { categoryApi } from '@/api/product';
import { CategoryTreeNode } from '@/types/product';
import { format } from '@/utils/format';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { flattenCategoryTree } from '@/utils/categoryTree';
import { useTableView } from '@/hooks/useTableView';
import { RowActions } from '@/components/RowActions';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import type { ReactNode } from 'react';

const DOMAIN_LABEL: Record<string, string> = {
  product: '商品分类',
  customer: '客户分类',
  supplier: '供应商分类',
};

export function CategoryList() {
  const navigate = useNavigate();
  const { domain = 'product' } = useParams<{ domain: string }>();
  const domainLabel = DOMAIN_LABEL[domain] || '基础分类';
  // 全量分类树（无分页截断），父级/子级同屏按层级展示
  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  // 折叠的分类 id 集合（空 = 全部展开）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const fetchTree = async () => {
    setLoading(true);
    try {
      const response = await categoryApi.tree(domain);
      if (response.code === 0) setTree(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setKeyword('');
    fetchTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  // 前序扁平行（含层级/全路径）
  const flatRows = useMemo(() => flattenCategoryTree(tree), [tree]);

  // 可见行：普通模式按折叠状态隐藏子级；搜索模式显示命中节点及其祖先链
  const visibleRows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) {
      return flatRows.filter((f) => !f.pathIds.slice(0, -1).some((pid) => collapsed.has(pid)));
    }
    const keep = new Set<string>();
    for (const f of flatRows) {
      if (
        f.node.name.toLowerCase().includes(kw) ||
        f.node.code.toLowerCase().includes(kw) ||
        f.path.toLowerCase().includes(kw)
      ) {
        f.pathIds.forEach((pid) => keep.add(pid));
      }
    }
    return flatRows.filter((f) => keep.has(f.node.id));
  }, [flatRows, keyword, collapsed]);

  const toggleExpand = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmAction({ title: `确定删除分类 ${name} 吗？`, content: '其下存在子分类时将无法删除', danger: true }))) return;
    try {
      const response = await categoryApi.delete(id);
      if (response.code === 0) {
        message.success(`分类 ${name} 已删除`);
        fetchTree();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err: any) {
      console.error('Failed to delete category:', err);
      // 透出后端具体原因（如「该分类下存在子分类，请先删除子分类」），避免误以为删除异常
      message.error(err?.message || '删除失败，请稍后重试');
    }
  };

  // [U-05 2026-09-13] 批量删除：自管 Set + 页头按钮 → 统一钩子（逐条执行 + **失败原因汇总**）
  // 仅对**当前可见行**生效（折叠子分类后其勾选自动裁掉，与翻页语义一致）。
  const sel = useRowSelection({ rows: visibleRows, getKey: (r) => r.node.id });
  const batch = useBatchAction({
    selection: sel,
    label: (r) => r.node.name || r.node.code || r.node.id,
    onDone: fetchTree,
    actions: [
      {
        key: 'del',
        label: '批量删除',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        confirm: (rows) => ({
          title: `确定删除选中的 ${rows.length} 个分类吗？`,
          content: '删除后不可恢复；还有子分类/已被商品引用的分类会被跳过，并在结果里列出原因',
          danger: true,
        }),
        run: (r) => categoryApi.delete(r.node.id),
      },
    ],
    exportSpec: {
      filename: `分类_选中_${format.today()}.csv`,
      headers: ['编码', '名称', '层级', '状态'],
      row: (r) => [r.node.code, r.node.name, String(r.level + 1), format.statusText(r.node.status)],
    },
  });

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  type CatRow = (typeof flatRows)[number];
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: CatRow) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    {
      key: '__sel',
      header: (
        <input
          type="checkbox"
          checked={sel.state === 'all'}
          ref={(el) => { if (el) el.indeterminate = sel.state === 'some'; }}
          onChange={sel.toggleAll}
          className="w-4 h-4 accent-blue-600 cursor-pointer"
          aria-label="全选本页"
        />
      ),
      headCls: 'px-4 py-3 w-10',
      cellCls: 'px-4 py-4',
      cell: (row) => (
        <input
          type="checkbox"
          checked={sel.isSelected(row)}
          onChange={() => sel.toggle(row)}
          className="w-4 h-4 accent-blue-600 cursor-pointer"
          aria-label={`选择 ${row.node.code}`}
        />
      ),
    },
    { key: 'code', header: '分类编码', cell: (row) => <span className="font-medium text-gray-900">{row.node.code}</span> },
    {
      key: 'name',
      header: '分类名称',
      cell: (row) => {
        const hasChildren = (row.node.children?.length ?? 0) > 0;
        const isCollapsed = collapsed.has(row.node.id);
        return (
          <div className="flex items-center" style={{ paddingLeft: row.level * 22 }}>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleExpand(row.node.id)}
                className="mr-1 p-0.5 text-gray-400 hover:text-gray-700 rounded transition-colors"
                aria-label={isCollapsed ? '展开子分类' : '折叠子分类'}
              >
                {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            ) : (
              <span className="w-5 mr-1 inline-block" />
            )}
            <span className={row.level > 0 ? 'text-gray-700' : 'font-medium text-gray-900'}>{row.node.name}</span>
            {hasChildren && <span className="ml-1.5 text-xs text-gray-400">({row.node.children?.length ?? 0})</span>}
          </div>
        );
      },
    },
    {
      key: 'parent',
      header: '父级分类',
      cell: (row) => (
        <span className="text-gray-500 text-sm">
          {row.level === 0 ? <span className="text-gray-400">顶级</span> : row.path.slice(0, row.path.lastIndexOf(' / '))}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(row.node.status)}`}>{format.statusText(row.node.status)}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      // [2026-09-14 统一操作列] 手写按钮迁移 RowActions：窄屏折叠「主操作 + ⋮」，操作列 ~88px
      cell: (row) => (
        <RowActions
          actions={[
            { key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, primary: true, onClick: () => navigate(`/category/${domain}/${row.node.id}/edit`) },
            { key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(row.node.id, row.node.name) },
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；多选列/操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: `category-list-${domain}`,
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={domainLabel}
        subtitle={`${domainLabel}（树形层级）`}
        extra={
          <>
            <button
              onClick={() => navigate(`/category/${domain}/create`)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增分类</span>
            </button>
          </>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索分类名称/编码/父级路径..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="form-input pl-10"
              />
            </div>
            <span className="hidden md:inline text-xs text-gray-400">缩进表示层级，点击箭头折叠/展开子分类</span>
            <div className="ml-auto">{viewMenu}</div>
          </div>
        </div>

        {/* [U-05] 批量工具条（有勾选才显示）；失败汇总弹窗必须独立渲染在页面根 */}
        {sel.count > 0 && <div className="px-4 pb-3">{batch.bar}</div>}
        {batch.failureModal}

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
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无分类数据" /></td></tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.node.id} className={`hover:bg-gray-50 transition-colors ${sel.isSelected(row) ? 'bg-blue-50' : ''}`}>
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && flatRows.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <span>共 {flatRows.length} 个分类</span>
            <span>有子分类的节点需先删除其子分类后才能删除</span>
          </div>
        )}
      </div>
    </div>
  );
}