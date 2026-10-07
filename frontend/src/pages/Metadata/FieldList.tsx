import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Plus, Edit2, Trash2, ArrowLeft, ArrowUp, ArrowDown, AlertCircle, Save, X } from 'lucide-react';
import { fieldApi, entityApi } from '@/api/metadata';
import { Field, CreateFieldInput, UpdateFieldInput } from '@/types/metadata';
import { Entity } from '@/types/metadata';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { RowActions } from '@/components/RowActions';
import { TableSkeleton } from '@/components/TableSkeleton';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { usePermission } from '@/hooks/usePermission';
import { FIELD_TYPES } from '@/utils/fieldTypes';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

export function FieldList() {
  // [2026-09-18 权限细化] 按钮级门控：新增=metadata_create / 上移·下移·编辑=metadata_edit / 删除=metadata_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { entityId } = useParams<{ entityId: string }>();
  const [fields, setFields] = useState<Field[]>([]);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState<CreateFieldInput>({
    entity_id: entityId || '',
    code: '',
    name: '',
    field_type: 'string',
    is_required: false,
    is_unique: false,
    is_indexed: true,
    is_core: false,
    sort_order: 0,
    group_name: '',
  });
  // 下拉/多选字段选项（value 存库；label 中文展示，留空=值）。仅 select/multiselect 使用
  const [selOptions, setSelOptions] = useState<{ value: string; label: string }[]>([]);
  // 请求竞态守卫：快速增删/排序连续刷新时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    if (entityId) {
      fetchEntity(entityId);
      fetchFields(entityId);
    }
  }, [entityId]);

  const fetchEntity = async (id: string) => {
    try {
      const response = await entityApi.get(id);
      if (response.code === 0) {
        setEntity(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch entity:', err);
    }
  };

  const fetchFields = async (entityId: string) => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const response = await fieldApi.list(entityId);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setFields(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch fields:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmAction({ title: '确定要删除该字段吗？', content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await fieldApi.delete(id);
      if (response.code === 0) {
        message.success('字段已删除');
        fetchFields(entityId!);
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete field:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // 字段上移/下移：与相邻字段交换 sort_order 并保存（dir: -1 上移 / 1 下移）
  const handleMoveField = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= fields.length) return;
    const cur = fields[index];
    const next = fields[target];
    // 以当前字段 sort_order 为基准，交换两者的 sort_order
    const curOrder = cur.sort_order;
    try {
      await fieldApi.update(cur.id, { sort_order: next.sort_order });
      await fieldApi.update(next.id, { sort_order: curOrder });
      message.success('排序已更新');
      fetchFields(entityId!);
    } catch (err: any) {
      message.error(err?.message || '排序失败');
    }
  };

  const handleAdd = () => {
    setEditingField(null);
    setFormData({
      entity_id: entityId || '',
      code: '',
      name: '',
      field_type: 'string',
      is_required: false,
      is_unique: false,
      is_indexed: true,
      is_core: false,
      sort_order: fields.length,
      group_name: '',
    });
    setSelOptions([]);
    setError('');
    setShowModal(true);
  };

  const handleEdit = (field: Field) => {
    setEditingField(field);
    setFormData({
      entity_id: field.entity_id,
      code: field.code,
      name: field.name,
      field_type: field.field_type,
      is_required: field.is_required,
      is_unique: field.is_unique,
      is_indexed: field.is_indexed,
      is_core: field.is_core,
      sort_order: field.sort_order,
      default_value: field.default_value,
      group_name: field.group_name,
    });
    // 回填已有选项（兼容 string[] 与 {value,label}[]）
    const raw: any[] = field.validation?.options || [];
    setSelOptions(raw.map(o => (typeof o === 'object' ? { value: String(o.value ?? ''), label: String(o.label ?? '') } : { value: String(o ?? ''), label: '' })));
    setError('');
    setShowModal(true);
  };

  // 组装下拉选项 validation（仅 select/multiselect；其余类型不设置）
  const buildValidation = (): Record<string, any> | undefined => {
    if (formData.field_type !== 'select' && formData.field_type !== 'multiselect') return undefined;
    const options = selOptions
      .map(o => ({ value: (o.value || '').trim(), label: ((o.label || '').trim() || (o.value || '').trim()) }))
      .filter(o => o.value);
    return { options };
  };

  const updateOption = (index: number, key: 'value' | 'label', value: string) => {
    setSelOptions(prev => prev.map((o, i) => (i === index ? { ...o, [key]: value } : o)));
  };
  const removeOption = (index: number) => {
    setSelOptions(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const validation = buildValidation();
    try {
      if (editingField) {
        const updateData: UpdateFieldInput = {
          name: formData.name,
          field_type: formData.field_type,
          is_required: formData.is_required,
          is_unique: formData.is_unique,
          is_indexed: formData.is_indexed,
          is_core: formData.is_core,
          sort_order: formData.sort_order,
          default_value: formData.default_value,
          group_name: formData.group_name,
        };
        if (validation !== undefined) updateData.validation = validation;
        const response = await fieldApi.update(editingField.id, updateData);
        if (response.code === 0) {
          setShowModal(false);
          fetchFields(entityId!);
        }
      } else {
        const createData: CreateFieldInput = { ...formData };
        if (validation !== undefined) createData.validation = validation;
        const response = await fieldApi.create(createData);
        if (response.code === 0) {
          setShowModal(false);
          fetchFields(entityId!);
        }
      }
    } catch (err: any) {
      setError(err.message || '保存失败');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Field, index: number) => ReactNode;
  }
  const TH = 'px-4 py-3 text-left text-sm font-semibold text-gray-600';
  const TD = 'px-4 py-3 text-sm';
  const rowCols: RowCol[] = [
    { key: 'code', header: '字段编码', cellCls: `${TD} text-gray-800 font-mono`, cell: (field) => <span>{field.code}</span> },
    { key: 'name', header: '字段名称', cellCls: `${TD} text-gray-800`, cell: (field) => <span>{field.name}</span> },
    { key: 'field_type', header: '字段类型', cellCls: `${TD} text-gray-600`, cell: (field) => <span>{FIELD_TYPES.find(t => t.value === field.field_type)?.label || field.field_type}</span> },
    {
      key: 'is_required',
      header: '必填',
      cell: (field) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${field.is_required ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
          {field.is_required ? '是' : '否'}
        </span>
      ),
    },
    {
      key: 'is_unique',
      header: '唯一',
      cell: (field) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${field.is_unique ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
          {field.is_unique ? '是' : '否'}
        </span>
      ),
    },
    {
      key: 'is_indexed',
      header: '可索引',
      cell: (field) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${field.is_indexed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
          {field.is_indexed ? '是' : '否'}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
      cell: (field, index) => (
        <RowActions
          actions={[
            // [2026-09-18 权限细化] 上移/下移/编辑=metadata_edit；删除=metadata_delete
            ...(has('metadata_edit')
              ? [
                  { key: 'up', label: '上移', icon: <ArrowUp className="w-4 h-4" />, disabled: index === 0, onClick: () => handleMoveField(index, -1) },
                  { key: 'down', label: '下移', icon: <ArrowDown className="w-4 h-4" />, disabled: index === fields.length - 1, onClick: () => handleMoveField(index, 1) },
                  { key: 'edit', label: '编辑', icon: <Edit2 className="w-4 h-4" />, onClick: () => handleEdit(field) },
                ]
              : []),
            ...(has('metadata_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(field.id) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'field-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/metadata/entities')} className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">字段管理</h1>
          <p className="text-gray-500 mt-1">
            {entity ? `管理「${entity.name}」的自定义字段` : '管理实体字段'}
          </p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <p className="text-sm text-gray-500">
            在下方可以添加自定义字段，例如：批号、有效期、产地等
          </p>
          <div className="flex items-center gap-2">
            {viewMenu}
            {has('metadata_create') && (
              <button onClick={handleAdd} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" />
                新增字段
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4 py-4">
                    <TableSkeleton rows={5} />
                  </td>
                </tr>
              ) : fields.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4 py-8 text-center text-gray-500">
                    暂无自定义字段，点击上方「新增字段」按钮添加
                  </td>
                </tr>
              ) : (
                fields.map((field, index) => (
                  <tr key={field.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(field, index)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-800">
                {editingField ? '编辑字段' : '新增字段'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg mx-4 mt-4">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <span className="text-red-700 text-sm">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">字段编码 *</label>
                  <input
                    type="text"
                    name="code"
                    value={formData.code}
                    onChange={handleInputChange}
                    required
                    disabled={!!editingField}
                    className={`form-input ${editingField ? 'bg-gray-100' : ''}`}
                    placeholder="如：batch_no"
                   autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">字段名称 *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                    className="form-input"
                    placeholder="如：批号"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">字段类型 *</label>
                  <select
                    name="field_type"
                    value={formData.field_type}
                    onChange={handleInputChange}
                    required
                    className="form-select"
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">分组名称</label>
                  <input
                    type="text"
                    name="group_name"
                    value={formData.group_name || ''}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="如：基本信息"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">排序</label>
                  <input
                    type="number"
                    name="sort_order"
                    value={formData.sort_order}
                    onChange={handleInputChange}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="is_core"
                    id="is_core"
                    checked={formData.is_core}
                    onChange={handleInputChange}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                  />
                  <label htmlFor="is_core" className="ml-2 text-sm font-medium text-gray-700">核心字段</label>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="is_required"
                    id="is_required"
                    checked={formData.is_required}
                    onChange={handleInputChange}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                  />
                  <label htmlFor="is_required" className="ml-2 text-sm font-medium text-gray-700">必填</label>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="is_unique"
                    id="is_unique"
                    checked={formData.is_unique}
                    onChange={handleInputChange}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                  />
                  <label htmlFor="is_unique" className="ml-2 text-sm font-medium text-gray-700">唯一</label>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="is_indexed"
                    id="is_indexed"
                    checked={formData.is_indexed}
                    onChange={handleInputChange}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                  />
                  <label htmlFor="is_indexed" className="ml-2 text-sm font-medium text-gray-700">可索引</label>
                </div>
              </div>

              {(formData.field_type === 'select' || formData.field_type === 'multiselect') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {formData.field_type === 'select' ? '下拉选项' : '多选选项'}
                    <span className="text-gray-400 font-normal text-xs ml-1">（选项值存库，显示名可为中文，留空=值）</span>
                  </label>
                  <div className="space-y-2">
                    {selOptions.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={opt.value}
                          onChange={e => updateOption(i, 'value', e.target.value)}
                          placeholder="选项值（如 red）"
                          className="form-input flex-1"
                        />
                        <input
                          type="text"
                          value={opt.label}
                          onChange={e => updateOption(i, 'label', e.target.value)}
                          placeholder="显示名（如 红色，留空=值）"
                          className="form-input flex-1"
                        />
                        <button type="button" onClick={() => removeOption(i)} className="p-2 text-red-400 hover:text-red-600 transition-colors" title="删除选项">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSelOptions(p => [...p, { value: '', label: '' }])}
                      className="btn-secondary text-sm flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" /> 添加选项
                    </button>
                    {selOptions.length === 0 && (
                      <p className="text-xs text-amber-600">未配置选项时，该字段在动态表单中按普通文本输入（不会出现下拉）</p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">默认值</label>
                <input
                  type="text"
                  name="default_value"
                  value={formData.default_value || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="请输入默认值"
                />
              </div>

              <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">取消</button>
                {/* [2026-09-18 权限细化] 弹窗保存：新增=metadata_create / 编辑=metadata_edit（与后端 POST/PUT 同码） */}
                {(editingField ? has('metadata_edit') : has('metadata_create')) && (
                  <button type="submit" className="btn-primary flex items-center gap-2">
                    <Save className="w-5 h-5" />
                    保存
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
