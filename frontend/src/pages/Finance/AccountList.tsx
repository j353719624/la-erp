import { useState, useEffect, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Pencil, Trash2, Wallet } from 'lucide-react';
import { accountApi } from '@/api/finance';
import { Account } from '@/types/finance';
import { format } from '@/utils/format';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

export function AccountList() {
  // [2026-09-18 权限细化] 新增=account_create；编辑=account_edit；删除=account_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [balOpen, setBalOpen] = useState(false);
  const [balData, setBalData] = useState<any[]>([]);
  const [balAccount, setBalAccount] = useState<Account | null>(null);
  const [balLoading, setBalLoading] = useState(false);
  // 请求竞态守卫：快速切换搜索时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  const handleBalance = async (account: Account) => {
    setBalAccount(account);
    setBalOpen(true);
    setBalLoading(true);
    try {
      const res = await accountApi.balance(account.id);
      if (res.code === 0) {
        const data = Array.isArray(res.data) ? res.data : [res.data];
        setBalData(data);
      } else {
        setBalData([]);
      }
    } catch {
      setBalData([]);
    } finally {
      setBalLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [keyword]);

  const fetchAccounts = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      // 全量科目（分页 list 只取 10 条会导致科目树残缺）
      const response = await accountApi.all();
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        let data = response.data?.list || [];
        if (keyword) {
          data = data.filter(item => 
            item.code.toLowerCase().includes(keyword.toLowerCase()) ||
            item.name.toLowerCase().includes(keyword.toLowerCase())
          );
        }
        setAccounts(data);
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, accountCode: string, isLeaf: boolean) => {
    if (!isLeaf) {
      message.warning('非末级科目不能删除，请先删除其下属的子科目');
      return;
    }
    if (!(await confirmAction({ title: `确定删除科目 ${accountCode} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await accountApi.delete(id);
      if (response.code === 0) {
        message.success(`科目 ${accountCode} 已删除`);
        fetchAccounts();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete account:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  const getCategoryText = (category: string): string => {
    const categoryMap: Record<string, string> = {
      asset: '资产',
      liability: '负债',
      equity: '权益',
      cost: '成本',
      income: '收入',
    };
    return categoryMap[category] || category;
  };

  // 科目子类别（sub_category）→ 中文（资产/负债/权益/成本/损益常用子类）
  const getSubCategoryText = (sub: string): string => {
    const subMap: Record<string, string> = {
      // 资产类
      cash: '库存现金',
      bank: '银行存款',
      receivable: '应收账款',
      prepaid: '预付账款',
      inventory: '存货',
      fixed: '固定资产',
      intangible: '无形资产',
      other_asset: '其他资产',
      // 负债类
      payable: '应付账款',
      advance: '预收账款',
      payroll: '应付职工薪酬',
      tax: '应交税费',
      dividend: '应付股利',
      short: '短期借款',
      long: '长期借款',
      other_liab: '其他负债',
      // 权益类
      capital: '实收资本',
      profit: '未分配利润',
      distribution: '利润分配',
      // 成本/损益类
      production: '生产成本',
      manufacturing: '制造费用',
      labor: '直接人工',
      main: '主营业务收入',
      other: '其他业务',
      selling: '销售费用',
      management: '管理费用',
      finance: '财务费用',
      'income-tax': '所得税费用',
      'non-operating': '营业外',
      'non_operating': '营业外',
      expense: '费用',
      revenue: '营业收入',
    };
    return subMap[sub] || sub;
  };

  const getCategoryColor = (category: string): string => {
    const colorMap: Record<string, string> = {
      asset: 'text-blue-600',
      liability: 'text-red-600',
      equity: 'text-purple-600',
      cost: 'text-orange-600',
      income: 'text-green-600',
    };
    return colorMap[category] || 'text-gray-600';
  };

  const renderTree = (parentId: string | null, level: number): ReactNode => {
    // 顶级科目后端 parent_id 为 nil 时 JSON 字段省略 → 前端 undefined；统一按 null 处理
    const children = accounts.filter(a => (a.parent_id ?? null) === parentId);
    if (children.length === 0) return null;

    // [2026-09-12] 直接输出 <tr>（不再包 ul/li）：此前 <tr> 在 <li> 内触发 validateDOMNesting 告警，且 tbody 下混入 ul 破坏表格语义
    return (
      <>
        {children.flatMap((account) => [
          <tr key={account.id} className="hover:bg-gray-50 transition-colors">
            {visibleColumns.map((c) => (
              <td
                key={c.key}
                className={c.cellCls || TD}
                style={c.key === 'code' ? { paddingLeft: `${level * 20 + 24}px` } : undefined}
              >
                {c.cell({ account, level })}
              </td>
            ))}
          </tr>,
          <Fragment key={`${account.id}-children`}>{renderTree(account.id, level + 1)}</Fragment>,
        ])}
      </>
    );
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  type AccountRow = { account: Account; level: number };
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: AccountRow) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    {
      key: 'code',
      header: '编码',
      cell: ({ account }) => <span className="font-medium text-gray-900">{account.code}</span>,
    },
    { key: 'name', header: '名称', cell: ({ account }) => <span className="text-gray-900">{account.name}</span> },
    {
      key: 'category',
      header: '类别',
      cell: ({ account }) => (
        <span className={`text-sm font-medium ${getCategoryColor(account.category)}`}>
          {getCategoryText(account.category)}
        </span>
      ),
    },
    { key: 'sub_category', header: '子类别', cell: ({ account }) => <span className="text-gray-500 text-sm">{getSubCategoryText(account.sub_category)}</span> },
    {
      key: 'is_leaf',
      header: '是否末级',
      cell: ({ account }) => (
        account.is_leaf ? (
          <span className="px-2 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium">末级</span>
        ) : (
          <span className="px-2 py-1 bg-gray-50 text-gray-700 rounded-full text-xs font-medium">非末级</span>
        )
      ),
    },
    {
      key: 'is_enabled',
      header: '状态',
      cell: ({ account }) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(account.is_enabled ? 'active' : 'inactive')}`}>
          {account.is_enabled ? '启用' : '停用'}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: ({ account }) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）；确认逻辑仍在 handler 内
        <RowActions
          actions={[
            ...(has('account_edit')
              ? [{ key: 'edit', label: '查看/编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/finance/accounts/${account.id}`) }]
              : []),
            { key: 'balance', label: '科目余额', icon: <Wallet className="w-4 h-4" />, onClick: () => handleBalance(account) },
            ...(has('account_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(account.id, account.code, account.is_leaf) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'account-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="会计科目"
        subtitle="科目列表"
        extra={
          has('account_create') && (
            <button onClick={() => navigate('/finance/accounts/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增科目</span>
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
              placeholder="搜索科目编码或名称..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
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
              ) : accounts.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无科目数据" /></td></tr>
              ) : (
                renderTree(null, 0)
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal title={`科目余额 - ${balAccount?.code} ${balAccount?.name}`} open={balOpen} onCancel={() => setBalOpen(false)} footer={null} width={560}>
        <div className="overflow-x-auto py-2">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left">期间</th>
                <th className="px-4 py-2 text-right">期初余额</th>
                <th className="px-4 py-2 text-right">借方发生</th>
                <th className="px-4 py-2 text-right">贷方发生</th>
                <th className="px-4 py-2 text-right">期末余额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {balLoading ? <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">加载中...</td></tr>
                : balData.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">暂无余额数据</td></tr>
                : balData.map((b, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{b.period || '-'}</td>
                    <td className="px-4 py-2 text-right">¥{format.currency(Number(b.begin_balance) || 0)}</td>
                    <td className="px-4 py-2 text-right">¥{format.currency(Number(b.debit_amount) || 0)}</td>
                    <td className="px-4 py-2 text-right">¥{format.currency(Number(b.credit_amount) || 0)}</td>
                    <td className="px-4 py-2 text-right font-medium">¥{format.currency(Number(b.end_balance) || 0)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}
