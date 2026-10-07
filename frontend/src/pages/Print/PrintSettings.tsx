import { useState, useEffect, useCallback } from 'react';
import { Save, Plus, Copy, Trash2, Star, AlertCircle, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { confirmAction } from '@/utils/confirm';
import { printTemplateApi } from '@/api/print';
import { PrintTemplate, PrintColumn, PrintHeaderField } from '@/types/print';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { usePermission } from '@/hooks/usePermission';
import { builtinPrintColumnsFor, withBuiltinPrintColumns } from '@/utils/printColumns';

// 单据类型（与后端 seed 对齐，各板块打印设置互不影响）
const DOC_TYPES: { value: string; label: string }[] = [
  { value: 'sales_order', label: '销售订单' },
  { value: 'purchase_order', label: '采购订单' },
  { value: 'stock_in', label: '入库单' },
  { value: 'stock_out', label: '出库单' },
  { value: 'purchase_return', label: '采购退货单' },
  { value: 'sales_return', label: '销售退货单' },
  { value: 'work_order', label: '生产工单' },
  { value: 'production_picking', label: '生产领料单' },
  { value: 'production_receipt', label: '生产入库单' },
  { value: 'ar_invoice', label: '应收发票' },
  { value: 'ap_invoice', label: '应付发票' },
  { value: 'inventory_check', label: '库存盘点单' },
  { value: 'stock_transfer', label: '库存调拨单' },
  { value: 'sales_quotation', label: '销售报价单' },
  { value: 'expense_claim', label: '费用报销单' },
  { value: 'purchase_contract', label: '采购合同' },
  { value: 'payment_receipt', label: '收款单' },
  { value: 'payment_payment', label: '付款单' },
  { value: 'product_label', label: '商品标签' },
];

const PRINT_MODES = [
  { value: 'normal', label: '普通打印' },
  { value: 'label', label: '标签模式' },
  { value: 'overprint', label: '套打模式' },
];

const LABEL_FIELDS = [
  { value: 'product_name', label: '商品名称' },
  { value: 'product_code', label: '商品编码' },
  { value: 'spec', label: '规格型号' },
  { value: 'price', label: '价格' },
  { value: 'barcode', label: '条码' },
];

const PAPER_SIZES = [
  { value: 'A4', label: 'A4 (210×297mm)' },
  { value: 'A5', label: 'A5 (148×210mm)' },
  { value: 'Letter', label: 'Letter (215.9×279.4mm)' },
  { value: 'custom', label: '自定义' },
];

const ALIGNS = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];


const DEFAULT_HEADER_FIELDS: PrintHeaderField[] = [
  { key: 'doc_no', label: '单据编号', show: true },
  { key: 'doc_date', label: '单据日期', show: true },
  { key: 'party', label: '往来单位', show: true },
  { key: 'status', label: '状态', show: true },
];

// 头部信息项可选字段池（单据实际有值才会上纸；值不存在的字段自动不显示）
const HEADER_FIELD_POOL: { key: string; label: string }[] = [
  { key: 'doc_no', label: '单据编号' },
  { key: 'doc_date', label: '单据日期' },
  { key: 'party', label: '往来单位' },
  { key: 'status', label: '状态' },
  { key: 'currency', label: '币种' },
  { key: 'pay_type', label: '收款/付款方式' },
  { key: 'cash_account', label: '收/付款账户' },
];

function blankForm(docType: string): PrintTemplate {
  const isLabel = docType === 'product_label';
  const columns: PrintColumn[] = builtinPrintColumnsFor(docType).map(c => ({ ...c }));
  return {
    id: '', doc_type: docType, name: '', is_default: false, is_system: false,
    paper_size: isLabel ? 'A4' : 'A4', paper_width: 210, paper_height: 297,
    font_size: isLabel ? 20 : 14, title_size: 24, header_size: 14, row_height: 34,
    margin: isLabel ? 6 : 14,
    print_mode: isLabel ? 'label' : 'normal', show_border: true,
    label_per_row: 3, show_barcode: true, label_field: 'product_name', label_sub_field: 'spec',
    show_logo: !isLabel, show_company: !isLabel, show_status: !isLabel, show_totals: !isLabel,
    show_remark: !isLabel, show_signatures: !isLabel, footer_text: '',
    header_fields: DEFAULT_HEADER_FIELDS.map(h => ({ ...h })),
    columns,
  };
}

