import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Save, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { productionApi } from '@/api/production';
import { productApi } from '@/api/product';
import { Routing, WorkCenter } from '@/types/production';
import { Product } from '@/types/product';
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';

interface RoutingStepRow {
  id?: string;
  sequence: number;
  process_code: string;
  process_name: string;
  work_center: string;
  work_center_id: string;
  // 标准/准备/收尾工时以字符串保留输入中间态（type=text inputMode=decimal），提交前 Number() 化
  standard_time: number | string;
  setup_time: number | string;
  teardown_time: number | string;
  remark: string;
}

export function RoutingForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<Routing>>({
    routing_code: '',
    routing_name: '',
    product_id: '',
    status: 'active',
    remark: '',
  });
  const [steps, setSteps] = useState<RoutingStepRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProducts();
    fetchWorkCenters();
    if (isEdit && id) {
      fetchRouting(id);
    }
  }, [id]);

  const fetchProducts = async () => {
    try {
      const response = await productApi.list({ page: 1, page_size: 1000, status: 'active' });
      if (response.code === 0) setProducts(response.data?.list || []);
    } catch (err) { console.error(err); }
  };

  const fetchWorkCenters = async () => {
    try {
      const response = await productionApi.workCenterList({ page: 1, page_size: 1000, status: 'active' });
      if (response.code === 0) setWorkCenters(response.data?.list || []);
    } catch (err) { console.error(err); }
  };

  const fetchRouting = async (routingId: string) => {
    setLoading(true);
    try {
      const response = await productionApi.getRouting(routingId);
      if (response.code === 0 && response.data) {
        const data = response.data;
        setFormData({
          id: data.id,
          routing_code: data.code,
          routing_name: data.name || '',
          product_id: data.product_id,
          status: data.status || 'active',
          remark: data.remark,
        });
        // 回填步骤（后端 GetByID 返回 edges.steps）
        const rawSteps: any[] = (data as any).edges?.steps || [];
        if (rawSteps.length > 0) {
          setSteps(rawSteps.map((s, i) => ({
            id: s.id,
            sequence: s.sequence || i + 1,
            process_code: s.process_code || '',
            process_name: s.process_name || '',
            work_center: s.work_center || '',
            work_center_id: s.work_center_id || '',
            standard_time: Number(s.standard_time) || 0,
            setup_time: Number(s.setup_time) || 0,
            teardown_time: Number(s.teardown_time) || 0,
            remark: s.remark || '',
          })));
        }
      }
    } catch (err) {
      console.error('Failed to fetch routing:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddStep = () => {
    setSteps(prev => [
      ...prev,
      { sequence: prev.length + 1, process_code: '', process_name: '', work_center: '', work_center_id: '', standard_time: 0, setup_time: 0, teardown_time: 0, remark: '' },
    ]);
  };

  const handleStepChange = (index: number, field: string, value: any) => {
    setSteps(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      if (field === 'work_center_id') {
        const wc = workCenters.find(w => w.id === value);
        next[index].work_center = wc?.name || '';
      }
      return next;
    });
  };

  const handleRemoveStep = (index: number) => {
    setSteps(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.routing_code || !formData.routing_name || !formData.product_id) {
      setError('工艺路线编号、名称与关联产品必填');
      return;
    }
    for (const [i, s] of steps.entries()) {
      if (!s.process_code || !s.process_name) {
        setError(`第 ${i + 1} 道工序缺少编码或名称`);
        return;
      }
    }
    setLoading(true);
    try {
      const product = products.find(p => p.id === formData.product_id);
      const submitData = {
        code: formData.routing_code,
        name: formData.routing_name,
        product_id: formData.product_id || undefined,
        product_name: product?.name || '',
        product_code: product?.code || '',
        remark: formData.remark,
        steps: steps.map(s => ({
          sequence: s.sequence,
          process_code: s.process_code,
          process_name: s.process_name,
          work_center: s.work_center,
          work_center_id: s.work_center_id || undefined,
          standard_time: Number(s.standard_time) || 0,
          setup_time: Number(s.setup_time) || 0,
          teardown_time: Number(s.teardown_time) || 0,
          remark: s.remark,
        })),
      };
      if (isEdit && id) {
        const response = await productionApi.updateRouting(id, submitData);
        if (response.code === 0) navigate('/production/routing');
        else setError(response.message || '保存失败');
      } else {
        const response = await productionApi.createRouting(submitData);
        if (response.code === 0) navigate('/production/routing');
        else setError(response.message || '保存失败');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑工艺路线' : '新建工艺路线'}
        subtitle={isEdit ? '修改工艺路线信息' : '创建新的工艺路线'}
        onBack={() => { if (confirmLeave()) navigate('/production/routing'); }}
        backDisabled={loading}
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      <div className="card p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">工艺路线编号 *</label>
              <input
                type="text"
                name="routing_code"
                value={formData.routing_code || ''}
                onChange={handleInputChange}
                required
                className="form-input"
                placeholder="请输入工艺路线编号"
               autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">工艺路线名称 *</label>
              <input
                type="text"
                name="routing_name"
                value={formData.routing_name || ''}
                onChange={handleInputChange}
                required
                className="form-input"
                placeholder="请输入工艺路线名称"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">关联产品 *</label>
              <SearchSelect
                required
                value={formData.product_id}
                onChange={(v) => setFormData(prev => ({ ...prev, product_id: v ?? '' }))}
                placeholder="请选择产品"
                options={products.map((p) => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) }))}
              />
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
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
            <textarea
              name="remark"
              value={formData.remark || ''}
              onChange={handleInputChange}
              rows={2}
              className="form-input"
              placeholder="请输入备注信息"
            />
          </div>

          {/* 工序步骤 */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-medium text-gray-700">工序步骤（{steps.length}）</h3>
              <button type="button" onClick={handleAddStep} className="btn-secondary text-sm flex items-center gap-1">
                <Plus className="w-4 h-4" /> 添加工序
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">序号</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">工序编码</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">工序名称</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">工作中心</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">标准工时(分)</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">准备(分)</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">收尾(分)</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {steps.map((s, index) => (
                    <tr key={index}>
                      <td className="px-2 py-2 text-center text-gray-500">{index + 1}</td>
                      <td className="px-2 py-2">
                        <input type="text" value={s.process_code}
                          onChange={(e) => handleStepChange(index, 'process_code', e.target.value)}
                          className="form-input" placeholder="如：OP10"  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                      </td>
                      <td className="px-2 py-2">
                        <input type="text" value={s.process_name}
                          onChange={(e) => handleStepChange(index, 'process_name', e.target.value)}
                          className="form-input" placeholder="如：下料" />
                      </td>
                      <td className="px-2 py-2">
                        <SearchSelect
                          value={s.work_center_id}
                          onChange={(v) => handleStepChange(index, 'work_center_id', v ?? '')}
                          placeholder="请选择"
                          options={[
                            // 编辑态保留已停用/不在列表中的工作中心（原样展示，不可再改选别的值）
                            ...(!workCenters.some((w) => w.id === s.work_center_id) && s.work_center_id
                              ? [{ value: s.work_center_id, label: s.work_center || '已删除工作中心' }]
                              : []),
                            ...workCenters.map((w) => ({ value: w.id, label: w.name })),
                          ]}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input type="text" inputMode="decimal" value={s.standard_time ?? ''}
                          onChange={(e) => handleStepChange(index, 'standard_time', e.target.value)}
                          className="form-input text-right" />
                      </td>
                      <td className="px-2 py-2">
                        <input type="text" inputMode="decimal" value={s.setup_time ?? ''}
                          onChange={(e) => handleStepChange(index, 'setup_time', e.target.value)}
                          className="form-input text-right" />
                      </td>
                      <td className="px-2 py-2">
                        <input type="text" inputMode="decimal" value={s.teardown_time ?? ''}
                          onChange={(e) => handleStepChange(index, 'teardown_time', e.target.value)}
                          className="form-input text-right" />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button type="button" onClick={() => handleRemoveStep(index)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {steps.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">点击上方按钮添加工序步骤</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" onClick={() => { if (confirmLeave()) navigate('/production/routing'); }} disabled={loading} className="btn-secondary">取消</button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              <Save className="w-5 h-5" />
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
