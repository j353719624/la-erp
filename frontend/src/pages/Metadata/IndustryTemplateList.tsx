import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Database, Loader2, Edit2, Plus } from 'lucide-react';
import { TEMPLATE_CATEGORIES, FIELD_TYPE_LABELS, ICON_TEMPLATE_NAMES } from '@/config/industryTemplates';
import { entityApi, fieldApi, templateApi, layoutApi } from '@/api/metadata';
import { Field } from '@/types/metadata';
import { PageHeader } from '@/components/PageHeader';
import { usePermission } from '@/hooks/usePermission';

export function IndustryTemplateList() {
  // [2026-09-18 权限细化·第4批] 元数据管理四件套（旧码 system；应用/设当前模板=编辑）
  const { has } = usePermission();
  const navigate = useNavigate();
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['生产类', '商业类']);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [applying, setApplying] = useState(false);
  const [appliedResult, setAppliedResult] = useState<{ success: boolean; message: string } | null>(null);
  const [existingFields, setExistingFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentAppliedTemplate, setCurrentAppliedTemplate] = useState<any>(null);

  useEffect(() => {
    fetchTemplates();
    fetchCurrentAppliedTemplate();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentAppliedTemplate = async () => {
    try {
      const response = await templateApi.getCurrent();
      if (response.code === 0) {
        setCurrentAppliedTemplate(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch current applied template:', err);
    }
  };

  const toggleCategory = (category: string) => {
    if (expandedCategories.includes(category)) {
      setExpandedCategories(expandedCategories.filter(c => c !== category));
    } else {
      setExpandedCategories([...expandedCategories, category]);
    }
  };

  const handleSelectTemplate = async (template: any) => {
    setSelectedTemplate(template);
    setAppliedResult(null);
    try {
      const entityRes = await entityApi.getByCode(template.entity_code);
      if (entityRes.code === 0) {
        const fieldsRes = await fieldApi.list(entityRes.data.id);
        if (fieldsRes.code === 0) {
          setExistingFields(fieldsRes.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch existing fields:', err);
      setExistingFields([]);
    }
  };

  const handleApplyTemplate = async () => {
    if (!selectedTemplate) return;
    setApplying(true);
    setAppliedResult(null);
    try {
      const entityRes = await entityApi.getByCode(selectedTemplate.entity_code);
      if (entityRes.code !== 0) {
        throw new Error('无法获取实体信息');
      }

      const entityId = entityRes.data.id;
      const existingCodes = new Set(existingFields.map(f => f.code));
      const templateFields = selectedTemplate.fields || [];
      const newFields = templateFields.filter((f: any) => !existingCodes.has(f.code));

      if (newFields.length === 0) {
        setAppliedResult({ success: true, message: '模板中的字段已全部存在，无需重复添加（已同步列表布局）' });
        await ensureTemplateLayout(entityId, templateFields);
        setApplying(false);
        return;
      }

      const batchData = {
        entity_id: entityId,
        fields: newFields.map((f: any) => ({
          code: f.code,
          name: f.name,
          field_type: f.field_type,
          is_core: false,
          is_required: f.is_required,
          is_indexed: f.is_indexed,
          is_unique: f.is_unique,
          default_value: f.default_value || '',
          sort_order: f.sort_order,
          group_name: f.group_name,
          // select/multiselect 字段把模板下拉选项写入 validation.options，表单才能渲染选项
          ...(Array.isArray(f.options) && f.options.length ? { validation: { options: f.options } } : {}),
        })),
      };

      const response = await fieldApi.batch(batchData);
      if (response.code === 0) {
        const skipped = templateFields.length - newFields.length;
        setAppliedResult({
          success: true,
          message: `成功应用模板！新增 ${newFields.length} 个字段${skipped > 0 ? `，跳过 ${skipped} 个已存在字段` : ''}，并已同步列表布局`,
        });
        await ensureTemplateLayout(entityId, templateFields);
        const fieldsRes = await fieldApi.list(entityId);
        if (fieldsRes.code === 0) {
          setExistingFields(fieldsRes.data);
        }
      }
    } catch (err: any) {
      setAppliedResult({ success: false, message: err.message || '应用模板失败' });
    } finally {
      setApplying(false);
    }
  };

  const handleSetAsCurrentTemplate = async (templateId: string) => {
    try {
      const response = await templateApi.apply(templateId);
      if (response.code === 0) {
        setCurrentAppliedTemplate(response.data);
        setAppliedResult({ success: true, message: `成功设置"${selectedTemplate.name}"为当前系统模板` });
      }
    } catch (err: any) {
      setAppliedResult({ success: false, message: err.message || '设置模板失败' });
    }
  };

  const isFieldExists = (code: string) => existingFields.some(f => f.code === code);

  // 模板应用后：为实体生成/更新默认列表布局（列 = 用户现有列 + 核心列 + 模板字段，动态数据页按布局渲染）
  // 合并而非整体覆盖：保留用户已配置的列（含自定义字段/顺序），仅在尾部补齐缺失的核心列与模板字段，
  // 避免把用户精心配置的默认布局冲掉。
  const ensureTemplateLayout = async (entityId: string, tplFields: any[]) => {
    try {
      const fieldNames = new Map((existingFields || []).map((f: any) => [f.code, f.name || f.code]));
      const existing = await layoutApi.getDefault(entityId, 'list');
      const prevCols: any[] = existing?.data?.config?.table?.columns || [];
      const merged: any[] = [];
      const seen = new Set<string>();
      for (const c of prevCols) {
        if (c && c.field && !seen.has(c.field)) {
          seen.add(c.field);
          // 旧模板生成的核心列 label 是大写 code，回填为字段中文名
          merged.push({ ...c, label: (c.label && c.label !== c.field.toUpperCase()) ? c.label : (fieldNames.get(c.field) || c.field) });
        }
      }
      const pushMissing = (field: string, label: string, width: number) => {
        if (!seen.has(field)) {
          seen.add(field);
          merged.push({ field, label, width });
        }
      };
      ['code', 'name', 'status'].forEach(f => pushMissing(f, fieldNames.get(f) || f, 120));
      tplFields.forEach(f => pushMissing(f.code, f.name || f.code, 140));
      const prevSearch = existing?.data?.config?.header?.searchFields;
      const config = {
        table: { columns: merged },
        header: { searchFields: Array.isArray(prevSearch) && prevSearch.length ? prevSearch : ['name'] },
      };
      if (existing.code === 0 && existing.data) {
        await layoutApi.update(existing.data.id, { config });
      } else {
        await layoutApi.create({
          entity_id: entityId,
          name: '行业模板列表布局',
          layout_type: 'list',
          scope: 'system',
          is_default: true,
          config,
        });
      }
    } catch {
      // 布局生成失败不阻断字段应用
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="行业模板"
        subtitle="选择适合您行业的模板，一键配置商品自定义字段。应用后可继续添加自定义字段。"
        extra={
          has('metadata_create') && (
            <button
              onClick={() => navigate('/metadata/templates/create')}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建模板</span>
            </button>
          )
        }
      />

      {appliedResult && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border ${
          appliedResult.success
            ? 'bg-green-50 border-green-200'
            : 'bg-red-50 border-red-200'
        }`}>
          {appliedResult.success ? (
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-600" />
          )}
          <span className={`text-sm ${appliedResult.success ? 'text-green-700' : 'text-red-700'}`}>
            {appliedResult.message}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：模板列表 */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            TEMPLATE_CATEGORIES.map((cat) => {
              const catTemplates = templates.filter((t: any) => t.category === cat.value);
              const isExpanded = expandedCategories.includes(cat.value);

              return (
                <div key={cat.value} className="card overflow-hidden">
                  <button
                    onClick={() => toggleCategory(cat.value)}
                    className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-2xl">{cat.icon}</span>
                    <span className="text-lg font-semibold text-gray-800">{cat.label}</span>
                    <span className="text-sm text-gray-500">({catTemplates.length}个模板)</span>
                    <div className="ml-auto">
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 pt-0">
                      {catTemplates.map((template: any) => (
                        <div
                          key={template.id}
                          onClick={() => handleSelectTemplate(template)}
                          className={`p-4 rounded-xl border-2 cursor-pointer transition-all relative ${
                            selectedTemplate?.id === template.id
                              ? 'border-blue-500 bg-blue-50'
                              : currentAppliedTemplate?.id === template.id
                              ? 'border-green-500 bg-green-50'
                              : 'border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {currentAppliedTemplate?.id === template.id && (
                            <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                              当前应用
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/metadata/templates/${template.id}/edit`);
                            }}
                            className="absolute top-2 right-2 p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4 text-gray-500" />
                          </button>
                          <div className="flex items-start gap-3">
                            <span className="text-3xl" title={template.name}>{template.icon}</span>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-gray-800">{template.name}</h3>
                              <p className="text-sm text-gray-500 mt-1 line-clamp-2">{template.description}</p>
                              <div className="flex items-center gap-2 mt-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                  {(template.fields || []).length} 个字段
                                </span>
                                {currentAppliedTemplate?.id === template.id && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-600">
                                    ✓ 已应用
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 右侧：模板详情 */}
        <div className="lg:col-span-1">
          {selectedTemplate ? (
            <div className="card sticky top-6">
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <span className="text-3xl" title={selectedTemplate.name || ICON_TEMPLATE_NAMES[selectedTemplate.icon] || selectedTemplate.icon}>{selectedTemplate.icon}</span>
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">{selectedTemplate.name}</h2>
                    <p className="text-sm text-gray-500">{selectedTemplate.category}</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mt-3">{selectedTemplate.description}</p>
              </div>

              <div className="p-4 max-h-96 overflow-y-auto">
                {(selectedTemplate.categories && selectedTemplate.categories.length > 0) && (
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">预定义分类</h3>
                    <div className="space-y-2">
                      {(selectedTemplate.categories || []).map((cat: any, index: number) => (
                        <div key={index} className="px-3 py-2 bg-blue-50 rounded-lg">
                          <div className="text-sm font-medium text-gray-800">{cat.name}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {cat.children?.map((child: string, childIndex: number) => (
                              <span key={childIndex} className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                                {child}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(selectedTemplate.units && selectedTemplate.units.length > 0) && (
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">预定义单位</h3>
                    <div className="flex flex-wrap gap-2">
                      {(selectedTemplate.units || []).map((unit: any, index: number) => (
                        <span
                          key={index}
                          className={`text-sm px-3 py-1 rounded-lg ${
                            unit.is_base
                              ? 'bg-purple-100 text-purple-700 font-medium'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {unit.name}
                          {unit.is_base && <span className="ml-1 text-xs">★</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <h3 className="text-sm font-semibold text-gray-700 mb-3">包含字段</h3>
                <div className="space-y-2">
                  {(selectedTemplate.fields || []).map((field: any) => {
                    const exists = isFieldExists(field.code);
                    return (
                      <div
                        key={field.code}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                          exists ? 'bg-green-50' : 'bg-gray-50'
                        }`}
                      >
                        {exists && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">{field.name}</span>
                            {field.is_required && (
                              <span className="text-xs text-red-500">必填</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="font-mono">{field.code}</span>
                            <span>·</span>
                            <span>{FIELD_TYPE_LABELS[field.field_type] || field.field_type}</span>
                            <span>·</span>
                            <span>{field.group_name}</span>
                          </div>
                        </div>
                        {exists && (
                          <span className="text-xs text-green-600 font-medium">已存在</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 border-t border-gray-100 space-y-3">
                {currentAppliedTemplate?.id === selectedTemplate.id ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="text-sm font-medium text-green-700">此模板已设置为当前系统模板</span>
                  </div>
                ) : (
                  has('metadata_edit') && (
                    <button
                      onClick={() => handleSetAsCurrentTemplate(selectedTemplate.id)}
                      disabled={applying}
                      className="w-full btn-secondary flex items-center justify-center gap-2"
                    >
                      <Database className="w-5 h-5" />
                      设置为当前应用模板
                    </button>
                  )
                )}
                {has('metadata_edit') && (
                  <button
                    onClick={handleApplyTemplate}
                    disabled={applying}
                    className="w-full btn-primary flex items-center justify-center gap-2"
                  >
                    {applying ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        应用中...
                      </>
                    ) : (
                      <>
                        <Database className="w-5 h-5" />
                        应用模板（添加字段）
                      </>
                    )}
                  </button>
                )}
                <p className="text-xs text-gray-500 mt-2 text-center">
                  应用后会自动添加模板中的字段到商品实体
                </p>
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center">
              <Database className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-400">请从左侧选择一个行业模板查看详情</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
