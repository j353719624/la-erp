import { EmptyState } from '@/components/EmptyState';

interface ListEmptyProps {
  /** 当前搜索关键词：有值即判定为"筛选无结果"，提示会显示关键词并给一键清空 */
  keyword?: string;
  /** 额外筛选条件说明（如"状态：已审核"），有值时同样算筛选态 */
  filterNote?: string;
  /** 一键清空筛选（清空后请在调用方把页码重置为 1） */
  onClear?: () => void;
  /** 真无数据时的标题 */
  title?: string;
  /** 真无数据时的说明（引导下一步操作） */
  description?: string;
}

/**
 * 列表空态（易用性 P0/P1 统一实现，2026-09-11）。
 *
 * 解决的问题：从前所有列表空态都是"暂无XX数据"——用户搜了个词没搜到，
 * 看到"暂无数据"会以为系统坏了/数据丢了，而实际上只是筛选条件没匹配。
 *
 * 现在两态分明：
 *  - 无筛选 → 「暂无XX数据」+ 引导（新建/导入）
 *  - 有筛选 → 「未找到匹配「xxx」的记录」+ 当前条件 + [清空筛选]
 *
 * 用法（列表页 1 行替换即可）：
 * ```tsx
 * <ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无商品数据" description="点击右上角「新增商品」开始录入" />
 * ```
 * 带状态筛选的页面再传 `filterNote={`状态「${format.statusText(status)}」`}`。
 */
export function ListEmpty({
  keyword = '',
  filterNote,
  onClear,
  title = '暂无数据',
  description,
}: ListEmptyProps) {
  const kw = keyword.trim();
  const filtering = Boolean(kw || filterNote);
  if (!filtering) {
    return <EmptyState title={title} description={description} />;
  }
  const cond = [kw ? `关键词「${kw}」` : '', filterNote || ''].filter(Boolean).join(' + ');
  return (
    <EmptyState
      title={kw ? `未找到匹配「${kw}」的记录` : '没有符合当前筛选条件的记录'}
      description={`当前条件：${cond}。换个关键词试试，或清空筛选查看全部数据`}
      action={
        onClear ? (
          <button type="button" className="btn-secondary" onClick={onClear}>
            清空筛选
          </button>
        ) : undefined
      }
    />
  );
}
