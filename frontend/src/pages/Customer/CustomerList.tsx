import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, Download, KeyRound, Upload, Eye } from 'lucide-react';
import { Field } from '@/types/metadata';
import { loadEntityListLayout, isEntityListLayoutCustomized, entityColLabel, buildDetailColumns } from '@/utils/entityLayout';
import type { LayoutColumn } from '@/utils/entityLayout';
import { customerApi } from '@/api/order';
import { portalApi } from '@/api/portal';
import { Customer } from '@/types/order';
import { format } from '@/utils/format';
import { pickFieldValue } from '@/utils/dimLabel';
import { exportCsv } from '@/utils/exportCsv';
import { exportFromBackend } from '@/utils/exportBackend';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { Modal, Input, Switch } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { RowActions } from '@/components/RowActions';
import { RecordDetailModal } from '@/components/RecordDetailModal';
import { ImportModal } from '@/components/ImportModal';
import { PERM_IMPORT_EXPORT, hasPermissionNow } from '@/hooks/usePermission';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import { FilterPresetMenu } from '@/components/FilterPresetMenu';
import { SearchSelect } from '@/components/SearchSelect';
import { categoryApi } from '@/api/product';
import { buildCategoryOptions } from '@/utils/categoryTree';
import { findCategoryNode } from '@/utils/categoryTree';
import type { CategoryTreeNode } from '@/types/product';
import { entityApi, fieldApi } from '@/api/metadata';
import { useAuthStore } from '@/store/auth';
export function CustomerList() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', status: '', category_id: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  // [U-03 2026-09-13] 筛选维度：状态 + 分类（此前仅关键词，“条件组合”无价值所以接不了「我的筛选」）
  const [status, setStatus] = useState(urlFilters.status);
  const [categoryId, setCategoryId] = useState(urlFilters.category_id);
  const [categories, setCategories] = useState<CategoryTreeNode[]>([]);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, status, category_id: categoryId, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, status, categoryId, pagination.page, pagination.page_size]);
  const [importOpen, setImportOpen] = useState(false);
  // 「查看」详情弹窗（复用列表列描述符渲染，元数据列一并展示）
  const [detail, setDetail] = useState<Customer | null>(null);
  // [布局] customer 实体默认 list 布局（GET /v1/metadata/layouts/* 需 system 权限，403 时静默回退默认列）
  const [layoutCols, setLayoutCols] = useState<LayoutColumn[]>([]);
  const [layoutCustomized, setLayoutCustomized] = useState(false);
  const [metaFields, setMetaFields] = useState<Field[]>([]);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  // [布局] 挂载时读取 customer 实体默认 list 布局（失败/无权限静默 → 保持页面默认列）
  useEffect(() => {
    loadEntityListLayout('customer').then((data) => {
      setMetaFields(data.fields);
      setLayoutCols(data.listColumns);
      setLayoutCustomized(isEntityListLayoutCustomized(data.listColumns));
    });
  }, []);

  // [U-03] 分类下拉选项（客户分类树；失败静默——分类筛选项为空不影响其它筛选）
  useEffect(() => {
    categoryApi.tree('customer').then((res) => {
      if (res.code === 0) setCategories(Array.isArray(res.data) ? res.data : []);
    }).catch(() => { /* 无语种分类/无权限：保持空选项 */ });
  }, []);

  useEffect(() => {
    fetchCustomers();
    // [U-03] 状态/分类也是查询条件（改动后回到第 1 页由各自 setter 负责）
  }, [pagination.page, pagination.page_size, debouncedKeyword, status, categoryId]);

  const fetchCustomers = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { name?: string; status?: string; category_id?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        name: debouncedKeyword || undefined,
        status: status || undefined,
        category_id: categoryId || undefined,
      };
      const response = await customerApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setCustomers(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, code: string) => {
    if (!(await confirmAction({ title: `确定删除客户 ${code} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await customerApi.delete(id);
      if (response.code === 0) {
        message.success(`客户 ${code} 已删除`);
        fetchCustomers();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete customer:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // [U-05 2026-09-13] 批量删除：自管 Set + 页头按钮 → 统一钩子（逐条执行 + **失败原因汇总**）
  // 此前只提示“N 个客户删除失败”，看不到哪一条为什么失败（如“客户已被 3 张单据引用”）。
  const sel = useRowSelection({ rows: customers, getKey: (c) => c.id });
  const batch = useBatchAction({
    selection: sel,
    label: (c) => c.name || c.code || c.id,
    onDone: fetchCustomers,
    actions: [
      {
        key: 'del',
        label: '批量删除',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        confirm: (rows) => ({
          title: `确定删除选中的 ${rows.length} 个客户吗？`,
          content: '删除后不可恢复；已被业务单据引用的客户会被跳过，并在结果里列出原因',
          danger: true,
        }),
        run: (c) => customerApi.delete(c.id),
      },
    ],
    exportSpec: {
      filename: `客户_选中_${format.today()}.csv`,
      headers: ['编码', '名称', '分类', '状态'],
      row: (c) => [c.code, c.name, c.edges?.category?.name || c.category_name || '', format.statusText(c.status)],
    },
  });

  // 客户自助门户：设置登录账号
  const [portalTarget, setPortalTarget] = useState<Customer | null>(null);
  const [portalAccount, setPortalAccount] = useState('');
  const [portalPassword, setPortalPassword] = useState('');
  const [portalLoading, setPortalLoading] = useState(false);

  const openPortalAccount = (item: Customer) => {
    setPortalTarget(item);
    setPortalAccount('');
    setPortalPassword('');
  };

  const handleSavePortalAccount = async () => {
    if (!portalTarget) return;
    if (!portalAccount || portalAccount.length < 3) {
      message.warning('登录账号至少 3 个字符');
      return;
    }
    if (!portalPassword || portalPassword.length < 6) {
      message.warning('密码至少 6 位');
      return;
    }
    setPortalLoading(true);
    try {
      const res = await portalApi.setupAccount(portalTarget.id, portalAccount, portalPassword);
      if (res.code === 0) {
        message.success(`已为「${portalTarget.name}」开通自助登录账号 ${portalAccount}`);
        // 开通账号后端自动启用自助下单资格，同步本地状态
        setCustomers(prev => prev.map(c => c.id === portalTarget.id ? { ...c, portal_enabled: true } : c));
        setPortalTarget(null);
      } else {
        message.error(res.message || '设置失败');
      }
    } catch (err: any) {
      message.error(err.message || '设置失败，请稍后重试');
    } finally {
      setPortalLoading(false);
    }
  };

  // 客户自助下单资格开关（列表直接切换）
  const handleTogglePortal = async (item: Customer, enabled: boolean) => {
    if (!(await confirmAction({
      title: `${enabled ? '开通' : '停用'}「${item.name}」的自助下单？`,
      content: enabled ? '开通后该客户可登录门户浏览商品并在线下单' : '停用后该客户将无法登录门户下单（已有订单不受影响）',
      danger: !enabled,
    }))) return;
    try {
      const res = await portalApi.setCustomerEnabled(item.id, enabled);
      if (res.code === 0) {
        message.success(`${enabled ? '已开通' : '已停用'}「${item.name}」自助下单`);
        setCustomers(prev => prev.map(c => c.id === item.id ? { ...c, portal_enabled: enabled } : c));
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (err: any) {
      message.error(err.message || '操作失败，请稍后重试');
    }
  };

  const handleExportExcel = async () => {
    const ok = await exportFromBackend('/v1/export/customers', 'xlsx');
    if (ok) message.success('Excel 导出成功，已开始下载');
    else message.error('Excel 导出失败，请稍后重试');
  };

  // ── [布局] 客户列表按「customer」实体默认 list 布局驱动信息列 ──────────────
  const scalarText = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '-';
    if (typeof v === 'boolean') return v ? '是' : '否';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  // 信息列 → 单元格（业务列按业务渲染，未命中回退 ext_fields/原始字段）
  const renderInfoCell = (code: string, c: Customer): ReactNode => {
    switch (code) {
      case 'contact':
        return <span className="text-gray-500 text-sm">{c.contact || '-'}</span>;
      case 'phone':
        return <span className="text-gray-500 text-sm">{c.phone || '-'}</span>;
      case 'email':
        return <span className="text-gray-500 text-sm">{c.email || '-'}</span>;
      case 'address':
        return <span className="text-gray-500 text-sm block max-w-[220px] truncate" title={c.address || ''}>{c.address || '-'}</span>;
      case 'tax_no':
        return <span className="text-gray-500 text-sm">{c.tax_no || '-'}</span>;
      case 'bank_account':
        return <span className="text-gray-500 text-sm">{c.bank_account || '-'}</span>;
      case 'payment_term':
        return <span className="text-gray-500 text-sm">{c.payment_term == null ? '-' : `${c.payment_term} 天`}</span>;
      case 'credit_limit':
        return <span className="text-gray-500 text-sm">{c.credit_limit == null ? '-' : format.currency(c.credit_limit)}</span>;
      case 'credit_balance':
        return <span className="text-gray-500 text-sm">{c.credit_balance == null ? '-' : format.currency(c.credit_balance)}</span>;
      case 'remark':
        return <span className="text-gray-500 text-sm block max-w-[220px] truncate" title={c.remark || ''}>{c.remark || '-'}</span>;
      case 'created_at':
        return <span className="text-gray-500 text-sm">{format.date(c.created_at, 'YYYY-MM-DD HH:mm') || '-'}</span>;
      case 'updated_at':
        return <span className="text-gray-500 text-sm">{format.date(c.created_at, 'YYYY-MM-DD HH:mm') || '-'}</span>;
      default: {
        // 业务字段/元数据自定义字段（值可能存 ext / ext_fields）→ 统一取值回退（同名优先，支持同义键）
        const v = pickFieldValue(c as unknown as Record<string, any>, code);
        if (v !== undefined && v !== null && v !== '') return <span className="text-gray-500 text-sm">{scalarText(v)}</span>;
        return <span className="text-gray-500 text-sm">-</span>;
      }
    }
  };

  // 本页“始终展示”的固定列（勾选/编码/名称/分类/状态/自助下单/操作）；布局列引用这些码时跳过
  const FIXED_INFO_SKIP = new Set([
    'code', 'name', 'category_id', 'category_name', 'status', 'portal_enabled',
    'id', 'tenant_id', 'deleted_at', 'ext', 'ext_fields',
  ]);

  // 布局信息列（有序、去重）：用户有意配置了布局时按其列渲染；否则用页面默认信息列（联系人/电话）
  const infoCols: LayoutColumn[] = (() => {
    if (layoutCustomized && layoutCols.length > 0) {
      const seen = new Set<string>();
      const out: LayoutColumn[] = [];
      for (const c of layoutCols) {
        if (!c?.field || seen.has(c.field)) continue;
        seen.add(c.field);
        if (FIXED_INFO_SKIP.has(c.field)) continue;
        out.push({ field: c.field, label: c.label, width: c.width });
      }
      return out;
    }
    return [
      { field: 'contact', label: '联系人' },
      { field: 'phone', label: '电话' },
    ];
  })();

  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cell: (c: Customer) => ReactNode;
    cellCls?: string;
    width?: number;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';

  const selCol: RowCol = {
    key: '__sel',
    headCls: 'px-4 py-3 w-10',
    cellCls: 'px-4 py-4',
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
    cell: (c) => (
      <input
        type="checkbox"
        checked={sel.isSelected(c)}
        onChange={() => sel.toggle(c)}
        className="w-4 h-4 accent-blue-600 cursor-pointer"
        aria-label={`选择 ${c.code}`}
      />
    ),
  };

  const codeCol: RowCol = {
    key: 'code',
    header: '编码',
    // [2026-09-14 手机实测] 窄屏隐藏：冻结操作列会盖住客户名称——隐藏编码列给名称让位
    headCls: `${TH_L} max-lg:hidden`,
    cellCls: `${TD} max-lg:hidden`,
    cell: (c) => <span className="font-medium text-gray-900">{c.code}</span>,
  };

  const nameCol: RowCol = {
    key: 'name',
    header: '名称',
    cell: (c) => <span className="text-gray-900">{c.name}</span>,
  };

  const categoryCol: RowCol = {
    key: 'category',
    header: '分类',
    cell: (c) => <span className="text-gray-500 text-sm">{c.edges?.category?.name || c.category_name || '-'}</span>,
  };

  const statusCol: RowCol = {
    key: 'status',
    header: '状态',
    cell: (c) => (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(c.status)}`}>{format.statusText(c.status)}</span>
    ),
  };

  const portalCol: RowCol = {
    key: 'portal',
    header: '自助下单',
    cell: (c) => (
      <div className="flex items-center gap-2">
        <Switch
          size="small"
          checked={!!c.portal_enabled}
          onChange={(checked) => handleTogglePortal(c, checked)}
          checkedChildren="开"
          unCheckedChildren="关"
        />
        <span className={`text-xs ${c.portal_enabled ? 'text-teal-600' : 'text-gray-400'}`}>
          {c.portal_enabled ? '已开通' : '未开通'}
        </span>
      </div>
    ),
  };

  const actionsCol: RowCol = {
    key: '__actions',
    headCls: TH_R,
    cellCls: `${TD} text-right`,
    header: '操作',
    cell: (c) => (
      <RowActions
        actions={[
          { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => setDetail(c) },
          { key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, onClick: () => navigate(`/customers/${c.id}/edit`) },
          {
            key: 'portal',
            label: '设置自助登录账号',
            icon: <KeyRound className="w-4 h-4" />,
            onClick: () => openPortalAccount(c),
          },
          {
            key: 'del',
            label: '删除',
            icon: <Trash2 className="w-4 h-4" />,
            danger: true,
            onClick: () => handleDelete(c.id, c.code),
          },
        ]}
      />
    ),
  };

  const infoColOf = (lc: LayoutColumn): RowCol => ({
    key: lc.field,
    width: lc.width,
    header: entityColLabel(lc.field, lc.label, metaFields),
    cell: (c) => renderInfoCell(lc.field, c),
  });

  // 列顺序：勾选/编码/名称 + 布局信息列 + 分类/状态/自助下单/操作（页面默认列）
  const baseRowCols: RowCol[] = [
    selCol,
    codeCol,
    nameCol,
    ...infoCols.map(infoColOf),
    categoryCol,
    statusCol,
    portalCol,
    actionsCol,
  ];

  // [2026-09-12] 元数据自定义字段 → 追加为「可选列」（默认隐藏，视图菜单可勾选显示）：
  // 此前自定义字段既不在页面固定列、也不在布局列时就完全看不到（用户反馈“客户自定义字段不能显示在列里”）
  const baseColKeys = new Set(baseRowCols.map((c) => c.key));
  const META_COL_SKIP = new Set(['id', 'tenant_id', 'deleted_at', 'ext', 'ext_fields']);
  const metaExtraCols: RowCol[] = metaFields
    .filter((f) => f.code && !baseColKeys.has(f.code) && !META_COL_SKIP.has(f.code))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.code.localeCompare(b.code))
    .map((f) => ({
      key: f.code,
      header: f.name || entityColLabel(f.code, undefined, metaFields),
      cell: (c) => renderInfoCell(f.code, c),
    }));
  const rowCols: RowCol[] = [...baseRowCols, ...metaExtraCols];
  // 默认可见列 = 页面基础列（附加的自定义字段默认不显示，勾选后写入 URL 可分享）
  const defaultVisible = baseRowCols.map((c) => c.key);

  // [易用性 P2] 我的视图：可见列写入 URL（?cols=）可分享；列定义仍由元数据布局决定
  // [易用性 P2] 视图内新建字段（联动元数据；字段 API 需 system 权限，无权则不显示入口）
  const { permissions } = useAuthStore();
  const canManageFields = permissions.includes('*') || permissions.includes('system');
  const createEntityField = async (input: { name: string; code: string; fieldType: string }) => {
    const entRes = await entityApi.getByCode('customer');
    const entityId = (entRes as { data?: { id?: string } }).data?.id;
    if (!entityId) throw new Error('未找到客户实体定义');
    await fieldApi.create({ entity_id: entityId, code: input.code, name: input.name, field_type: input.fieldType });
    // 重新拉布局 + 字段：新字段随即进入「视图 → 显示列」可选列（表单/详情同步可用）
    const data = await loadEntityListLayout('customer');
    setMetaFields(data.fields);
    setLayoutCustomized(isEntityListLayoutCustomized(data.listColumns));
    return { appeared: true };
  };
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'customer-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
    labelOf: (key) => metaFields.find((f) => f.code === key)?.name || '',
    createField: canManageFields ? createEntityField : undefined,
    entityLabel: '客户',
    defaultVisible,
  });

  // [2026-09-11] 详情列 = 列表列 + **未进列表列的自定义/元数据字段**
  // （详情不受列表布局裁剪：修复“会员”这类没加入布局列的自定义字段在查看时看不到）
  const detailCols = buildDetailColumns<Customer>({
    listColumns: rowCols,
    metaFields,
    renderField: renderInfoCell,
    excludeKeys: ['__sel', '__actions', 'portal'],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="客户管理"
        subtitle="客户列表"
        extra={
          <>
            <button
              onClick={() => exportCsv(`客户_${format.today()}.csv`,
                ['编码', '名称', '联系人', '电话', '信用额度', '欠款', '付款条件', '状态'],
                customers.map(c => [c.code, c.name, c.contact, c.phone, Number(c.credit_limit).toFixed(2), Number(c.credit_balance).toFixed(2), c.payment_term, format.statusText(c.status)]))}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">导出 CSV</span>
            </button>
            {hasPermissionNow(PERM_IMPORT_EXPORT) && (
            <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-2" title="批量导入客户（CSV/Excel）">
              <Upload className="w-4 h-4" />
              <span className="hidden md:inline">导入</span>
            </button>
            )}
            <button onClick={handleExportExcel} className="btn-secondary flex items-center gap-2" title="导出全部客户（Excel）">
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">导出 Excel</span>
            </button>
            <button onClick={() => navigate('/customers/create')} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增客户</span>
            </button>
          </>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          {/* [手机端适配 2026-09-14] flex-wrap：390px 窄屏下筛选控件自动换行 */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索客户名称或编码..."
                value={keyword}
                onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="form-input pl-10"
              />
            </div>
            {/* [U-03 2026-09-13] 筛选维度：状态 + 分类（配合「我的筛选」保存「停用客户 + 合肥区域」这类组合） */}
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-select w-28"
              aria-label="客户状态筛选"
            >
              <option value="">全部状态</option>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
            <div className="w-44">
              <SearchSelect
                options={buildCategoryOptions(categories)}
                value={categoryId || undefined}
                onChange={(v) => { setCategoryId(v ?? ''); setPagination(prev => ({ ...prev, page: 1 })); }}
                allowClear
                placeholder="全部分类"
              />
            </div>
            <FilterPresetMenu
              pageKey="customer-list"
              currentParams={{ keyword: debouncedKeyword, status, category_id: categoryId }}
              onApply={(p) => {
                setKeyword(p.keyword ?? '');
                setStatus(p.status ?? '');
                setCategoryId(p.category_id ?? '');
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
            />
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
                  <th
                    key={c.key}
                    className={c.headCls || TH_L}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : customers.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6">
                  {/* [U-03] 状态/分类也是筛选条件：只判断关键词会把「筛了分类没结果」误报成「暂无数据」 */}
                  <ListEmpty
                    keyword={keyword}
                    filterNote={[
                      status ? `状态「${format.statusText(status)}」` : '',
                      categoryId ? `分类「${findCategoryNode(categories, categoryId)?.name ?? categoryId}」` : '',
                    ].filter(Boolean).join(' + ') || undefined}
                    onClear={() => {
                      setKeyword('');
                      setStatus('');
                      setCategoryId('');
                      setPagination(prev => ({ ...prev, page: 1 }));
                    }}
                    title="暂无客户数据"
                    description="点击右上角「新增客户」录入，或到「导入导出」批量导入"
                  />
                </td></tr>
              ) : (
                customers.map((item) => (
                  <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${sel.isSelected(item) ? 'bg-blue-50' : ''}`}>
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

        {!loading && customers.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
            loading={loading}
          />
        )}
      </div>

      {/* 客户自助门户：设置登录账号 */}
      <Modal
        title={`开通自助下单账号 — ${portalTarget?.name || ''}`}
        open={!!portalTarget}
        onOk={handleSavePortalAccount}
        onCancel={() => setPortalTarget(null)}
        confirmLoading={portalLoading}
        okText="开通"
        cancelText="取消"
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-sm text-gray-600 mb-1">登录账号</label>
            <Input
              value={portalAccount}
              onChange={e => setPortalAccount(e.target.value)}
              placeholder="客户用于登录门户（至少 3 字符，全局唯一）"
             autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">登录密码</label>
            <Input.Password
              value={portalPassword}
              onChange={e => setPortalPassword(e.target.value)}
              placeholder="至少 6 位"
            />
          </div>
          <p className="text-xs text-gray-400">
            开通后客户可访问「客户自助下单」门户浏览商品并在线下单（订单进入内部确认流程）。
          </p>
        </div>
      </Modal>

      <ImportModal
        open={importOpen}
        title="批量导入客户（CSV / Excel）"
        importUrl="/v1/import/customers"
        templateUrl="/v1/export/customers-template"
        templateUrlXlsx="/v1/export/customers-template?format=xlsx"
        templateHint="编码,名称,联系人,电话,邮箱,地址,分类名称,信用额度,信用余额,账期(天),税号,银行账号,备注"
        duplicateStrategy
        onClose={() => setImportOpen(false)}
        onSuccess={fetchCustomers}
      />

      <RecordDetailModal
        open={!!detail}
        title={detail ? `客户详情 · ${detail.code}` : '客户详情'}
        record={detail}
        columns={detailCols}
        onClose={() => setDetail(null)}
        extra={
          // 详情是只读的：自助下单开关在列表里可点，这里只显示状态文本，避免误操作
          <div className="text-sm">
            <span className="text-gray-500">自助下单：</span>
            <span className={detail?.portal_enabled ? 'text-green-600' : 'text-gray-500'}>
              {detail?.portal_enabled ? '已开通' : '未开通'}
            </span>
          </div>
        }
      />
    </div>
  );
}
