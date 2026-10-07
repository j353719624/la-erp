import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowDown, Save, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { templateApi, entityApi } from '@/api/metadata';
import { Entity } from '@/types/metadata';
import { FIELD_TYPE_LABELS, TEMPLATE_CATEGORIES, getTemplateByIcon, ICON_TEMPLATE_NAMES } from '@/config/industryTemplates';

export function IndustryTemplateForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState({
    id: '',
    category: '',
    name: '',
    description: '',
    icon: '📋',
    entity_code: 'product',
    fields: [] as any[],
    categories: [] as any[],
    units: [] as any[],
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSystem, setIsSystem] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);

  useEffect(() => {
    entityApi.list({ page: 1, page_size: 1000 }).then(res => {
      if (res.code === 0) setEntities(res.data?.list ?? []);
    });
  }, []);

  useEffect(() => {
    if (isEdit && id) {
      fetchTemplate(id);
    }
  }, [id]);

  const fetchTemplate = async (templateId: string) => {
    setLoading(true);
    try {
      const response = await templateApi.get(templateId);
      if (response.code === 0) {
        const data = response.data;
        const templateFields = data.fields || data.edges?.fields || [];
        setFormData({
          id: data.id,
          category: data.category,
          name: data.name,
          description: data.description || '',
          icon: data.icon || '📋',
          entity_code: data.entity_code,
          fields: templateFields.map((f: any) => ({
            code: f.code,
            name: f.name,
            field_type: f.field_type,
            is_required: f.is_required,
            is_indexed: f.is_indexed,
            is_unique: f.is_unique,
            default_value: f.default_value || '',
            group_name: f.group_name || '',
            sort_order: f.sort_order || 0,
            options: Array.isArray(f.options) ? f.options : [],
          })) || [],
          categories: Array.isArray(data.categories) ? data.categories : [],
          units: Array.isArray(data.units) ? data.units : [],
        });
        setIsSystem(data.is_system || false);
      }
    } catch (err: any) {
      setError(err.message || '获取模板失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFieldChange = (index: number, field: string, value: any) => {
    setFormData(prev => {
      const fields = [...prev.fields];
      fields[index] = { ...fields[index], [field]: value };
      return { ...prev, fields };
    });
  };

  const addField = () => {
    setFormData(prev => ({
      ...prev,
      fields: [...prev.fields, {
        code: '',
        name: '',
        field_type: 'string',
        is_required: false,
        is_indexed: false,
        is_unique: false,
        default_value: '',
        group_name: '',
        sort_order: prev.fields.length + 1,
        options: [] as string[],
      }],
    }));
  };

  const addCategory = () => {
    setFormData(prev => ({
      ...prev,
      categories: [...prev.categories, { name: '', children: [] as string[] }],
    }));
  };

  const removeCategory = (index: number) => {
    setFormData(prev => ({
      ...prev,
      categories: prev.categories.filter((_, i) => i !== index),
    }));
  };

  const handleCategoryChange = (index: number, field: 'name' | 'children', value: string) => {
    setFormData(prev => {
      const categories = [...prev.categories];
      categories[index] = {
        ...categories[index],
        [field]: field === 'children'
          ? value.split(/[,，]/).map(s => s.trim()).filter(Boolean)
          : value,
        // 暂存子分类原始编辑文本（含逗号），避免受控组件实时 split→join 吞掉逗号
        ...(field === 'children' ? { children_input: value } : {}),
      };
      return { ...prev, categories };
    });
  };

  const addUnit = () => {
    setFormData(prev => ({
      ...prev,
      units: [...prev.units, { name: '', is_base: false }],
    }));
  };

  const removeUnit = (index: number) => {
    setFormData(prev => ({
      ...prev,
      units: prev.units.filter((_, i) => i !== index),
    }));
  };

  const handleUnitChange = (index: number, field: 'name' | 'is_base', value: any) => {
    setFormData(prev => {
      const units = [...prev.units];
      units[index] = { ...units[index], [field]: value };
      return { ...prev, units };
    });
  };

  const handleFieldOptionsChange = (index: number, value: string) => {
    const options = value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    handleFieldChange(index, 'options', options);
    // 暂存原始编辑文本（含逗号）：输入框显示它而不是 options.join，
    // 否则受控组件会实时 split→join 把末尾逗号吞掉，无法正常输入逗号分隔的选项
    handleFieldChange(index, 'options_input', value);
  };

  const removeField = (index: number) => {
    setFormData(prev => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== index),
    }));
  };

  // 字段上移/下移：交换位置并同步 sort_order（-1 上移 / 1 下移）
  const moveField = (index: number, dir: -1 | 1) => {
    setFormData(prev => {
      const target = index + dir;
      if (target < 0 || target >= prev.fields.length) return prev;
      const fields = [...prev.fields];
      const tmp = fields[index];
      fields[index] = fields[target];
      fields[target] = tmp;
      // 按新顺序重排 sort_order（1 起）
      fields.forEach((f, i) => {
        if (f && typeof f === 'object') f.sort_order = i + 1;
      });
      return { ...prev, fields };
    });
  };

  const handleIconSelect = (icon: string) => {
    const template = getTemplateByIcon(icon, formData.category);
    if (template) {
      setFormData(prev => ({
        ...prev,
        icon,
        name: prev.name || template.name,
        description: prev.description || template.description,
        category: prev.category || template.category,
        fields: template.fields.map((f: any) => ({
          code: f.code,
          name: f.name,
          field_type: f.field_type,
          is_required: f.is_required,
          is_indexed: f.is_indexed,
          is_unique: f.is_unique,
          default_value: f.default_value || '',
          group_name: f.group_name || '',
          sort_order: f.sort_order || 0,
          options: Array.isArray(f.options) ? f.options : [],
        })),
        categories: Array.isArray(template.categories) ? template.categories : [],
        units: Array.isArray(template.units) ? template.units : [],
      }));
    } else {
      setFormData(prev => ({ ...prev, icon }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // 剥离前端暂存的 options_input（原始编辑文本），只提交 options 数组
      const cleanFields = formData.fields.map((f: any) => {
        const { options_input, ...rest } = f;
        return rest;
      });
      // 同理剥离子分类的 children_input
      const cleanCategories = formData.categories.map((c: any) => {
        const { children_input, ...rest } = c;
        return rest;
      });
      if (isEdit && id) {
        const response = await templateApi.update(id, {
          name: formData.name,
          description: formData.description,
          icon: formData.icon,
          fields: cleanFields,
          categories: cleanCategories,
          units: formData.units,
        });
        if (response.code === 0) {
          navigate('/metadata/templates');
        }
      } else {
        const response = await templateApi.create({
          ...formData,
          fields: cleanFields,
          categories: cleanCategories,
          is_system: false,
        });
        if (response.code === 0) {
          navigate('/metadata/templates');
        }
      }
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const iconOptions = ['📋', '💊', '🍞', '📱', '👕', '🧪', '⚙️', '🧱', '🪑', '🖨️', '🚗', '💄', '🛒', '📦', '🌐', '🚢', '🏭', '🏪', '🏥', '🏨', '🏬', '🤝'];

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑模板' : '新建模板'}
        subtitle={isEdit ? '修改模板信息和字段配置' : '创建自定义行业模板'}
        onBack={() => navigate('/metadata/templates')}
        backDisabled={loading}
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-red-50 border-red-200">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}

      {isSystem && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-yellow-50 border-yellow-200">
          <AlertCircle className="w-5 h-5 text-yellow-600" />
          <span className="text-sm text-yellow-700">这是系统内置模板，编辑后将创建副本</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">模板名称 *</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              className="form-input"
              placeholder="请输入模板名称"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类 *</label>
            <select
              name="category"
              value={formData.category}
              onChange={handleInputChange}
              className="form-select"
              required
            >
              <option value="">请选择分类</option>
              {TEMPLATE_CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>
                  {cat.icon} {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">图标</label>
            <div className="flex flex-wrap gap-2">
              {iconOptions.map(icon => {
                // 悬停提示：优先按当前分类精准匹配模板名，未匹配用图标→名称映射兜底
                const tpl = getTemplateByIcon(icon, formData.category);
                const tip = tpl?.name || ICON_TEMPLATE_NAMES[icon] || icon;
                return (
                  <button
                    key={icon}
                    type="button"
                    title={tip}
                    onClick={() => handleIconSelect(icon)}
                    className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all ${
                      formData.icon === icon
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 hover:bg-gray-200'
                    }`}
                  >
                    {icon}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-2">选择图标后将自动填充对应行业的标准字段</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">关联实体</label>
            <SearchSelect
              value={formData.entity_code}
              onChange={(v) => setFormData(prev => ({ ...prev, entity_code: v ?? '' }))}
              placeholder="请选择实体"
              disabled={isSystem && isEdit}
              options={entities.map(e => ({ value: e.code, label: `${e.name}（${e.code}）` }))}
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              className="form-input"
              placeholder="请输入模板描述"
              rows={2}
            />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800">字段配置</h3>
            <button
              type="button"
              onClick={addField}
              className="btn-secondary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              添加字段
            </button>
          </div>

          <div className="divide-y divide-gray-100">
            {formData.fields.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                暂无字段，请点击上方按钮添加
              </div>
            ) : (
              formData.fields.map((field, index) => (
                <div key={index} className="p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-sm font-medium text-gray-600">字段 {index + 1}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveField(index, -1)}
                        disabled={index === 0}
                        className="p-1 hover:bg-gray-100 text-gray-500 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title="上移"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(index, 1)}
                        disabled={index === formData.fields.length - 1}
                        className="p-1 hover:bg-gray-100 text-gray-500 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title="下移"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeField(index)}
                      className="ml-auto p-1 hover:bg-red-50 text-red-500 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">字段编码 *</label>
                      <input
                        type="text"
                        value={field.code}
                        onChange={(e) => handleFieldChange(index, 'code', e.target.value)}
                        className="form-input"
                        placeholder="如：batch_no"
                        required
                       autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">字段名称 *</label>
                      <input
                        type="text"
                        value={field.name}
                        onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
                        className="form-input"
                        placeholder="如：批号"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">字段类型 *</label>
                      <select
                        value={field.field_type}
                        onChange={(e) => handleFieldChange(index, 'field_type', e.target.value)}
                        className="form-select"
                      >
                        {Object.entries(FIELD_TYPE_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">分组名称</label>
                      <input
                        type="text"
                        value={field.group_name}
                        onChange={(e) => handleFieldChange(index, 'group_name', e.target.value)}
                        className="form-input"
                        placeholder="如：批次信息"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">排序</label>
                      <input
                        type="number"
                        value={field.sort_order}
                        onChange={(e) => handleFieldChange(index, 'sort_order', parseInt(e.target.value) || 0)}
                        className="form-input"
                        placeholder="请输入排序数字"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">默认值</label>
                      <input
                        type="text"
                        value={field.default_value}
                        onChange={(e) => handleFieldChange(index, 'default_value', e.target.value)}
                        className="form-input"
                        placeholder="请输入默认值"
                      />
                    </div>

                    {(field.field_type === 'select' || field.field_type === 'multiselect') && (
                      <div className="md:col-span-2 lg:col-span-3">
                        <label className="block text-sm font-medium text-gray-700 mb-1">下拉选项（逗号分隔）</label>
                        <input
                          type="text"
                          value={field.options_input ?? (field.options || []).join(', ')}
                          onChange={(e) => handleFieldOptionsChange(index, e.target.value)}
                          className="form-input"
                          placeholder="如：常温, 冷藏, 冷冻"
                        />
                        <p className="text-xs text-gray-500 mt-1">应用模板后选项会写入实体字段校验规则，表单以下拉框展示</p>
                      </div>
                    )}

                    <div className="flex items-center gap-4 lg:col-span-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.is_required}
                          onChange={(e) => handleFieldChange(index, 'is_required', e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-gray-700">必填</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.is_indexed}
                          onChange={(e) => handleFieldChange(index, 'is_indexed', e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-gray-700">索引</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.is_unique}
                          onChange={(e) => handleFieldChange(index, 'is_unique', e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-gray-700">唯一</span>
                      </label>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800">预定义商品分类</h3>
            <button
              type="button"
              onClick={addCategory}
              className="btn-secondary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              添加分类
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {formData.categories.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                暂无分类，应用模板时将自动创建到商品分类
              </div>
            ) : (
              formData.categories.map((cat, index) => (
                <div key={index} className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">分类名称 *</label>
                    <input
                      type="text"
                      value={cat.name}
                      onChange={(e) => handleCategoryChange(index, 'name', e.target.value)}
                      className="form-input"
                      placeholder="如：化学药品"
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">子分类（逗号分隔）</label>
                      <input
                        type="text"
                        value={cat.children_input ?? (cat.children || []).join(', ')}
                        onChange={(e) => handleCategoryChange(index, 'children', e.target.value)}
                        className="form-input"
                        placeholder="如：片剂, 胶囊剂"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCategory(index)}
                      className="p-2 hover:bg-red-50 text-red-500 rounded"
                      title="删除分类"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800">预定义单位</h3>
            <button
              type="button"
              onClick={addUnit}
              className="btn-secondary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              添加单位
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {formData.units.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                暂无单位，应用模板时将自动创建到单位库
              </div>
            ) : (
              formData.units.map((unit, index) => (
                <div key={index} className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">单位名称 *</label>
                    <input
                      type="text"
                      value={unit.name}
                      onChange={(e) => handleUnitChange(index, 'name', e.target.value)}
                      className="form-input"
                      placeholder="如：盒"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!unit.is_base}
                        onChange={(e) => handleUnitChange(index, 'is_base', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="text-sm text-gray-700">本位单位</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeUnit(index)}
                      className="ml-auto p-2 hover:bg-red-50 text-red-500 rounded"
                      title="删除单位"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="form-actions">
          <button type="button" onClick={() => navigate('/metadata/templates')} className="btn-secondary">
            取消
          </button>
          <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
            {loading ? (
              <>保存中...</>
            ) : (
              <>
                <Save className="w-4 h-4" />
                保存模板
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