function PrintSettings() {
  // [2026-09-18 权限细化] 按钮级门控：新建·复制=print_template_create / 保存·设为默认=print_template_edit / 删除=print_template_delete
  const { has } = usePermission();
  const [activeType, setActiveType] = useState(DOC_TYPES[0].value);
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<PrintTemplate>(() => blankForm(DOC_TYPES[0].value));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [addHeaderKey, setAddHeaderKey] = useState('');
  // 请求竞态守卫：单据类型快速切换时丢弃过期模板，防 A 类型模板覆盖 B 类型
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchTemplates = useCallback(async (docType: string) => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    setError('');
    try {
      const res = await printTemplateApi.list(docType);
      if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
      const list: PrintTemplate[] = res.code === 0 && Array.isArray(res.data) ? res.data : [];
      setTemplates(list);
      const def = list.find(t => t.is_default) || list[0];
      if (def) {
        setSelectedId(def.id);
        setForm({ ...def, columns: withBuiltinPrintColumns(docType, def.columns || []), header_fields: def.header_fields || [] });
      } else {
        setSelectedId('');
        setForm(blankForm(docType));
      }
    } catch (e: any) {
      if (!isCurrent(seq)) return;
      setError(e?.message || '加载模板失败');
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [nextSeq, isCurrent]);

  useEffect(() => {
    fetchTemplates(activeType);
  }, [activeType, fetchTemplates]);

  const selectTemplate = (id: string) => {
    const t = templates.find(x => x.id === id);
    if (t) {
      setSelectedId(id);
      setForm({ ...t, columns: withBuiltinPrintColumns(activeType, t.columns || []), header_fields: t.header_fields || [] });
    }
  };

  const handleField = (field: string, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleHeaderField = (index: number, f: string, value: any) => {
    setForm(prev => {
      const header_fields = [...prev.header_fields];
      header_fields[index] = { ...header_fields[index], [f]: value };
      return { ...prev, header_fields };
    });
  };

  const handleColumn = (index: number, f: string, value: any) => {
    setForm(prev => {
      const columns = [...prev.columns];
      columns[index] = { ...columns[index], [f]: value };
      return { ...prev, columns };
    });
  };

  // 添加头部信息项（从字段池选；已存在的不重复添加）
  const addHeaderField = () => {
    const opt = HEADER_FIELD_POOL.find(x => x.key === addHeaderKey);
    if (!opt) return;
    setForm(prev => {
      if (prev.header_fields.some(h => h.key === opt.key)) return prev;
      return { ...prev, header_fields: [...prev.header_fields, { key: opt.key, label: opt.label, show: true }] };
    });
    setAddHeaderKey('');
  };

  const removeHeaderField = (index: number) => {
    setForm(prev => {
      const header_fields = prev.header_fields.filter((_, i) => i !== index);
      return { ...prev, header_fields };
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const payload = {
        name: form.name,
        is_default: form.is_default,
        paper_size: form.paper_size,
        paper_width: form.paper_width,
        paper_height: form.paper_height,
        font_size: form.font_size,
        title_size: form.title_size,
        header_size: form.header_size,
        row_height: form.row_height,
        margin: form.margin,
        print_mode: form.print_mode,
        show_border: form.show_border,
        label_per_row: form.label_per_row,
        show_barcode: form.show_barcode,
        label_field: form.label_field,
        label_sub_field: form.label_sub_field,
        show_logo: form.show_logo,
        show_company: form.show_company,
        show_status: form.show_status,
        show_totals: form.show_totals,
        show_remark: form.show_remark,
        show_signatures: form.show_signatures,
        footer_text: form.footer_text,
        header_fields: form.header_fields,
        columns: form.columns,
      };
      const res = selectedId
        ? await printTemplateApi.update(selectedId, payload)
        : await printTemplateApi.create({ ...payload, doc_type: activeType, name: form.name || `${activeType} 模板` });
      if (res.code === 0) {
        setOkMsg('保存成功');
        fetchTemplates(activeType);
      } else {
        setError(res.message || '保存失败');
      }
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const createNew = async () => {
    const res = await printTemplateApi.create({
      doc_type: activeType,
      name: `${activeType} 新模板`,
      is_default: false,
      ...blankForm(activeType),
    });
    if (res.code === 0) {
      setOkMsg('已创建新模板');
      fetchTemplates(activeType);
    } else {
      setError(res.message || '创建失败');
    }
  };

  const duplicate = async () => {
    if (!selectedId) return;
    const res = await printTemplateApi.duplicate(selectedId);
    if (res.code === 0) {
      setOkMsg('已复制模板');
      fetchTemplates(activeType);
    } else {
      setError(res.message || '复制失败');
    }
  };

  const remove = async () => {
    if (!selectedId) return;
    if (!(await confirmAction({ title: '确认删除该打印模板？', content: '删除后不可恢复', danger: true }))) return;
    const res = await printTemplateApi.remove(selectedId);
    if (res.code === 0) {
      setOkMsg('已删除模板');
      fetchTemplates(activeType);
    } else {
      setError(res.message || '删除失败');
    }
  };

  const setDefault = async () => {
    if (!selectedId) return;
    const res = await printTemplateApi.update(selectedId, { is_default: true });
    if (res.code === 0) {
      setOkMsg('已设为默认模板');
      fetchTemplates(activeType);
    } else {
      setError(res.message || '设置失败');
    }
  };

  const toggleSwitch = (label: string, field: string) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={!!(form as any)[field]}
        onChange={(e) => handleField(field, e.target.checked)}
        className="w-4 h-4 text-blue-600 rounded"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="打印设置"
        subtitle="统一打印接口：按单据板块独立配置纸张、字号、列宽与显示信息，各板块互不影响"
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-red-50 border-red-200">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}
      {okMsg && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-green-50 border-green-200">
          <AlertCircle className="w-5 h-5 text-green-600" />
          <span className="text-sm text-green-700">{okMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左侧：板块列表 */}
        <div className="card p-2 h-fit">
          <div className="px-3 py-2 text-sm font-semibold text-gray-500">单据板块</div>
          {DOC_TYPES.map(dt => (
            <button
              key={dt.value}
              onClick={() => setActiveType(dt.value)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                activeType === dt.value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {dt.label}
            </button>
          ))}
        </div>

        {/* 右侧：模板配置 */}
        <div className="lg:col-span-3 space-y-4">
          {/* 模板选择与操作 */}
          <div className="card p-4 flex flex-wrap items-center gap-3">
            <select
              value={selectedId}
              onChange={(e) => selectTemplate(e.target.value)}
              className="form-select max-w-xs"
              disabled={templates.length === 0}
            >
              {templates.length === 0 && <option value="">暂无模板</option>}
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.is_default ? '（默认）' : ''}
                </option>
              ))}
            </select>
            {has('print_template_create') && (
              <button onClick={createNew} className="btn-secondary flex items-center gap-2">
                <Plus className="w-4 h-4" />新建
              </button>
            )}
            {has('print_template_create') && (
              <button onClick={duplicate} disabled={!selectedId} className="btn-secondary flex items-center gap-2">
                <Copy className="w-4 h-4" />复制
              </button>
            )}
            {selectedId && has('print_template_edit') && (
              <button onClick={setDefault} className="btn-secondary flex items-center gap-2">
                <Star className="w-4 h-4" />设为默认
              </button>
            )}
            {selectedId && has('print_template_delete') && (
              <button onClick={remove} className="btn-secondary flex items-center gap-2 text-red-600">
                <Trash2 className="w-4 h-4" />删除
              </button>
            )}
            {loading && <Loader2 className="w-5 h-5 animate-spin text-blue-600" />}
          </div>

          {!loading && (
            <div className="card p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">模板名称</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => handleField('name', e.target.value)}
                    className="form-input"
                    placeholder="请输入模板名称"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">纸张大小</label>
                  <select
                    value={form.paper_size}
                    onChange={(e) => handleField('paper_size', e.target.value)}
                    className="form-select"
                  >
                    {PAPER_SIZES.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">宽(mm)</label>
                    <input
                      type="number"
                      value={form.paper_width}
                      onChange={(e) => handleField('paper_width', parseInt(e.target.value) || 0)}
                      className="form-input"
                      disabled={form.paper_size !== 'custom'}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">高(mm)</label>
                    <input
                      type="number"
                      value={form.paper_height}
                      onChange={(e) => handleField('paper_height', parseInt(e.target.value) || 0)}
                      className="form-input"
                      disabled={form.paper_size !== 'custom'}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">正文字号(px)</label>
                  <input
                    type="number"
                    value={form.font_size}
                    onChange={(e) => handleField('font_size', parseInt(e.target.value) || 14)}
                    className="form-input"
                    min={8}
                    max={40}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">标题字号(px)</label>
                  <input
                    type="number"
                    value={form.title_size}
                    onChange={(e) => handleField('title_size', parseInt(e.target.value) || 24)}
                    className="form-input"
                    min={12}
                    max={60}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">表头字号(px)</label>
                  <input
                    type="number"
                    value={form.header_size}
                    onChange={(e) => handleField('header_size', parseInt(e.target.value) || 14)}
                    className="form-input"
                    min={8}
                    max={30}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">明细行高(px)</label>
                  <input
                    type="number"
                    value={form.row_height}
                    onChange={(e) => handleField('row_height', parseInt(e.target.value) || 34)}
                    className="form-input"
                    min={20}
                    max={80}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">页边距(mm)</label>
                  <input
                    type="number"
                    value={form.margin}
                    onChange={(e) => handleField('margin', parseInt(e.target.value) || 14)}
                    className="form-input"
                    min={0}
                    max={40}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">打印模式</label>
                  <select
                    value={form.print_mode}
                    onChange={(e) => handleField('print_mode', e.target.value)}
                    className="form-select"
                  >
                    {PRINT_MODES.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">页脚文字</label>
                  <input
                    type="text"
                    value={form.footer_text || ''}
                    onChange={(e) => handleField('footer_text', e.target.value)}
                    className="form-input"
                    placeholder="留空则不显示页脚"
                  />
                </div>
              </div>

              {/* 显示开关 */}
              <div className="flex flex-wrap items-center gap-6">
                {toggleSwitch('公司抬头', 'show_company')}
                {toggleSwitch('Logo', 'show_logo')}
                {toggleSwitch('状态', 'show_status')}
                {toggleSwitch('合计', 'show_totals')}
                {toggleSwitch('备注', 'show_remark')}
                {toggleSwitch('签名区', 'show_signatures')}
                {toggleSwitch('表格边框', 'show_border')}
              </div>

              {/* 标签模式配置 */}
              {form.print_mode === 'label' && (
                <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-blue-800">标签配置（标签模式）</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">每行标签数</label>
                      <input
                        type="number"
                        value={form.label_per_row}
                        onChange={(e) => handleField('label_per_row', parseInt(e.target.value) || 2)}
                        className="form-input"
                        min={1}
                        max={6}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">主显示字段</label>
                      <select
                        value={form.label_field}
                        onChange={(e) => handleField('label_field', e.target.value)}
                        className="form-select"
                      >
                        {LABEL_FIELDS.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">副显示字段</label>
                      <select
                        value={form.label_sub_field}
                        onChange={(e) => handleField('label_sub_field', e.target.value)}
                        className="form-select"
                      >
                        {LABEL_FIELDS.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.show_barcode}
                          onChange={(e) => handleField('show_barcode', e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-gray-700">显示条码</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* 头部信息项 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">打印信息项（可增删，单据无值的不上纸）</h3>
                  <div className="flex items-center gap-2">
                    <select value={addHeaderKey} onChange={(e) => setAddHeaderKey(e.target.value)} className="form-select w-44">
                      <option value="">添加字段...</option>
                      {HEADER_FIELD_POOL.filter(x => !form.header_fields.some(h => h.key === x.key)).map(x => (
                        <option key={x.key} value={x.key}>{x.label}</option>
                      ))}
                    </select>
                    <button onClick={addHeaderField} disabled={!addHeaderKey} className="btn-secondary text-sm flex items-center gap-1">
                      <Plus className="w-4 h-4" />
                      添加
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {form.header_fields.map((hf, i) => (
                    <div key={hf.key} className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2">
                      <input
                        type="checkbox"
                        checked={hf.show}
                        onChange={(e) => handleHeaderField(i, 'show', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded"
                        title="是否上纸"
                      />
                      <span className="text-xs text-gray-400 w-16">{hf.key}</span>
                      <input
                        type="text"
                        value={hf.label}
                        onChange={(e) => handleHeaderField(i, 'label', e.target.value)}
                        className="form-input flex-1"
                        placeholder="请输入显示名称"
                      />
                      <button onClick={() => removeHeaderField(i)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="移除该信息项">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 明细列 */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">明细列（显隐/标题/列宽/对齐）</h3>
                <div className="space-y-2">
                  {form.columns.map((c, i) => (
                    <div key={c.key} className="flex flex-wrap items-center gap-2 border border-gray-200 rounded-lg px-3 py-2">
                      <input
                        type="checkbox"
                        checked={c.show}
                        onChange={(e) => handleColumn(i, 'show', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="text-xs text-gray-400 w-20">{c.key}</span>
                      <input
                        type="text"
                        value={c.label}
                        onChange={(e) => handleColumn(i, 'label', e.target.value)}
                        className="form-input w-28"
                        placeholder="请输入列标题"
                      />
                      <input
                        type="number"
                        value={c.width}
                        onChange={(e) => handleColumn(i, 'width', parseInt(e.target.value) || 60)}
                        className="form-input w-24"
                        placeholder="请输入宽度"
                        min={20}
                      />
                      <select
                        value={c.align}
                        onChange={(e) => handleColumn(i, 'align', e.target.value)}
                        className="form-select w-28"
                      >
                        {ALIGNS.map(a => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                {has('print_template_edit') && (
                  <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    保存模板
                  </button>
                )}
                <span className="text-xs text-gray-400">保存后对应板块打印立即按新配置生效</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { PrintSettings };
