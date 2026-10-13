import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, Layers, X, Upload } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { spuApi, categoryApi, unitApi } from '@/api/product';
import { Spu, SpuDim } from '@/types/product';
import { CategoryTreeNode, Unit } from '@/types/product';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { RowActions } from '@/components/RowActions';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { ImportModal } from '@/components/ImportModal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { PERM_IMPORT_EXPORT, hasPermissionNow, usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';
import { confirmAction } from '@/utils/confirm';
import { buildCategoryOptions } from '@/utils/categoryTree';

interface DimRow {
  code: string;
  name: string;
  valuesText: string;
}

const statusText = (s?: string) =>
  s === 'active' ? '启用' : s === 'inactive' ? '停用' : s || '-';

export function SpuList() {
  const navigate = useNavigate();
  // [权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
  const { has } = usePermission();
  const [list, setList] = useState<Spu[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const [categories, setCategories] = useState<CategoryTreeNode[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  // ── 建档/编辑弹窗 ──
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Spu | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    category_id: '',
    unit_id: '',
    description: '',
    status: 'active',
  });
  const [dims, setDims] = useState<DimRow[]>([]);

  // ── SKU 管理弹窗 ──
  const [skuSpu, setSkuSpu] = useState<Spu | null>(null);
  const [skuLoading, setSkuLoading] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genForm, setGenForm] = useState({ sale_price: '', purchase_price: '', skip_existing: false });
  const [genning, setGenning] = useState(false);

  useEffect(() => {
    // [2026-09-14] 失败留痕：单项 403/失败不影响另一项与本页其它功能
    categoryApi.tree('product').then((res) => {
      if (res.code === 0) setCategories(Array.isArray(res.data) ? res.data : []);
    }).catch((err: any) => console.warn('商品分类加载失败（可能缺 product_list 权限）:', err?.message || err));
    unitApi.list({ page: 1, page_size: 1000 }).then((res) => {
      if (res.code === 0) setUnits(res.data?.list || []);
    }).catch((err: any) => console.warn('计量单位加载失败（可能缺 product_list 权限）:', err?.message || err));
  }, []);

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.page_size, debouncedKeyword]);

  const fetchList = async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const params: PaginationParams & { keyword?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined,
      };
      const response = await spuApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return;
        setList(response.data?.list || []);
        setPagination((prev) => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch spus:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false);
    }
  };

  // ── 建档/编辑 ──
  const openCreate = () => {
    setEditing(null);
    setForm({ code: '', name: '', category_id: '', unit_id: '', description: '', status: 'active' });
    // 默认一行空维度让用户按自身行业填写（颜色/尺码、容量、电压、型号…）；保存时空行自动忽略
    setDims([{ code: '', name: '', valuesText: '' }]);
    setEditorOpen(true);
  };

  const openEdit = (spu: Spu) => {
    setEditing(spu);
    setForm({
      code: spu.code,
      name: spu.name,
      category_id: spu.category_id || '',
      unit_id: spu.unit_id || '',
      description: spu.description || '',
      status: spu.status || 'active',
    });
    setDims(
      (spu.dims || []).map((d: SpuDim) => ({ code: d.code, name: d.name, valuesText: (d.values || []).join('，') })),
    );
    setEditorOpen(true);
  };

  const submitEditor = async () => {
    if (!form.name.trim()) {
      message.error('请填写名称');
      return;
    }
    // 维度解析（支持 逗号/顿号/空格/换行 分隔）
    const parsedDims: SpuDim[] = [];
    for (const row of dims) {
      const code = row.code.trim();
      const name = row.name.trim() || code;
      if (!code) continue;
      const values = row.valuesText
        .split(/[，,、\s\n]+/)
        .map((v) => v.trim())
        .filter((v) => v);
      if (values.length === 0) {
        message.error(`维度「${name}」至少填一个选项值`);
        return;
      }
      parsedDims.push({ code, name, values });
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        category_id: form.category_id || null,
        unit_id: form.unit_id || null,
        description: form.description,
        status: form.status,
        dims: parsedDims,
      };
      if (!editing) payload.code = form.code.trim() || undefined;
      const response = editing
        ? await spuApi.update(editing.id, payload as Partial<Spu>)
        : await spuApi.create(payload as Partial<Spu>);
      if (response.code === 0) {
        message.success(editing ? '多规格商品已更新' : '多规格商品已创建');
        setEditorOpen(false);
        fetchList();
      } else {
        message.error(response.message || '保存失败');
      }
    } catch (err: any) {
      message.error(err?.message || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (spu: Spu) => {
    if (!(await confirmAction({ title: `确定删除多规格商品「${spu.name}」吗？`, content: '其下有 SKU 商品时无法删除', danger: true }))) return;
    try {
      const response = await spuApi.delete(spu.id);
      if (response.code === 0) {
        message.success(`多规格商品「${spu.name}」已删除`);
        fetchList();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err: any) {
      message.error(err?.message || '删除失败');
    }
  };

  // ── SKU 管理 ──
  const openSkuManager = async (spu: Spu) => {
    setSkuSpu({ ...spu, edges: undefined });
    setSkuLoading(true);
    try {
      const response = await spuApi.get(spu.id);
      if (response.code === 0) setSkuSpu(response.data);
    } catch (err: any) {
      message.error(err?.message || '加载 SKU 明细失败');
    } finally {
      setSkuLoading(false);
    }
  };

  const combosOf = (dimsList: SpuDim[]): string[] => {
    let acc: string[][] = [[]];
    for (const d of dimsList || []) {
      const next: string[][] = [];
      for (const prefix of acc) {
        for (const v of d.values || []) next.push([...prefix, v]);
      }
      acc = next;
    }
    return acc.map((c) => c.join(' × '));
  };

  const doGenerate = async () => {
    if (!skuSpu) return;
    setGenning(true);
    try {
      const response = await spuApi.generateSKUs(skuSpu.id, {
        sale_price: genForm.sale_price || undefined,
        purchase_price: genForm.purchase_price || undefined,
        skip_existing: genForm.skip_existing,
      });
      if (response.code === 0) {
        const r = response.data;
        message.success(`已生成 ${r?.created ?? 0} 个 SKU${(r?.skipped ?? 0) > 0 ? `，跳过 ${r?.skipped} 个已存在` : ''}`);
        setGenOpen(false);
        setGenForm({ sale_price: '', purchase_price: '', skip_existing: false });
        await openSkuManager(skuSpu);
      } else {
        message.error(response.message || '生成失败');
      }
    } catch (err: any) {
      message.error(err?.message || '生成失败，请稍后重试');
    } finally {
      setGenning(false);
    }
  };

  const catOptions = buildCategoryOptions(categories);
  const unitNameOf = (id?: string | null) => units.find((u) => u.id === id)?.name || '';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Spu) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_C = 'px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-3';
  const rowCols: RowCol[] = [
    { key: 'code', header: '编号', cell: (spu) => <span className="text-sm font-mono text-gray-800">{spu.code}</span> },
    { key: 'name', header: '名称', cell: (spu) => <span className="text-sm font-medium text-gray-900">{spu.name}</span> },
    {
      key: 'dims',
      header: '规格维度',
      headCls: TH_C,
      cellCls: `${TD} text-center`,
      cell: (spu) => (
        <span className="text-sm text-gray-500">
          {(spu.dims || []).map((d) => `${d.name}[${(d.values || []).join('、')}]`).join(' × ') || '-'}
        </span>
      ),
    },
    { key: 'sku_count', header: 'SKU数', headCls: TH_C, cellCls: `${TD} text-center`, cell: (spu) => <span className="text-sm text-gray-800">{spu.sku_count ?? '-'}</span> },
    {
      key: 'status',
      header: '状态',
      headCls: TH_C,
      cellCls: `${TD} text-center`,
      cell: (spu) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${spu.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {statusText(spu.status)}
        </span>
      ),
    },
    { key: 'updated_at', header: '更新时间', cell: (spu) => <span className="text-sm text-gray-500">{format.date(spu.updated_at, 'YYYY-MM-DD HH:mm') || '-'}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (spu) => (
        <RowActions
          actions={[
            {
              key: 'skus',
              label: '管理 SKU',
              title: '管理 SKU（查看/按规格维度批量生成）',
              icon: <Layers className="w-4 h-4" />,
              onClick: () => openSkuManager(spu),
            },
            { key: 'edit', label: '编辑多规格商品', icon: <Edit className="w-4 h-4" />, onClick: () => openEdit(spu) },
            {
              key: 'del',
              label: '删除多规格商品',
              icon: <Trash2 className="w-4 h-4" />,
              danger: true,
              onClick: () => handleDelete(spu),
            },
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'spu-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="多规格商品"
        subtitle="同一商品的多规格/多型号归为一个「多规格商品」：其下每个 SKU 是一条商品，独立编码/价格/库存/条码——适配服装、电子等各行业"
        extra={
          <>
            {hasPermissionNow(PERM_IMPORT_EXPORT) && has('spu_create') && has('spu_generate_skus') && (
              <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-2" title="批量导入 SKU（CSV/Excel）">
                <Upload className="w-4 h-4" />
                <span>导入 SKU</span>
              </button>
            )}
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span>新增多规格商品</span>
            </button>
          </>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="form-input pl-9"
              placeholder="搜索编号 / 名称"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
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
                <tr>
                  <td colSpan={visibleColumns.length} className="px-6 py-4">
                    <TableSkeleton rows={5} />
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-6 py-10">
                    <ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无多规格商品" description="点击右上角「新增多规格商品」建档，再按需配置规格维度（如 颜色×尺码、容量、电压、型号）批量生成 SKU" />
                  </td>
                </tr>
              ) : (
                list.map((spu) => (
                  <tr key={spu.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(spu)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={pagination.page}
          pageSize={pagination.page_size}
          total={pagination.total}
          onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
          onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
        />
      </div>

      {/* ── 建档/编辑弹窗 ── */}
      <Modal
        title={editing ? `编辑多规格商品 ${editing.code}` : '新增多规格商品'}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={submitEditor}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={720}
        destroyOnHidden
      >
        <div className="py-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                编号 {editing ? '' : <span className="text-xs text-gray-400">（留空自动生成）</span>}
              </label>
              <input
                className="form-input"
                value={form.code}
                disabled={!!editing}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="如：MCB-2026"
               autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">名称 *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="如：一体式快充数据线（写产品通用名）"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
              <select className="form-select" value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                <option value="">请选择</option>
                {catOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">单位</label>
              <select className="form-select" value={form.unit_id} onChange={(e) => setForm((f) => ({ ...f, unit_id: e.target.value }))}>
                <option value="">请选择</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
              <select className="form-select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
            <textarea className="form-input" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700">规格维度（可自由定义：颜色/尺码、容量、电压、型号、配置…）</h4>
              <button
                type="button"
                className="btn-secondary text-sm flex items-center gap-1 !py-1"
                onClick={() => setDims((d) => [...d, { code: '', name: '', valuesText: '' }])}
              >
                <Plus className="w-3.5 h-3.5" /> 添加维度
              </button>
            </div>
            <div className="text-xs text-gray-400 mb-2">
              每填一组「维度 + 选项值」，系统自动把各维度交叉组合成 SKU。例：颜色[白、紫]×尺码[S、M、L]→6 个；容量[100W、200W]×长度[1m、2m]→4 个
            </div>
            <div className="space-y-2">
              {dims.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 bg-gray-50 rounded-lg p-2">
                  <input
                    className="form-input !w-28"
                    placeholder="编码（英文）如 color/capacity"
                    value={row.code}
                    onChange={(e) => setDims((d) => d.map((r, j) => (j === i ? { ...r, code: e.target.value } : r)))}
                   autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                  <input
                    className="form-input !w-24"
                    placeholder="名称 如 容量/型号"
                    value={row.name}
                    onChange={(e) => setDims((d) => d.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                  />
                  <input
                    className="form-input flex-1 min-w-[180px]"
                    placeholder="选项值，逗号分隔，如 1m,2m"
                    value={row.valuesText}
                    onChange={(e) => setDims((d) => d.map((r, j) => (j === i ? { ...r, valuesText: e.target.value } : r)))}
                  />
                  <button
                    type="button"
                    className="p-1.5 text-red-400 hover:text-red-600 rounded transition-colors"
                    title="移除维度"
                    onClick={() => setDims((d) => d.filter((_, j) => j !== i))}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {dims.length === 0 && (
                <div className="text-sm text-gray-400 py-2 text-center bg-gray-50 rounded-lg">未配置维度时，生成 1 个标准 SKU</div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* ── SKU 管理弹窗 ── */}
      <Modal
        title={
          skuSpu ? (
            <span>
              SKU 管理：{skuSpu.name}
              <span className="ml-2 font-mono text-gray-400 text-sm">{skuSpu.code}</span>
            </span>
          ) : (
            'SKU 管理'
          )
        }
        open={!!skuSpu}
        onCancel={() => setSkuSpu(null)}
        footer={null}
        width={960}
        destroyOnHidden
      >
        {skuSpu && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 bg-blue-50/60 border border-blue-100 rounded-lg p-3">
              <div className="text-sm text-gray-700 flex-1 min-w-[200px]">
                规格维度：{(skuSpu.dims || []).map((d) => `${d.name}[${(d.values || []).join('、')}]`).join(' × ') || '无（单SKU）'}
                {skuSpu.category_id || skuSpu.unit_id ? (
                  <span className="text-gray-400 ml-2">
                    {catOptions.find((o) => o.value === skuSpu.category_id)?.label || ''}
                    {skuSpu.unit_id ? ` / ${unitNameOf(skuSpu.unit_id)}` : ''}
                  </span>
                ) : null}
              </div>
              <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => setGenOpen(true)}>
                <Plus className="w-4 h-4" /> 生成 SKU
              </button>
              <button
                type="button"
                className="btn-secondary text-sm flex items-center gap-1.5"
                onClick={() => navigate('/products/create')}
              >
                <Plus className="w-4 h-4" /> 单独新增商品
              </button>
            </div>

            {skuLoading ? (
              <TableSkeleton rows={5} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU编码</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">规格（维度组合）</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">条码</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">进价</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">售价</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(skuSpu.edges?.products || []).length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-gray-500 text-sm">
                          还没有 SKU：点「生成 SKU」按已配置规格维度自动组合创建；也可「单独新增商品」后再归属到本多规格商品。
                        </td>
                      </tr>
                    ) : (
                      (skuSpu.edges?.products || []).map((p) => (
                        <tr key={p.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-mono text-gray-800">{p.code}</td>
                          <td className="px-4 py-3 text-center text-sm text-gray-800">{p.spec || '标准'}</td>
                          <td className="px-4 py-3 text-sm font-mono text-gray-500">{p.barcode || '-'}</td>
                          <td className="px-4 py-3 text-right text-sm text-gray-600">{p.purchase_price != null ? format.currency(p.purchase_price) : '-'}</td>
                          <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{p.sale_price != null ? format.currency(p.sale_price) : '-'}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {statusText(p.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              className="text-blue-600 hover:underline text-sm"
                              onClick={() => navigate(`/products/${p.id}/edit`)}
                            >
                              编辑商品（改价格/库存）
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-gray-400">
              每个 SKU 就是一条商品：可分别入库/出库/盘点、单独设置价格库存条码；商城按规格（颜色/型号/容量…）选择后精确到对应 SKU 下单。
            </p>
          </div>
        )}
      </Modal>

      {/* ── 生成 SKU 弹窗 ── */}
      <Modal
        title="批量生成 SKU（按规格维度组合）"
        open={genOpen}
        onCancel={() => setGenOpen(false)}
        onOk={doGenerate}
        okText="开始生成"
        cancelText="取消"
        confirmLoading={genning}
        width={560}
        destroyOnHidden
      >
        {skuSpu && (
          <div className="py-2 space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 space-y-1">
              <div>
                多规格商品：{skuSpu.name}（{skuSpu.code}）
              </div>
              <div className="text-gray-500">
                将生成 {combosOf(skuSpu.dims || []).length} 个 SKU：
                <span className="font-medium text-gray-700">{combosOf(skuSpu.dims || []).join('、')}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">默认售价（可后改）</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-input"
                  value={genForm.sale_price}
                  onChange={(e) => setGenForm((f) => ({ ...f, sale_price: e.target.value }))}
                  placeholder="如：1280"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">默认进价（可后改）</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-input"
                  value={genForm.purchase_price}
                  onChange={(e) => setGenForm((f) => ({ ...f, purchase_price: e.target.value }))}
                  placeholder="如：600"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 accent-blue-600"
                checked={genForm.skip_existing}
                onChange={(e) => setGenForm((f) => ({ ...f, skip_existing: e.target.checked }))}
              />
              已存在的规格组合自动跳过（不勾选则重复组合会报错）
            </label>
            <p className="text-xs text-gray-400">
              每个 SKU 自动获得：编码=编号-序号、规格=各维度值（如 颜色/容量/型号）、图片=多规格商品图；生成后可进入每个 SKU 单独设置条码/价格/库存。
            </p>
          </div>
        )}
      </Modal>

      {/* SKU 批量导入（2026-09-19 通用多规格）：一行一个 SKU；「款名」与「SKU编码」之间的列均为规格维度，可任意增删改名 */}
      <ImportModal
        open={importOpen}
        title="批量导入 SKU（款 + 规格，CSV / Excel）"
        importUrl="/v1/import/skus"
        templateUrl="/v1/export/skus-template"
        templateUrlXlsx="/v1/export/skus-template?format=xlsx"
        templateHint="款号, 款名, 颜色, 尺码, SKU编码, 条形码, 销售价, 采购价, 安全库存, 单位名称, 分类名称, 是否批次, 保质期(天), 备注"
        hintExtra="一行一个 SKU；「款名」与「SKU编码」之间的列都是规格维度——换成你的维度名（如 型号/配置/容量），可增删列；款号不存在会自动建款；SKU编码留空自动生成（款号-01）。预览不会写入数据。"
        duplicateStrategy
        onClose={() => setImportOpen(false)}
        onSuccess={fetchList}
      />
    </div>
  );
}
