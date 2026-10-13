import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Eye, X, Printer, Download, Package, Upload, Boxes, CirclePause, CirclePlay, Archive } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { productApi } from '@/api/product';
import { categoryApi } from '@/api/product';
import { entityApi, fieldApi } from '@/api/metadata';
import { useAuthStore } from '@/store/auth';
import { Product } from '@/types/product';
import type { CategoryTreeNode } from '@/types/product';
import { buildCategoryOptions } from '@/utils/categoryTree';
import { findCategoryNode } from '@/utils/categoryTree';
import { format } from '@/utils/format';
import { exportCsv } from '@/utils/exportCsv';
import { exportFromBackend } from '@/utils/exportBackend';
import { confirmAction } from '@/utils/confirm';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { RowActions } from '@/components/RowActions';
import type { RowAction } from '@/components/RowActions';
import { ImportModal } from '@/components/ImportModal';
import { PERM_IMPORT_EXPORT, hasPermissionNow } from '@/hooks/usePermission';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { BarcodeInput } from '@/components/BarcodeInput';
import { useTableView } from '@/hooks/useTableView';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import { FilterPresetMenu } from '@/components/FilterPresetMenu';
import { SearchSelect } from '@/components/SearchSelect';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { Field } from '@/types/metadata';
import { loadProductLayouts, isProductListLayoutCustomized, PRODUCT_LIST_DEFAULT_INFO, layoutColLabel, PRODUCT_FORM_FIXED_CODES } from '@/utils/productLayout';
import type { LayoutColumn, FormSection } from '@/utils/productLayout';
import { dedupeDimEntries, dimLabel, pickFieldValue } from '@/utils/dimLabel';
import { tableColumnLabel } from '@/utils/columnLabels';
import { useDictEntries, dictText } from '@/hooks/useDictItems';

const fieldCodeToName: Record<string, string> = {
  // ── 医药制造模板（实体字段不在 product FieldDef 时回退用）──
  batch_no: '批号',
  production_date: '生产日期',
  expiry_date: '有效期至',
  approval_number: '批准文号',
  gmp_cert_no: 'GMP证书号',
  storage_condition: '储存条件',
  drug_form: '剂型',
  active_ingredient: '有效成分',
  specification_dosage: '规格剂量',
  manufacturer_code: '生产企业编码',
  // ── 食品制造模板 ──
  shelf_life: '保质期(天)',
  food_license_no: '食品生产许可证号',
  ingredients: '配料表',
  allergens: '过敏原信息',
  nutrition_facts: '营养成分表',
  food_category: '食品类别',
  net_content: '净含量',
  // ── 供应商资质模板（演示库全局 current 模板，字段会写入商品 ext_fields）──
  supplier_level: '供货等级',
  payment_terms: '结算账期',
  qualification: '资质证书',
  business_license_no: '营业执照号',
  taxpayer_type: '纳税人类型',
  supply_category: '供货品类',
  quality_score: '质量评分',
  on_time_rate: '准时交货率(%)',
};

// 商品主图：优先多图第一张（images 为权威字段），旧数据回退 image_url
const productCover = (p: Product): string => {
  if (p.images && p.images.length > 0) return p.images[0];
  return p.image_url || '';
};

// ── SKU 款聚合（2026-09-10）：一款多 SKU 在商品列表合并展示 ─────────────────
// 款号类字段码（识别元数据布局中的「款号」列）
const SPU_FIELD_CODES = new Set(['spu', 'spu_code', 'spu_id', 'style_no', 'group_code']);
// 需提前到「名称/分类」之后的 SKU 维度列（款号→颜色→尺码）
const DIM_HEAD_FIELDS = ['spu', 'spu_code', 'spu_id', 'style_no', 'group_code', 'color', 'size'];
// 同款/同名合并行时允许竖向合并（共享信息不重复）的列
const MERGEABLE_COLS = new Set(['image', 'name', 'category', 'unit', 'unit_id', 'created_at', 'updated_at', 'status', 'remark']);

// 款号徽标：读取商品预载的 edges.spu（需后端列表 WithSpu）
const SpuCodeCell = ({ p }: { p: Product }) => {
  const spu = p.edges?.spu;
  if (spu?.code) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-xs font-medium whitespace-nowrap">{spu.code}</span>
        {spu.name && <span className="text-gray-400 text-xs truncate max-w-[150px]" title={spu.name}>{spu.name}</span>}
      </span>
    );
  }
  if (p.spu_id) return <span className="text-gray-400 text-sm font-mono">{String(p.spu_id).slice(0, 8)}</span>;
  return <span className="text-gray-400 text-sm">-</span>;
};

