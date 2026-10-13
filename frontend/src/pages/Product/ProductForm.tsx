import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle, Plus, Trash2, Image as ImageIcon } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { http } from '@/utils/request';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { productApi, categoryApi, unitApi, unitConversionApi } from '@/api/product';
import { fieldApi, entityApi, templateApi } from '@/api/metadata';
import { Product, CategoryTreeNode, Unit, UnitConversion } from '@/types/product';
import { buildCategoryOptions } from '@/utils/categoryTree';
import { Field } from '@/types/metadata';
import { DynamicField } from '@/components/DynamicField';
import { DictSelect } from '@/components/DictSelect';
import { loadProductLayouts, PRODUCT_FORM_FIXED_CODES } from '@/utils/productLayout';
import type { FormSection } from '@/utils/productLayout';
import { mergeTemplateAndPoolFields } from '@/utils/fieldMerge';
import { pickFieldValue } from '@/utils/dimLabel';
import { allInvalid, failField, clearInvalid } from '@/utils/formErrors';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { loadOptions } from '@/utils/loadOptions';

export function ProductForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<Product>>({
    code: '',
    name: '',
    spec: '',
    barcode: '',
    category_id: '',
    unit_id: '',
    product_type: '',
    is_batch: false,
    is_serial: false,
    shelf_life_days: 0,
    safety_stock: 0,
    min_order_qty: 0,
    cost_method: 'weighted_avg',
    sale_price: 0,
    purchase_price: 0,
    image_url: '',
    images: [],
    description: '',
    status: 'active',
    remark: '',
    ext_fields: {},
  });

  const [categories, setCategories] = useState<CategoryTreeNode[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [customFields, setCustomFields] = useState<Field[]>([]);
  // [2026-09-16] 字段池是否已加载完（区分“加载中”与“确实没有自定义字段”，
  // 避免加载空窗被误读为“要先去选模板”）
  const [fieldsReady, setFieldsReady] = useState(false);
  // [布局] 商品默认 form 布局 sections（有则自定义字段区按此分组/排序）
  const [formSections, setFormSections] = useState<FormSection[]>([]);
  const [currentTemplate, setCurrentTemplate] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 提交校验失败时标红的字段（受控错误态：不必等失焦即可看到红框红字）
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // [易用性 P1] 录了一半误点侧边栏/刷新 → 先确认再离开（避免内容静默丢失）
  // [2026-09-13 审查修复] 原「内容判脏」编辑态回填后恒为 true（只是查看也被拦）→ 统一改交互判定
  const dirtyProduct = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirtyProduct);

  // 多计量单位换算（P1-1）：仅编辑模式可配置
  const [conversions, setConversions] = useState<UnitConversion[]>([]);
  const [newConvUnit, setNewConvUnit] = useState('');
  const [newConvRate, setNewConvRate] = useState('');

  useEffect(() => {
    fetchOptions();
    fetchCustomFields();
    fetchCurrentTemplate();
    if (isEdit && id) {
      fetchProduct(id);
      fetchConversions(id);
    }
  }, [id]);

  // [布局] 读取商品默认 form 布局（无权限/无布局静默 → 自定义字段区沿用模板分组）
  useEffect(() => {
    loadProductLayouts().then((data) => setFormSections(data.formSections));
  }, []);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前 Promise.all 一拒全空）
      const [catRes, unitRes] = await loadOptions([
        // 全量分类树（分页 list 只取前 10 条会漏项），选项带层级缩进
        categoryApi.tree('product'),
        unitApi.list({ page: 1, page_size: 1000 }),
      ], '商品表单');
      if (catRes?.code === 0) setCategories(Array.isArray(catRes.data) ? catRes.data : []);
      if (unitRes?.code === 0) setUnits(unitRes.data.list);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchCustomFields = async () => {
    try {
      const entityRes = await entityApi.getByCode('product');
      if (entityRes.code === 0) {
        const fieldsRes = await fieldApi.list(entityRes.data.id);
        if (fieldsRes.code === 0) {
          // 字段池只保留“真正的自定义字段”：排除核心字段（id/code/name/status/remark/时间戳）与
          // 顶部业务区已录入的固定码——否则会出现「ID*/编码*/名称*」重复必填，用户无从填写
          // （2026-09-11 易用性修复：此前未过滤，渲染与提交校验都被核心字段污染）
          setCustomFields(
            (fieldsRes.data || []).filter(
              (f: Field) => !f.is_core && !PRODUCT_FORM_FIXED_CODES.has(f.code),
            ),
          );
        }
      }
    } catch (err) {
      console.error('Failed to fetch custom fields:', err);
    } finally {
      setFieldsReady(true);
    }
  };

  const fetchTemplates = async () => {
    try {
      const response = await templateApi.list();
      if (response.code === 0) {
        const data: any = response.data;
        const list = Array.isArray(data) ? data : (data?.list || []);
        setTemplates(list.map((t: any) => ({
          ...t,
          fields: t.fields || t.edges?.fields || [],
        })));
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    }
  };

  const fetchCurrentTemplate = async () => {
    try {
      const response = await templateApi.getCurrent();
      if (response.code === 0 && response.data) {
        const template = response.data;
        setCurrentTemplate({
          ...template,
          fields: template.fields || template.edges?.fields || [],
        });
      }
    } catch (err) {
      console.error('Failed to fetch current template:', err);
    }
  };

  const fetchProduct = async (productId: string) => {
    setLoading(true);
    try {
      const response = await productApi.get(productId);
      if (response.code === 0) {
        const d = response.data;
        // 旧数据兼容：仅 image_url 时并入 images 便于统一管理
        if ((!d.images || d.images.length === 0) && d.image_url) {
          d.images = [d.image_url];
        }
        setFormData(d);
      }
    } catch (err) {
      console.error('Failed to fetch product:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCustomFieldChange = (code: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      ext_fields: {
        ...prev.ext_fields,
        [code]: value,
      },
    }));
  };

  // ---- 多计量单位换算（P1-1）----
  const fetchConversions = async (productId: string) => {
    try {
      const res = await unitConversionApi.list(productId);
      if (res.code === 0) setConversions(res.data || []);
    } catch (err) {
      console.error('Failed to fetch unit conversions:', err);
    }
  };

  const handleAddConversion = async () => {
    if (!id || !newConvUnit) {
      setError('请选择辅助单位');
      return;
    }
    const rate = parseFloat(newConvRate);
    if (!rate || rate <= 0) {
      setError('换算率必须大于 0');
      return;
    }
    try {
      const unit = units.find(u => u.id === newConvUnit);
      const res = await unitConversionApi.create(id, {
        unit_id: newConvUnit,
        unit_name: unit?.name || '',
        rate,
      });
      if (res.code === 0) {
        setNewConvUnit('');
        setNewConvRate('');
        setError('');
        await fetchConversions(id);
      } else {
        setError(res.message || '添加换算失败');
      }
    } catch (err: any) {
      setError(err.message || '添加换算失败');
    }
  };

  const handleRemoveConversion = async (convId: string) => {
    if (!id) return;
    try {
      await unitConversionApi.delete(id, convId);
      await fetchConversions(id);
    } catch (err: any) {
      setError(err.message || '删除换算失败');
    }
  };

  // 自定义字段仅当“当前已应用模板”属于 product 实体时才按模板字段叠加；
  // 若全局已应用的是 supplier/customer 等其他实体模板（如“供应商资质管理”），
  // 一律回退到 product 实体自身字段，避免把供应商字段错当商品字段渲染/保存。
  const productTemplate = useMemo(() => {
    if (!currentTemplate) return null;
    const ec = currentTemplate.entity_code || currentTemplate.entityCode || '';
    return ec === 'product' ? currentTemplate : null;
  }, [currentTemplate]);

  const filteredFields = useMemo(() => {
    if (!productTemplate) {
      return customFields;
    }
    const templateFields = productTemplate.fields.map((f: any) => ({
      id: f.id || '',
      code: f.code,
      name: f.name,
      field_type: f.field_type,
      is_required: f.is_required,
      is_indexed: f.is_indexed,
      is_unique: f.is_unique,
      default_value: f.default_value,
      group_name: f.group_name,
      sort_order: f.sort_order,
      options: f.options,
      validation: f.options ? { options: f.options } : {},
    }));
    // [2026-09-16 用户反馈修复] 模板字段 + 字段池中模板未收录的字段（如「视图 → 新建字段」新建的）——
    // 此前只取模板字段，导致新字段在表单/编辑页永远看不到（“视图改动后新增商品没有变化”）。
    // 同 code 冲突时保留模板版；额外字段排在模板字段之后。
    return mergeTemplateAndPoolFields(templateFields, customFields);
  }, [productTemplate, customFields]);

  const groupedFields = useMemo(() => {
    const groups: Record<string, Field[]> = {};
    filteredFields.forEach(field => {
      const groupName = field.group_name || '未分组';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(field);
    });
    return groups;
  }, [filteredFields]);

  // [布局] 商品默认 form 布局 sections 存在时：自定义字段区按 sections 分组/排序（保序）
  // 固定业务字段码（code/name/status…已在上方业务区录入）跳过；未收录的字段归「其他自定义字段」。
  // 仅当布局真正放入了“自定义类”字段码（非固定码且命中字段池）才启用，否则回退模板 group_name 分组，
  // 避免种子默认 form 布局（只含核心字段）把模板原有“生产信息/资质信息”等分组挤成一个大平铺。
  const layoutGroups = useMemo(() => {
    if (formSections.length === 0 || filteredFields.length === 0) return null;
    const poolCodes = new Set(filteredFields.map((f: any) => f.code));
    const hasCustomInSections = formSections.some((sec) =>
      (sec.fields || []).some((code) => !PRODUCT_FORM_FIXED_CODES.has(code) && poolCodes.has(code)),
    );
    if (!hasCustomInSections) return null;
    const groups: { title: string; fields: any[] }[] = [];
    const placed = new Set<string>();
    for (const sec of formSections) {
      const list: any[] = [];
      for (const code of sec.fields) {
        if (PRODUCT_FORM_FIXED_CODES.has(code)) continue;
        const f = filteredFields.find((x: any) => x.code === code);
        if (f && !placed.has(code)) {
          list.push(f);
          placed.add(code);
        }
      }
      if (list.length) groups.push({ title: sec.title || '未命名分组', fields: list });
    }
    const rest = filteredFields.filter((f: any) => !PRODUCT_FORM_FIXED_CODES.has(f.code) && !placed.has(f.code));
    if (rest.length) groups.push({ title: '其他自定义字段', fields: rest });
    return groups.length ? groups : null;
  }, [formSections, filteredFields]);

  // 展示分组：优先布局分组；否则回退模板 group_name 分组
  const displayGroups: { title: string; fields: any[] }[] | null = layoutGroups
    ? layoutGroups
    : (() => {
        const keys = Object.keys(groupedFields);
        if (keys.length === 0) return null;
        return keys.map((title) => ({ title, fields: groupedFields[title] }));
      })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // 统一校验（易用性：一次性列出全部缺项，滚动到第一个错误并聚焦；
    // 此前只校验分类/单位、依赖浏览器原生气泡，长表单底部点保存容易“点了没反应”）
    const rules = [
      { field: 'name', label: '商品名称', ok: (v: any) => !!String(v ?? '').trim() },
      { field: 'category_id', label: '商品分类', message: '请选择商品分类', ok: (v: any) => !!v },
      { field: 'unit_id', label: '计量单位', message: '请选择计量单位', ok: (v: any) => !!v },
      ...customFields
        .filter((f) => f.is_required)
        .map((f) => ({
          field: `ext_${f.code}`,
          label: f.name || f.code,
          value: (values: any) => (values.ext_fields || {})[f.code],
          ok: (v: any) => v !== undefined && v !== null && String(v).trim() !== '',
        })),
    ];
    const errors = allInvalid(rules, formData as Record<string, any>);
    if (errors.length > 0) {
      setError(failField(errors[0], errors, setInvalid));
      return;
    }
    setInvalid({});
    setLoading(true);
    try {
      if (isEdit && id) {
        const response = await productApi.update(id, formData);
        if (response.code === 0) {
          navigate('/products');
        }
      } else {
        const response = await productApi.create(formData);
        if (response.code === 0) {
          navigate('/products');
        }
      }
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : (type === 'number' ? parseFloat(value) || 0 : value),
    }));
  };

  // 多图上传：选择文件后逐个上传，URL 追加到 images 数组（第一张为主图）
  const handleImagesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        const res = await http.upload<{ url: string }>('/v1/upload/image', fd);
        if (res.code === 0 && res.data?.url) {
          urls.push(res.data.url);
        } else {
          message.error(res.message || '图片上传失败');
          break;
        }
      }
      if (urls.length > 0) {
        setFormData(p => ({ ...p, images: [...(p.images || []), ...urls] }));
        message.success(`已上传 ${urls.length} 张图片`);
      }
    } catch (err) {
message.error(err instanceof Error && err.message ? err.message : '图片上传失败，请稍后重试');
    } finally {
      setUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const removeImage = (url: string) => {
    setFormData(p => ({ ...p, images: (p.images || []).filter(u => u !== url) }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑商品' : '新增商品'}
        subtitle={isEdit ? '修改商品信息' : '创建新商品'}
        onBack={() => { if (confirmLeave()) navigate('/products'); }}
        backDisabled={loading}
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      <div className="card p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">商品编码</label>
                <input
                  type="text"
                  name="code"
                  value={formData.code || ''}
                  onChange={handleInputChange}
                  disabled={isEdit}
                  placeholder={isEdit ? '' : '留空自动生成'}
                  className="form-input"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
              </div>
              <div data-field="name">
                <label className="block text-sm font-medium text-gray-700 mb-2">商品名称 *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name || ''}
                  onChange={(e) => { handleInputChange(e); clearInvalid('name', setInvalid, invalid); }}
                  className={`form-input ${invalid.name ? 'border-red-400 focus:ring-red-200' : ''}`}
                  placeholder="请输入商品名称"
                />
                {invalid.name && <div className="mt-1 text-xs text-red-600">请填写商品名称</div>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">条形码</label>
                <input
                  type="text"
                  name="barcode"
                  value={formData.barcode || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="请输入条形码（支持任意自定义内容，如 ABC-001）"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">规格型号</label>
                <input
                  type="text"
                  name="spec"
                  value={formData.spec || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="请输入规格型号"
                />
              </div>
              <div data-field="category_id">
                <label className="block text-sm font-medium text-gray-700 mb-2">商品分类 *</label>
                <SearchSelect
                  value={formData.category_id}
                  onChange={(v) => { setFormData(prev => ({ ...prev, category_id: v ?? '' })); clearInvalid('category_id', setInvalid, invalid); }}
                  placeholder="请选择分类"
                  required
                  invalid={!!invalid.category_id}
                  requiredMessage="请选择商品分类"
                  options={buildCategoryOptions(categories)}
                />
              </div>
              <div data-field="unit_id">
                <label className="block text-sm font-medium text-gray-700 mb-2">计量单位 *</label>
                <SearchSelect
                  value={formData.unit_id}
                  onChange={(v) => { setFormData(prev => ({ ...prev, unit_id: v ?? '' })); clearInvalid('unit_id', setInvalid, invalid); }}
                  placeholder="请选择单位"
                  required
                  invalid={!!invalid.unit_id}
                  requiredMessage="请选择计量单位"
                  options={units.map((unit) => ({ value: unit.id, label: unit.name }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">商品类型</label>
                {/* [S-05 2026-09-13] 选项来自数据字典 goods_type（系统管理 → 数据字典可增删），不再写死 */}
                <DictSelect
                  typeCode="goods_type"
                  value={formData.product_type}
                  onChange={(v) => setFormData(prev => ({ ...prev, product_type: v ?? '' }))}
                  placeholder="请选择类型"
                  className="w-full"
                  fallbackOptions={[
                    { value: 'goods', label: '普通商品' },
                    { value: 'finished', label: '成品' },
                    { value: 'semi_finished', label: '半成品' },
                    { value: 'raw_material', label: '原材料' },
                    { value: 'service', label: '服务' },
                  ]}
                />
                <p className="text-xs text-gray-400 mt-1">批次/序列号管理请用下方独立开关</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">成本核算方法</label>
                <select
                  name="cost_method"
                  value={formData.cost_method === 'average' ? 'weighted_avg' : (formData.cost_method || 'weighted_avg')}
                  onChange={handleInputChange}
                  className="form-select"
                >
                  <option value="fifo">先进先出(FIFO)</option>
                  <option value="lifo">后进先出(LIFO)</option>
                  <option value="weighted_avg">移动平均</option>
                  <option value="standard">标准成本</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
                <select
                  name="status"
                  value={formData.status || 'active'}
                  onChange={handleInputChange}
                  className="form-select"
                >
                  <option value="active">启用</option>
                  <option value="inactive">停用</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">销售单价</label>
                <input
                  type="number"
                  step="any"
                  name="sale_price"
                  value={formData.sale_price || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">采购单价</label>
                <input
                  type="number"
                  step="any"
                  name="purchase_price"
                  value={formData.purchase_price || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">安全库存</label>
                <input
                  type="number"
                  step="any"
                  name="safety_stock"
                  value={formData.safety_stock || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">最小订货批量</label>
                <input
                  type="number"
                  step="any"
                  name="min_order_qty"
                  value={formData.min_order_qty || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="0（MRP 建议量向上取整至此倍数）"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">保质期(天)</label>
                <input
                  type="number"
                  step="any"
                  name="shelf_life_days"
                  value={formData.shelf_life_days || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="0"
                />
              </div>
              <div className="flex items-center mt-6">
                <input
                  type="checkbox"
                  name="is_batch"
                  id="is_batch"
                  checked={formData.is_batch || false}
                  onChange={handleInputChange}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="is_batch" className="ml-2 text-sm font-medium text-gray-700">批次管理</label>
              </div>
              <div className="flex items-center mt-6">
                <input
                  type="checkbox"
                  name="is_serial"
                  id="is_serial"
                  checked={formData.is_serial || false}
                  onChange={handleInputChange}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="is_serial" className="ml-2 text-sm font-medium text-gray-700">序列号管理</label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">商品图片（可多张，第一张为商城主图）</label>
                <div className="flex flex-wrap items-start gap-3">
                  {(formData.images || []).map((url, idx) => (
                    <div key={url} className="relative w-20 h-20 group">
                      <img
                        src={url}
                        alt={`商品图${idx + 1}`}
                        className="w-full h-full object-cover rounded-lg border border-gray-200"
                      />
                      {idx === 0 && (
                        <span className="absolute top-0 left-0 bg-teal-600 text-white text-[10px] px-1.5 py-0.5 rounded-tl-lg">主图</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImage(url)}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow"
                        title="删除该图片"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={uploading}
                    className="w-20 h-20 border-2 border-dashed border-gray-300 hover:border-blue-400 hover:text-blue-500 rounded-lg flex flex-col items-center justify-center text-gray-400 transition-colors disabled:opacity-50"
                    title="上传图片"
                  >
                    {uploading ? (
                      <span className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <ImageIcon className="w-5 h-5" />
                    )}
                    <span className="text-[10px] mt-1">{uploading ? '上传中' : '上传图片'}</span>
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImagesChange}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  支持 jpg/jpeg/png/gif/webp/bmp，每张不超过 10MB；第一张为商城主图（客户自助下单页展示）。
                </p>
              </div>
            </div>

            {/* [2026-09-16] 商品描述 + 备注左右并排（用户反馈：两框各占整行太高，把自定义字段挤出首屏） */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  商品描述
                  <span className="text-gray-400 text-xs font-normal ml-1">
                    （客户门户/商城详情页展示文案；内部批注请填右侧“备注”）
                  </span>
                </label>
                <textarea
                  name="description"
                  value={formData.description || ''}
                  onChange={handleInputChange}
                  rows={3}
                  className="form-input"
                  placeholder="如：A4 黑白激光打印/复印/扫描一体机，月打印负荷 8000 页，支持无线网络连接……"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
                <textarea
                  name="remark"
                  value={formData.remark || ''}
                  onChange={handleInputChange}
                  rows={3}
                  className="form-input"
                  placeholder="请输入备注信息"
                />
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">自定义字段</h3>
                <div className="flex items-center gap-2">
                  {productTemplate ? (
                    <span className="inline-flex items-center px-3 py-1.5 bg-blue-50 text-blue-700 text-sm font-medium rounded-full">
                      <span className="text-lg mr-1">{productTemplate.icon}</span>
                      当前模板：{productTemplate.name}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500">未设置商品行业模板</span>
                  )}
                </div>
              </div>

              {displayGroups ? (
                displayGroups.map(({ title, fields }) => (
                  <div key={title} className="mb-6">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">{title}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {fields.map((field) => (
                        <div key={field.id || field.code} data-field={`ext_${field.code}`}>
                          <DynamicField
                            field={field}
                            value={pickFieldValue(formData.ext_fields as Record<string, any>, field.code)}
                            onChange={handleCustomFieldChange}
                            disabled={loading}
                          />
                          {invalid[`ext_${field.code}`] && <div className="mt-1 text-xs text-red-600">请填写{field.name || field.code}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  {fieldsReady
                    ? '暂无自定义字段；可在商品列表「视图 → 新建字段」或 元数据管理 → 字段管理 添加'
                    : '加载中…'}
                </div>
              )}
            </div>

            {isEdit && (
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-medium text-gray-700">多计量单位换算</h3>
                  <span className="text-xs text-gray-400">1 辅助单位 = 换算率 × 主单位（例：1箱=12瓶）</span>
                </div>
                <div className="p-4">
                  {conversions.length === 0 ? (
                    <div className="text-sm text-gray-400 mb-3">尚未配置辅助单位换算</div>
                  ) : (
                    <div className="overflow-x-auto mb-3">
                      <table className="w-full min-w-max">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">辅助单位</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">换算率</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">备注</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {conversions.map((c) => (
                            <tr key={c.id}>
                              <td className="px-4 py-2 text-sm text-gray-700">{c.unit_name || c.edges?.unit?.name || c.unit_id}</td>
                              <td className="px-4 py-2 text-right text-sm text-gray-700">{c.rate}</td>
                              <td className="px-4 py-2 text-sm text-gray-500">{c.remark || '-'}</td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveConversion(c.id)}
                                  className="icon-btn delete sm"
                                  title="删除换算"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">辅助单位</label>
                      <div className="w-48">
                        <SearchSelect
                          value={newConvUnit}
                          onChange={(v) => setNewConvUnit(v ?? '')}
                          placeholder="请选择单位"
                          options={units
                            .filter(u => u.id !== formData.unit_id)
                            .map((u) => ({ value: u.id, label: u.name }))}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">换算率（相对主单位）</label>
                      <input
                        type="number"
                        step="any"
                        min="0.0001"
                        value={newConvRate}
                        onChange={(e) => setNewConvRate(e.target.value)}
                        placeholder="如：12"
                        className="form-input w-32"
                      />
                    </div>
                    <button type="button" onClick={handleAddConversion} disabled={loading} className="btn-secondary text-sm flex items-center gap-1">
                      <Plus className="w-4 h-4" />
                      添加换算
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="form-actions">
              <button type="button" onClick={() => { if (confirmLeave()) navigate('/products'); }} disabled={loading} className="btn-secondary">取消</button>
              <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                <Save className="w-5 h-5" />
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
