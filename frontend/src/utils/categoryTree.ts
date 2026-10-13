import type { CategoryTreeNode } from '@/types/product';
import type { SearchSelectOption } from '@/components/SearchSelect';

/**
 * 分类树工具：后端 /v1/categories/tree 返回树形结构，本文件提供
 * 前序平铺 / 全路径 / 生成带层级缩进的下拉选项 / 收集自身+后代等能力，
 * 供分类管理（父级下拉、列表树形展示）及各表单（商品/客户/供应商分类下拉）复用。
 */

export interface FlattenedCategory {
  node: CategoryTreeNode;
  /** 层级深度：0 = 顶级 */
  level: number;
  /** 全路径文本，如「父级 / 子级」 */
  path: string;
  /** 路径上所有 id（含自身，末位为自身） */
  pathIds: string[];
}

/** 前序平铺分类树，带层级与全路径 */
export function flattenCategoryTree(nodes: CategoryTreeNode[]): FlattenedCategory[] {
  const out: FlattenedCategory[] = [];
  const walk = (items: CategoryTreeNode[], level: number, parentPath: string, parentIds: string[]) => {
    for (const node of items) {
      const curPath = parentPath ? `${parentPath} / ${node.name}` : node.name;
      const curIds = [...parentIds, node.id];
      out.push({ node, level, path: curPath, pathIds: curIds });
      if (node.children?.length) {
        walk(node.children, level + 1, curPath, curIds);
      }
    }
  };
  walk(nodes, 0, '', []);
  return out;
}

/** 在树中查找指定 id 的节点（递归） */
export function findCategoryNode(nodes: CategoryTreeNode[], targetId: string): CategoryTreeNode | null {
  for (const node of nodes) {
    if (node.id === targetId) return node;
    if (node.children?.length) {
      const hit = findCategoryNode(node.children, targetId);
      if (hit) return hit;
    }
  }
  return null;
}

/** 收集某分类 id 及其全部后代 id 集合（父级下拉排除自身+后代，防止形成环） */
export function collectSubtreeIds(nodes: CategoryTreeNode[], targetId: string): Set<string> {
  const found = new Set<string>();
  const target = findCategoryNode(nodes, targetId);
  if (!target) return found;
  const add = (n: CategoryTreeNode) => {
    found.add(n.id);
    (n.children || []).forEach(add);
  };
  add(target);
  return found;
}

export interface CategoryOptionOptions {
  /** 需排除的分类 id 集合（含后代已由 collectSubtreeIds 一并收集时传入即可） */
  excludeIds?: Set<string>;
  /** 选项文本是否带编码前缀（分类管理父级下拉建议 true，业务表单下拉默认 false） */
  showCode?: boolean;
  /** 缩进字符，默认全角空格，可用 '　' / '　　' 等 */
  indentUnit?: string;
}

/**
 * 生成带层级缩进 + 全路径检索的分类下拉选项。
 * label 为纯文本（保留 SearchSelect 的字符串过滤能力），缩进用全角空格，
 * search 附带编码/名称/全路径，输入「父级名/子级名」即可命中。
 */
export function buildCategoryOptions(
  nodes: CategoryTreeNode[],
  opts: CategoryOptionOptions = {}
): SearchSelectOption[] {
  const { excludeIds, showCode = false, indentUnit = '\u3000\u3000' } = opts;
  const flat = flattenCategoryTree(nodes);
  const options: SearchSelectOption[] = [];
  for (const item of flat) {
    if (excludeIds?.has(item.node.id)) continue;
    const { node, level, path } = item;
    const indent = level > 0 ? indentUnit.repeat(level) : '';
    const branch = level > 0 ? '└ ' : '';
    const label = `${indent}${branch}${showCode ? `${node.code} - ` : ''}${node.name}`;
    options.push({
      value: node.id,
      label,
      search: `${node.code} ${node.name} ${path}`,
    });
  }
  return options;
}