// [2026-09-16] archived 模式：/products/archived「下架商品管理」——同一组件，默认只显停用商品，可恢复/删除
export function ProductList({ archived = false }: { archived?: boolean } = {}) {
  const navigate = useNavigate();
  // [P0-5] 筛选/页码同步到 URL：点进详情再返回、刷新页面、发链接给同事，条件都不丢
  // [2026-09-16] 默认只展示启用商品（下架商品从默认列表隐藏，经「下架商品」入口查看）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', category_id: '', status: archived ? 'inactive' : 'active', page: 1, page_size: 10 });
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  // [U-03 2026-09-13] 筛选维度：分类 + 状态（后端本就支持 category_id，但页面一直没给出入口）
  const [categoryId, setCategoryId] = useState(urlFilters.category_id);
  const [status, setStatus] = useState(urlFilters.status);
  const [categories, setCategories] = useState<CategoryTreeNode[]>([]);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // 分仓库存弹窗：点“库存数量”查看该商品各仓库数量
  const [stockView, setStockView] = useState<Product | null>(null);
  // [布局] 商品实体元数据布局（GET /v1/metadata/layouts/* 需 system 权限，403 时静默回退默认列）
  const [layoutCols, setLayoutCols] = useState<LayoutColumn[]>([]);
  const [layoutCustomized, setLayoutCustomized] = useState(false);
  const [metaFields, setMetaFields] = useState<Field[]>([]);
  // [布局] 默认 form 布局 sections（详情弹窗自定义字段按此分组/排序）
  const [formSections, setFormSections] = useState<FormSection[]>([]);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  // [P0-5] 筛选/页码变化 → 写回 URL（replace，不污染浏览器历史）
  useEffect(() => {
    syncUrl({ keyword, category_id: categoryId, status, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, categoryId, status, pagination.page, pagination.page_size]);

  // [布局] 挂载时读取商品实体默认 list/form 布局（失败/无权限静默 → 保持页面默认展示）
  useEffect(() => {
    loadProductLayouts().then((data) => {
      setMetaFields(data.fields);
      setLayoutCols(data.listColumns);
      setLayoutCustomized(isProductListLayoutCustomized(data.listColumns));
      setFormSections(data.formSections);
    });
  }, []);

  // [U-03] 分类下拉选项（商品分类树；失败静默）
  useEffect(() => {
    categoryApi.tree('product').then((res) => {
      if (res.code === 0) setCategories(Array.isArray(res.data) ? res.data : []);
    }).catch(() => { /* 无分类/无权限：空选项 */ });
  }, []);

  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.page_size, debouncedKeyword, categoryId, status]);

  const fetchProducts = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { name?: string; keyword?: string; category_id?: string; status?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined,
        category_id: categoryId || undefined,
        status: status || undefined,
      };
      const response = await productApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setProducts(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  // [U-05 2026-09-13] 批量删除：自管 Set + 页头按钮 → 统一钩子（逐条执行 + **失败原因汇总**）
  // 打印标签仍在页头（“打印选中”只适用于勾选集合、不是逐条动账动作）——但取数改用同一份 sel，避免两套选择态。
  const sel = useRowSelection({ rows: products, getKey: (p) => p.id });
  const batch = useBatchAction({
    selection: sel,
    label: (p) => p.code ? `${p.code} ${p.name}` : p.name || p.id,
    onDone: fetchProducts,
    actions: [
      {
        key: 'del',
        label: '批量删除',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        confirm: (rows) => ({
          title: `确定删除选中的 ${rows.length} 个商品吗？`,
          content: '删除后不可恢复；已被 BOM/订单/库存引用的商品会被跳过，并在结果里列出原因',
          danger: true,
        }),
        run: (p) => productApi.delete(p.id),
      },
    ],
    exportSpec: {
      filename: `商品_选中_${format.today()}.csv`,
      headers: ['编码', '名称', '分类', '库存数量'],
      row: (p) => [p.code || '', p.name, p.edges?.category?.name || p.category_name || '', String(p.stock_qty ?? '')],
    },
  });

  // [2026-09-16]「下架」快捷：停用后从开单选择器消失（历史单据与库存不受影响）；
  // 有历史引用的商品删不掉时，这是正确的「不再销售」路径
  const handleToggleStatus = async (p: Product) => {
    const toInactive = (p.status || 'active') === 'active';
    try {
      const response = await productApi.update(p.id, { status: toInactive ? 'inactive' : 'active' });
      if (response.code === 0) {
        message.success(`商品 ${p.code} 已${toInactive ? '停用（下架），开单时不再可选' : '启用'}`);
        fetchProducts();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  const handleDelete = async (id: string, code: string) => {
    try {
      const response = await productApi.delete(id);
      if (response.code === 0) {
        message.success(`商品 ${code} 已删除`);
        fetchProducts();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete product:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  const handleViewDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailProduct(null);
    try {
      const response = await productApi.get(id);
      if (response.code === 0) {
        setDetailProduct(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch product detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleExportExcel = async () => {
    const ok = await exportFromBackend('/v1/export/products', 'xlsx');
    if (ok) message.success('Excel 导出成功，已开始下载');
    else message.error('Excel 导出失败，请稍后重试');
  };

  // ── [布局] 商品管理列表按「商品」实体默认列表布局驱动列显示 ─────────────────────
  // [S-05 2026-09-13] 商品类型显示改字典驱动（此前映射 normal/batch/serial/composite 与实际
  // 数据编码（finished/goods/raw_material…）完全对不上 → 列恒显 '-'）；未命中回退原始 code
  const goodsTypeDict = useDictEntries('goods_type');
  const productTypeText = (t?: string) => (t ? dictText(goodsTypeDict, t) : '-');
  const costMethodText = (m?: string) =>
    m === 'fifo' ? '先进先出(FIFO)' : m === 'lifo' ? '后进先出(LIFO)' : (m === 'weighted_avg' || m === 'average') ? '移动平均' : m === 'standard' ? '标准成本' : '-';
  const boolText = (v: unknown) => (v ? '是' : '否');
  const scalarText = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '-';
    if (typeof v === 'boolean') return v ? '是' : '否';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  // 列码 → 单元格（业务列走商品业务渲染；模板/自定义字段值存于 ext_fields 或真实字段）
  const renderInfoCell = (code: string, p: Product): ReactNode => {
    const unitName = p.unit_name || p.edges?.unit?.name || '';
    switch (code) {
      case 'code':
        return <span className="font-medium text-gray-900">{p.code}</span>;
      case 'spec':
        return <span className="text-gray-500 text-sm">{p.spec || '-'}</span>;
      case 'barcode':
        return <span className="text-gray-500 text-sm font-mono">{p.barcode || '-'}</span>;
      case 'unit':
      case 'unit_id':
        return <span className="text-gray-500 text-sm">{unitName || '-'}</span>;
      case 'sale_price':
        return <span className="font-medium text-gray-900">¥{format.currency(p.sale_price)}</span>;
      case 'purchase_price':
        return <span className="text-gray-500 text-sm">¥{format.currency(p.purchase_price)}</span>;
      case 'safety_stock':
        return <span className="text-gray-500 text-sm">{p.safety_stock ?? '-'}</span>;
      case 'min_order_qty':
        return <span className="text-gray-500 text-sm">{p.min_order_qty ?? '-'}</span>;
      case 'shelf_life_days':
        return <span className="text-gray-500 text-sm">{p.shelf_life_days ? `${p.shelf_life_days} 天` : '-'}</span>;
      case 'product_type':
        return <span className="text-gray-500 text-sm">{productTypeText(p.product_type)}</span>;
      case 'cost_method':
        return <span className="text-gray-500 text-sm">{costMethodText(p.cost_method)}</span>;
      case 'is_batch':
        return <span className="text-gray-500 text-sm">{boolText(p.is_batch)}</span>;
      case 'is_serial':
        return <span className="text-gray-500 text-sm">{boolText(p.is_serial)}</span>;
      case 'is_combo':
        return <span className="text-gray-500 text-sm">{boolText(p.is_combo)}</span>;
      case 'status':
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(p.status)}`}>
            {format.statusText(p.status)}
          </span>
        );
      case 'remark':
        return (
          <span className="text-gray-500 text-sm block max-w-[220px] truncate" title={p.remark || ''}>{p.remark || '-'}</span>
        );
      case 'description':
        return (
          <span className="text-gray-500 text-sm block max-w-[220px] truncate" title={p.description || ''}>{p.description || '-'}</span>
        );
      case 'created_at':
        return <span className="text-gray-500 text-sm">{format.date(p.created_at, 'YYYY-MM-DD HH:mm') || '-'}</span>;
      case 'updated_at':
        return <span className="text-gray-500 text-sm">{format.date(p.updated_at, 'YYYY-MM-DD HH:mm') || '-'}</span>;
      case 'spu':
      case 'spu_code':
      case 'spu_id':
        return <SpuCodeCell p={p} />;
      case 'style_no': {
        // 款号列：优先显示商品实际款号值（存于 ext_fields，可能只存在旧键如 style_no）；无值再退“所属多规格商品编号”
        const v = p.ext_fields ? pickFieldValue(p.ext_fields as Record<string, any>, 'style_no') : undefined;
        if (v !== undefined && v !== null && v !== '') return <span className="text-gray-500 text-sm">{scalarText(v)}</span>;
        return <SpuCodeCell p={p} />;
      }
      default: {
        // 元数据自定义字段（模板字段值存于 ext_fields）或商品真实字段；
        // 同义键回退：列码 color 而数据只存 TEST001COLOR 时也能取值（否则布局列会显示 -）
        const v = pickFieldValue(p as unknown as Record<string, any>, code);
        if (v !== undefined && v !== null && v !== '') {
          return <span className="text-gray-500 text-sm">{scalarText(v)}</span>;
        }
        return <span className="text-gray-500 text-sm">-</span>;
      }
    }
  };

  // 本页“始终展示”的固定列（勾选/图片/名称/分类/库存/操作）；布局列引用这些码时跳过，避免重复
  const FIXED_INFO_SKIP = new Set([
    'id', 'tenant_id', 'deleted_at', 'ext', 'ext_fields',
  ]);

  // 布局信息列（有序、去重）：用户有意配置了布局时**严格按其列与顺序**渲染；否则用页面默认信息列
  // （2026-09-11 修复：此前定制模式下强制把图片/名称/分类前置、并将其它维度列提前，用户拖拽顺序不生效）
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
    return PRODUCT_LIST_DEFAULT_INFO.map((f) => ({ field: f }));
  })();

  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cell: (p: Product) => ReactNode;
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
    cell: (p) => (
      <input
        type="checkbox"
        checked={sel.isSelected(p)}
        onChange={() => sel.toggle(p)}
        className="w-4 h-4 accent-blue-600 cursor-pointer"
        aria-label={`选择 ${p.code}`}
      />
    ),
  };

  const imageCol: RowCol = {
    key: 'image',
    header: '图片',
    // [2026-09-14 手机实测] 窄屏隐藏：冻结操作列会盖住名称列——隐藏图片列给名称让位
    headCls: `${TH_L} max-lg:hidden`,
    cellCls: `${TD} max-lg:hidden`,
    cell: (p) =>
      productCover(p) ? (
        <img src={productCover(p)} alt={p.name} className="w-10 h-10 object-cover rounded-lg border border-gray-100" />
      ) : (
        <span className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300">
          <Package className="w-5 h-5" />
        </span>
      ),
  };

  const nameCol: RowCol = {
    key: 'name',
    header: '名称',
    cell: (p) => (
      <>
        <span className="text-gray-900">{p.name}</span>
        {p.is_combo && (
          <button
            type="button"
            onClick={() => navigate(`/combo-products/${p.id}`)}
            className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 text-xs font-medium hover:bg-indigo-100"
            title="组合商品：由配件组装而成，点击维护组装配方"
          >
            <Boxes className="w-3 h-3" /> 组装
          </button>
        )}
      </>
    ),
  };

  const categoryCol: RowCol = {
    key: 'category',
    header: '分类',
    cell: (p) => <span className="text-gray-500 text-sm">{p.edges?.category?.name || p.category_name || '-'}</span>,
  };

  const stockCol: RowCol = {
    key: 'stock',
    header: '库存数量',
    cell: (p) => {
      const sq = Number(p.stock_qty ?? 0) || 0;
      const low = (p.safety_stock || 0) > 0 && sq < Number(p.safety_stock);
      return (
        <button
          type="button"
          onClick={() => setStockView(p)}
          className={`group inline-flex items-center gap-1 ${low ? 'text-red-600 font-medium text-sm' : 'text-gray-900 text-sm'} hover:text-blue-600`}
          title={low ? '库存低于安全库存 · 点击查看各仓库' : '点击查看该商品各仓库数量'}
        >
          <span className="underline decoration-dotted decoration-gray-300 group-hover:decoration-blue-500 underline-offset-4">
            {format.qty(sq)}
          </span>
        </button>
      );
    },
  };

  const actionsCol: RowCol = {
    key: '__actions',
    headCls: TH_R,
    cellCls: `${TD} text-right`,
    header: '操作',
    cell: (p) => {
      const acts: RowAction[] = [
        { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => handleViewDetail(p.id) },
        { key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, onClick: () => navigate(`/products/${p.id}/edit`) },
        {
          key: 'toggle',
          label: (p.status || 'active') === 'active' ? '停用' : '启用',
          title:
            (p.status || 'active') === 'active'
              ? '停用（下架）：不再出现在开单选择器，可随时重新启用'
              : '重新启用：恢复可开单',
          icon: (p.status || 'active') === 'active' ? <CirclePause className="w-4 h-4" /> : <CirclePlay className="w-4 h-4" />,
          onClick: () => handleToggleStatus(p),
        },
        ...(p.is_combo
          ? []
          : ([
              {
                key: 'combo',
                label: '设为组装商品',
                title: '设为组装商品（配置组装配方）',
                icon: <Boxes className="w-4 h-4" />,
                onClick: () => navigate(`/combo-products/create?from=${p.id}`),
              },
            ] as RowAction[])),
        {
          key: 'del',
          label: '删除',
          icon: <Trash2 className="w-4 h-4" />,
          danger: true,
          // 注意：本页 handleDelete 不做二次确认（直接调接口）→ 保留 RowActions confirm 作为唯一确认层；
          // 客户/供应商/仓库页的 handleDelete 含 confirmAction，故它们不再在 RowActions 传 confirm（防双层）
          confirm: `确定删除商品 ${p.code} 吗？删除后不可恢复`,
          onClick: () => handleDelete(p.id, p.code),
        },
      ];
      return <RowActions actions={acts} />;
    },
  };

  const infoColOf = (lc: LayoutColumn): RowCol => {
    // 多规格商品类列（含布局显式命名为「编号/款号/款式」但字段码不在此集合的情况）→ 统一渲染所属多规格商品徽标
    const isSpuCol = SPU_FIELD_CODES.has(lc.field) || /款|多规格/.test(lc.label || '');
    return {
      key: lc.field,
      width: lc.width,
      header: layoutColLabel(lc.field, lc.label, metaFields),
      cell: isSpuCol ? (p) => <SpuCodeCell p={p} /> : (p) => renderInfoCell(lc.field, p),
    };
  };

  // SKU 维度列（默认列回退模式）：按本页多规格商品「实际配置的规格维度」动态生成（颜色/尺码、容量、电压、型号…行业无关），
  // 最多取前 3 个维度；旧数据无维度定义但 ext 含 color/size 时回退颜色/尺码两列
  const dimInfoCols: RowCol[] = (() => {
    const map = new Map<string, { code: string; name: string }>();
    const push = (code: string, name: string) => {
      if (code && !map.has(code) && map.size < 3) map.set(code, { code, name: name || code });
    };
    for (const p of products) {
      const spuDims = (p.edges?.spu as { dims?: { code: string; name?: string }[] } | undefined)?.dims;
      if (Array.isArray(spuDims)) for (const d of spuDims) if (d && d.code) push(d.code, d.name || '');
    }
    if (map.size === 0) {
      const hasLegacy = products.some((p) => p.ext_fields && (p.ext_fields.color != null || p.ext_fields.size != null));
      if (!hasLegacy) return [];
      push('color', '颜色');
      push('size', '尺码');
    }
    return Array.from(map.values()).map((d) => ({
      key: d.code,
      header: d.name,
      cell: (p) => {
        // 维度值可能存于旧模板字段码（列 dims=color，数据只存 TEST001COLOR）→ 同义键回退
        const v = pickFieldValue(p as unknown as Record<string, any>, d.code);
        return <span className="text-gray-700">{v !== undefined && v !== '' && v !== null ? String(v) : '-'}</span>;
      },
    }));
  })();

  // 页内是否存在 SKU（多规格商品下多规格）商品
  const hasSpuInPage = products.some((p) => !!p.spu_id || !!p.edges?.spu);

  // 定制布局：每个布局列按**用户排序的位置**映射到对应渲染器（图片/名称/分类/库存复用固定列渲染，其余走信息列）
  const customColFor = (lc: LayoutColumn): RowCol => {
    const base: RowCol =
      lc.field === 'images' || lc.field === 'image' || lc.field === 'image_url' ? imageCol
      : lc.field === 'name' ? nameCol
      : lc.field === 'category' || lc.field === 'category_id' ? categoryCol
      : lc.field === 'stock' || lc.field === 'stock_qty' ? stockCol
      : infoColOf(lc);
    const label = lc.label && lc.label !== lc.field ? lc.label : undefined;
    if (!label && lc.width == null) return base;
    return { ...base, header: label ?? base.header, width: lc.width ?? base.width };
  };

  // 列顺序：定制 = 选择列 + **完全按布局列顺序** + 操作列；未定制 = 页面默认顺序
  const baseRowCols: RowCol[] = layoutCustomized
    ? [selCol, ...infoCols.map(customColFor), actionsCol]
    : [
        selCol,
        infoColOf({ field: 'code' }),
        imageCol,
        nameCol,
        categoryCol,
        ...(hasSpuInPage ? dimInfoCols : []),
        infoColOf({ field: 'spec' }),
        infoColOf({ field: 'barcode' }),
        stockCol,
        infoColOf({ field: 'sale_price' }),
        infoColOf({ field: 'purchase_price' }),
        infoColOf({ field: 'status' }),
        actionsCol,
      ];

  // [2026-09-12] 元数据自定义字段 → 追加为「可选列」（默认隐藏，视图菜单可勾选显示）
  // （模板/自定义字段不再必需先改布局才能看到）
  const baseColKeys = new Set(baseRowCols.map((c) => c.key));
  const META_COL_SKIP = new Set(['id', 'tenant_id', 'deleted_at', 'ext', 'ext_fields']);
  const metaExtraCols: RowCol[] = metaFields
    .filter((f) => f.code && !baseColKeys.has(f.code) && !META_COL_SKIP.has(f.code))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.code.localeCompare(b.code))
    .map((f) => ({
      key: f.code,
      header: f.name || layoutColLabel(f.code, undefined, metaFields),
      cell: (p) => renderInfoCell(f.code, p),
    }));
  const rowCols: RowCol[] = [...baseRowCols, ...metaExtraCols];
  // 默认可见列 = 页面基础列（附加的自定义字段默认不显示，勾选后写入 URL 可分享）
  const defaultVisible = baseRowCols.map((c) => c.key);

  // ── [布局] 详情弹窗：自定义字段按默认 form 布局 sections 分组/排序 ───────────
  const metaFieldName = (code: string): string => {
    const f = metaFields.find((x) => x.code === code);
    return f?.name || '';
  };

  // [易用性 P2] 视图菜单的列名：表头多是 JSX（带图标/排序标记），菜单里需要纯文本中文名
  const viewLabelOf = (key: string): string => {
    switch (key) {
      case '__sel':
        return '勾选';
      case '__actions':
        return '操作';
      case 'image':
        return '图片';
      case 'name':
        return '商品名称';
      case 'category':
        return '分类';
      case 'stock':
        return '库存数量';
      default:
        break;
    }
    return tableColumnLabel(key) || metaFieldName(key) || dimLabel(key) || key;
  };
  // [易用性 P2] 视图里直接新建元数据字段（与「元数据管理 → 字段管理」同一份数据）
  // 权限：字段 API 挂的是 system 权限，无权用户不显示入口（避免点了 403）
  const { permissions } = useAuthStore();
  const canManageFields = permissions.includes('*') || permissions.includes('system');
  const createProductField = async (input: { name: string; code: string; fieldType: string }) => {
    const entRes = await entityApi.getByCode('product');
    const entityId = (entRes as { data?: { id?: string } }).data?.id;
    if (!entityId) throw new Error('未找到商品实体定义');
    await fieldApi.create({ entity_id: entityId, code: input.code, name: input.name, field_type: input.fieldType });
    // 重新拉布局：未定制布局时新字段会进入可选列；已定制则需到「布局」里加入
    const data = await loadProductLayouts();
    setMetaFields(data.fields);
    // 新字段会追加进「视图 → 显示列」可选列（表单/详情同步可用）
    return { appeared: true };
  };

  // [易用性 P2] 表格视图：可见列 + 列序 + 自定义列名（个人偏好，写 URL 可分享；null=页面默认全列）
  // 必须走 useTableView 统一接入：它同时同步 `?cols=`（可见列/列序）与 `?colnames=`（自定义列名），
  // 并负责把列名套到表头。此前商品页自行接 TableViewMenu 漏了列名回调（onLabelsChange 未传）→ 改列名立即丢失。
  const { visibleColumns: visibleRowCols, menu: viewMenu } = useTableView({
    pageKey: 'product-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
    labelOf: viewLabelOf,
    createField: canManageFields ? createProductField : undefined,
    entityLabel: '商品',
    defaultVisible,
  });

  // ── 多规格/同名聚合（2026-09-10）：多规格商品多 SKU 合并展示——共享列（图片/名称/分类/单位/编号…）竖向合并不重复 ──
  const groupKeyOf = (p: Product): string =>
    p.spu_id ? `spu:${p.spu_id}` : `nm:${p.name || ''}|${p.category_id || ''}|${p.unit_id || ''}`;
  const mergeTextOf = (key: string, p: Product): string => {
    if (SPU_FIELD_CODES.has(key)) return p.edges?.spu?.code || p.spu_id || '';
    switch (key) {
      case 'image':
      case 'images':
      case 'image_url': return productCover(p) || '';
      case 'name': return p.name || '';
      case 'category': return p.edges?.category?.name || p.category_name || '';
      case 'unit':
      case 'unit_id': return p.unit_name || p.edges?.unit?.name || '';
      case 'created_at': return p.created_at || '';
      case 'updated_at': return p.updated_at || '';
      case 'status': return p.status || '';
      case 'remark': return p.remark || '';
      default: return '';
    }
  };

  // [U-03] 非关键词筛选条件的中文说明（空态提示用）：筛了分类/状态却提示「暂无数据」会误导用户重复建档
  // [2026-09-16] 默认状态（列表 active / 下架页 inactive）不算「筛选」——否则空态会把默认条件标成筛选、
  // 引导「清空筛选」却回到同一默认值（下架页清不掉、列表页怪）；真无数据时走 title/description 引导
  const isDefaultStatus = status === (archived ? 'inactive' : 'active');
  const productFilterNote = [
    categoryId ? `分类「${findCategoryNode(categories, categoryId)?.name ?? categoryId}」` : '',
    status && !isDefaultStatus ? `状态「${format.statusText(status)}」` : '',
  ].filter(Boolean).join(' + ') || undefined;

  interface FlatRow {
    p: Product;
    merged: Set<string>;
    isFirst: boolean;
    groupSize: number;
  }
  const flatRows: FlatRow[] = (() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      const k = groupKeyOf(p);
      const arr = map.get(k);
      if (arr) arr.push(p);
      else map.set(k, [p]);
    }
    const groups = Array.from(map.entries()).map(([k, ms]) => ({ key: k, members: ms }));
    // 最新优先：按组内最新更新时间倒序（新录/刚编辑的款置顶）；组内 SKU 按编码升序排列（整齐）
    groups.sort((a, b) => {
      const ma = Math.max(...a.members.map((m) => new Date(m.updated_at || 0).getTime()));
      const mb = Math.max(...b.members.map((m) => new Date(m.updated_at || 0).getTime()));
      return mb - ma;
    });
    const out: FlatRow[] = [];
    for (const g of groups) {
      g.members.sort((x, y) => (x.code || '').localeCompare(y.code || ''));
      const n = g.members.length;
      const merged = new Set<string>();
      if (n > 1) {
        for (const col of rowCols) {
          if (!MERGEABLE_COLS.has(col.key) && !SPU_FIELD_CODES.has(col.key)) continue;
          const first = mergeTextOf(col.key, g.members[0]);
          if (g.members.every((m) => mergeTextOf(col.key, m) === first)) merged.add(col.key);
        }
      }
      g.members.forEach((p, idx) => out.push({ p, merged, isFirst: idx === 0, groupSize: n }));
    }
    return out;
  })();
  // 有 sections 时：ext 字段按 sections 保序分组，未收录归「其他自定义字段」；无布局/无 ext 返回 null（平铺展示）。
  // 仅当某 section 真正放入了 ext 字段码时才启用分组，否则（如种子默认 form 布局只含核心码）保持原平铺。
  const detailExtGroups: { title: string; entries: [string, any][] }[] | null = (() => {
    const ext = detailProduct?.ext_fields;
    if (!ext || Object.keys(ext).length === 0) return null;
    if (formSections.length === 0) return null;
    const groups: { title: string; entries: [string, any][] }[] = [];
    const placed = new Set<string>();
    for (const sec of formSections) {
      const entries: [string, any][] = [];
      for (const code of sec.fields) {
        if (PRODUCT_FORM_FIXED_CODES.has(code)) continue; // 顶部固定展示区已有
        if (placed.has(code)) continue;
        // 同义键回退取值（布局列码 color / 数据存 TEST001COLOR 也能显示）
        const v = pickFieldValue(ext as Record<string, any>, code);
        if (v === undefined || v === null || v === '') continue;
        entries.push([code, v]);
        placed.add(code);
      }
      if (entries.length) groups.push({ title: sec.title || '未命名分组', entries });
    }
    if (placed.size === 0) return null; // 布局未放置任何 ext 字段 → 平铺
    const rest = Object.keys(ext).filter((k) => !placed.has(k));
    if (rest.length) groups.push({ title: '其他自定义字段', entries: rest.map((k) => [k, pickFieldValue(ext as Record<string, any>, k)]) });
    // 维度去重（2026-09-11）：同义维度且值相同只保留一份（如 TEST001COLOR 与 颜色皆黑色→只留「颜色」）
    const kept = new Set(
      dedupeDimEntries(groups.flatMap((g) => g.entries.map(([c]) => ({ key: c, value: String(pickFieldValue(ext as Record<string, any>, c) ?? '') })))).map((e) => e.key),
    );
    const deduped = groups
      .map((g) => ({ title: g.title, entries: g.entries.filter(([c]) => kept.has(c)) }))
      .filter((g) => g.entries.length > 0);
    return deduped.length ? deduped : null;
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title={archived ? '下架商品管理' : '商品管理'}
        subtitle={archived ? '已停用（不再销售）的商品：可恢复启用或删除' : '商品列表'}
        onBack={archived ? () => navigate('/products') : undefined}
        extra={
          <>
            <button
              onClick={() => exportCsv(`商品_${format.today()}.csv`,
                ['编码', '名称', '规格', '分类', '条码', '库存数量', '销售价', '采购价', '状态'],
                products.map(p => [p.code, p.name, p.spec, p.edges?.category?.name || '', p.barcode || '', format.qty(p.stock_qty ?? 0), Number(p.sale_price).toFixed(2), Number(p.purchase_price).toFixed(2), format.statusText(p.status)]))}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">导出 CSV</span>
            </button>
            {!archived && hasPermissionNow(PERM_IMPORT_EXPORT) && (
            <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-2" title="批量导入商品（CSV/Excel）">
              <Upload className="w-4 h-4" />
              <span className="hidden md:inline">导入</span>
            </button>
            )}
            <button onClick={handleExportExcel} className="btn-secondary flex items-center gap-2" title="导出全部商品（Excel）">
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">导出 Excel</span>
            </button>
            {sel.count > 0 && (
              <button
                onClick={() => navigate(`/print/product_label?ids=${sel.ids.join(',')}`)}
                className="btn-secondary flex items-center gap-2"
                title="打印选中商品的标签"
              >
                <Printer className="w-5 h-5" />
                <span className="hidden md:inline">打印标签({sel.count})</span>
              </button>
            )}
            {!archived && (
              <button
                onClick={() => navigate('/products/create')}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新增商品</span>
              </button>
            )}
            {!archived && (
              <button
                onClick={() => navigate('/products/archived')}
                className="btn-secondary flex items-center gap-2"
                title="下架商品管理：查看已停用商品，可恢复启用或删除"
              >
                <Archive className="w-4 h-4" />
                <span className="hidden md:inline">下架商品</span>
              </button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          {/* [手机端适配 2026-09-14] flex-wrap：390px 窄屏下筛选控件自动换行（此前状态下拉/我的筛选/视图被挤出屏幕） */}
          <div className="flex flex-wrap items-center gap-4">
            <BarcodeInput
              className="flex-1 min-w-[160px] max-w-md"
              value={keyword}
              onChange={(v) => {
                setKeyword(v);
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              onDetect={(code) => {
                setKeyword(code);
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              placeholder="搜索或扫码：条码 / 编码 / 名称"
            />
            <button
              onClick={() => {
                setKeyword('');
                setCategoryId('');
                setStatus(archived ? 'inactive' : 'active');
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              className="btn-secondary"
            >
              重置
            </button>
            {/* [U-03 2026-09-13] 筛选维度：分类 + 状态（配合「我的筛选」保存「某分类 + 已停用」） */}
            <div className="w-44">
              <SearchSelect
                options={buildCategoryOptions(categories)}
                value={categoryId || undefined}
                onChange={(v) => { setCategoryId(v ?? ''); setPagination(prev => ({ ...prev, page: 1 })); }}
                allowClear
                placeholder="全部分类"
              />
            </div>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-select w-28"
              aria-label="商品状态筛选"
            >
              <option value="">全部状态</option>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
            <FilterPresetMenu
              pageKey="product-list"
              currentParams={{ keyword: debouncedKeyword, category_id: categoryId, status }}
              onApply={(p) => {
                setKeyword(p.keyword ?? '');
                setCategoryId(p.category_id ?? '');
                setStatus(p.status ?? '');
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
            />
            {/* [易用性 P2] 我的视图：选列 + 列序 + 列名 + 命名预设（写 URL 可分享） */}
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
                {visibleRowCols.map((c) => (
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
                <tr>
                  <td colSpan={visibleRowCols.length} className="px-6 py-4">
                    <TableSkeleton rows={5} />
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={visibleRowCols.length} className="px-6">
                    {/* [U-03] 分类/状态也是筛选条件：空态必须能区分「筛选无结果」与「真无数据」
                        （只判断关键词的话，筛了分类却提示「暂无商品，点右上角新增」→ 用户会重复建档） */}
                    <ListEmpty
                      keyword={keyword}
                      filterNote={productFilterNote}
                      onClear={() => {
                        setKeyword('');
                        setCategoryId('');
                        setStatus(archived ? 'inactive' : 'active');
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                      title={archived ? '暂无下架商品' : '暂无商品数据'}
                      description={
                        archived
                          ? '将商品「停用」后会出现在这里，可随时恢复启用'
                          : status === 'active' && !keyword && !categoryId
                            ? '当前没有「启用」中的商品；如有下架商品，点右上角「下架商品」查看并可恢复启用'
                            : '点击右上角「新增商品」开始录入，也可用「导入」批量导入商品档案'
                      }
                    />
                  </td>
                </tr>
              ) : (
                flatRows.map(({ p: product, merged, isFirst, groupSize }) => (
                  <tr
                    key={product.id}
                    className={`hover:bg-gray-50 transition-colors ${sel.isSelected(product) ? 'bg-blue-50' : ''} ${groupSize > 1 && isFirst ? 'border-t-2 border-blue-50' : ''}`}
                  >
                    {visibleRowCols.map((c) => {
                      if (merged.has(c.key) && !isFirst) return null;
                      const cell = c.cell(product);
                      const isMergedFirst = merged.has(c.key) && isFirst;
                      const content =
                        isMergedFirst && c.key === 'name' && groupSize > 1 ? (
                          <span className="inline-flex items-center gap-2">
                            {cell}
                            <span
                              className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs whitespace-nowrap"
                              title={`多规格/同名聚合显示，当前页该多规格商品共 ${groupSize} 个 SKU`}
                            >
                              多规格 {groupSize} SKU
                            </span>
                          </span>
                        ) : (
                          cell
                        );
                      return (
                        <td
                          key={c.key}
                          className={c.cellCls || TD}
                          rowSpan={isMergedFirst ? groupSize : undefined}
                          style={isMergedFirst ? { verticalAlign: 'middle' } : undefined}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && products.length > 0 && (
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

      {/* 分仓库存弹窗：点列表“库存数量”查看该商品各仓库数量 */}
      <Modal
        title={stockView ? `分仓库存 · ${stockView.name}（${stockView.code}）` : '分仓库存'}
        open={!!stockView}
        onCancel={() => setStockView(null)}
        footer={null}
        width={620}
      >
        {stockView && (stockView.stock_by_warehouse && stockView.stock_by_warehouse.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">仓库</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">在库（可用）</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">锁定</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">在途</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">合计（在库+锁定）</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stockView.stock_by_warehouse.map(w => (
                  <tr key={w.warehouse_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-sm text-gray-800">{w.warehouse_name}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-700 text-right">{format.qty(w.qty_available)}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-500 text-right">{format.qty(w.qty_locked)}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-500 text-right">{format.qty(w.qty_in_transit)}</td>
                    <td className="px-4 py-2.5 text-sm font-medium text-gray-900 text-right">
                      {format.qty((Number(w.qty_available) || 0) + (Number(w.qty_locked) || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50">
                  <td className="px-4 py-2.5 text-sm font-medium text-gray-700">合计</td>
                  <td className="px-4 py-2.5 text-sm font-medium text-gray-900 text-right">{format.qty(stockView.stock_qty ?? 0)}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-500 text-right">
                    {format.qty(stockView.stock_by_warehouse.reduce((a, w) => a + (Number(w.qty_locked) || 0), 0))}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-500 text-right">
                    {format.qty(stockView.stock_by_warehouse.reduce((a, w) => a + (Number(w.qty_in_transit) || 0), 0))}
                  </td>
                  <td className="px-4 py-2.5 text-sm font-medium text-gray-900 text-right">
                    {format.qty(stockView.stock_by_warehouse.reduce((a, w) => a + (Number(w.qty_available) || 0) + (Number(w.qty_locked) || 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-gray-400">该商品暂无库存记录（或当前无可查看的仓库）</div>
        ))}
      </Modal>

      {/* 商品详情模态框 */}
      {detailProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDetailProduct(null)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">商品详情</h3>
              <button
                onClick={() => setDetailProduct(null)}
                className="p-1 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <label className="text-xs text-gray-500">商品编码</label>
                  <p className="text-sm font-medium text-gray-900 mt-1">{detailProduct.code}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">商品名称</label>
                  <p className="text-sm font-medium text-gray-900 mt-1">{detailProduct.name}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">规格型号</label>
                  <p className="text-sm text-gray-900 mt-1">{detailProduct.spec || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">条形码</label>
                  <p className="text-sm text-gray-900 mt-1">{detailProduct.barcode || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">商品分类</label>
                  <p className="text-sm text-gray-900 mt-1">{detailProduct.edges?.category?.name || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">计量单位</label>
                  <p className="text-sm text-gray-900 mt-1">{detailProduct.edges?.unit?.name || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">商品类型</label>
                  <p className="text-sm text-gray-900 mt-1">{productTypeText(detailProduct.product_type)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">成本核算方法</label>
                  <p className="text-sm text-gray-900 mt-1">
                    {detailProduct.cost_method === 'fifo' ? '先进先出(FIFO)' :
                     detailProduct.cost_method === 'lifo' ? '后进先出(LIFO)' :
                     (detailProduct.cost_method === 'weighted_avg' || detailProduct.cost_method === 'average') ? '移动平均' :
                     detailProduct.cost_method === 'standard' ? '标准成本' : '-'}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">销售单价</label>
                  <p className="text-sm font-medium text-gray-900 mt-1">¥{format.currency(detailProduct.sale_price)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">采购单价</label>
                  <p className="text-sm text-gray-900 mt-1">¥{format.currency(detailProduct.purchase_price)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">安全库存</label>
                  <p className="text-sm text-gray-900 mt-1">{detailProduct.safety_stock}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">保质期(天)</label>
                  <p className="text-sm text-gray-900 mt-1">{detailProduct.shelf_life_days || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">批次管理</label>
                  <p className="text-sm text-gray-900 mt-1">{detailProduct.is_batch ? '是' : '否'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">序列号管理</label>
                  <p className="text-sm text-gray-900 mt-1">{detailProduct.is_serial ? '是' : '否'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">状态</label>
                  <p className="mt-1">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(detailProduct.status)}`}>
                      {format.statusText(detailProduct.status)}
                    </span>
                  </p>
                </div>
                {(detailProduct.images && detailProduct.images.length > 0) || detailProduct.image_url ? (
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500">商品图片</label>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {(detailProduct.images && detailProduct.images.length > 0
                        ? detailProduct.images
                        : [detailProduct.image_url]
                      ).filter(Boolean).map((u, i) => (
                        <img key={i} src={u} alt={`${detailProduct.name} 图${i + 1}`} className="w-24 h-24 object-cover rounded-lg border border-gray-200" />
                      ))}
                    </div>
                  </div>
                ) : null}
                {detailProduct.description && (
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500">商品描述（客户门户展示）</label>
                    <p className="text-sm text-gray-900 mt-1 whitespace-pre-wrap break-words">{detailProduct.description}</p>
                  </div>
                )}
                {detailProduct.remark && (
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500">备注</label>
                    <p className="text-sm text-gray-900 mt-1 whitespace-pre-wrap">{detailProduct.remark}</p>
                  </div>
                )}
              </div>

              {detailProduct.ext_fields && Object.keys(detailProduct.ext_fields).length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-100">
                  {detailExtGroups ? (
                    // 布局驱动：自定义字段按 form 布局 sections 分组展示
                    detailExtGroups.map((g) => (
                      <div key={g.title} className="mb-4 last:mb-0">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">{g.title}</h4>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                          {g.entries.map(([key, value]) => (
                            <div key={key}>
                              <label className="text-xs text-gray-500">{metaFieldName(key) || fieldCodeToName[key] || dimLabel(key)}</label>
                              <p className="text-sm text-gray-900 mt-1">
                                {value === null || value === '' ? '-' : String(value)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    // 无布局：平铺展示（同义维度且值相同只保留一份，避免 尺码/颜色 重复两行）
                    <>
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">自定义字段</h4>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                        {dedupeDimEntries(
                          Object.entries(detailProduct.ext_fields).map(([key, value]) => ({ key, value: String(value ?? '') })),
                        ).map(({ key, value }) => (
                          <div key={key}>
                            <label className="text-xs text-gray-500">{metaFieldName(key) || fieldCodeToName[key] || dimLabel(key)}</label>
                            <p className="text-sm text-gray-900 mt-1">
                              {value === null || value === '' ? '-' : String(value)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setDetailProduct(null)}
                className="btn-secondary"
              >
                关闭
              </button>
              <button
                onClick={() => {
                  navigate(`/products/${detailProduct.id}/edit`);
                  setDetailProduct(null);
                }}
                className="btn-primary"
              >
                编辑
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 详情加载中 */}
      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-lg p-6">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-500 mt-3 text-center">加载中...</p>
          </div>
        </div>
      )}

      <ImportModal
        open={importOpen}
        title="批量导入商品（CSV / Excel）"
        importUrl="/v1/import/products"
        templateUrl="/v1/export/products-template"
        templateUrlXlsx="/v1/export/products-template?format=xlsx"
        templateHint="编码, 名称, 规格型号, 条形码, 商品类型, 分类名称, 单位名称, 销售价, 采购价, 安全库存, 备注, 是否批次, 保质期(天)"
        hintExtra="支持 WMS/第三方常见列名（商品名称 / 商品编号 / 商品规格 / 单位简称）；在「元数据管理 → 字段管理」为商品添加的自定义字段（如生产厂家/剂型）会自动出现在模板列里并随导入写入；模板下载即可看到全部可填列。"
        duplicateStrategy
        onClose={() => setImportOpen(false)}
        onSuccess={fetchProducts}
      />
    </div>
  );
}
