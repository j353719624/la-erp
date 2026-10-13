import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Save, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { productionApi } from '@/api/production';
import { WorkCenter } from '@/types/production';
import { message } from '@/utils/appMessage';

export function WorkCenterForm() {
  const navigate = useNavigate();
  // [易用性 P1] 未保存离开防护：动过表单再离开会先确认，防误点侧边栏/刷新丢单
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<WorkCenter>>({
    code: '',
    name: '',
    capacity: 1,
    efficiency: 1,
    cost_rate: 0,
    manager: '',
    status: 'active',
    remark: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isEdit && id) fetchDetail();
  }, [id]);

  const fetchDetail = async () => {
    try {
      const res = await productionApi.getWorkCenter(id!);
      if (res.code === 0) {
        const d = res.data;
        setFormData({
          code: d.code,
          name: d.name,
          capacity: d.capacity ?? 1,
          efficiency: d.efficiency ?? 1,
          cost_rate: d.cost_rate ?? 0,
          manager: d.manager || '',
          status: d.status || 'active',
          remark: d.remark || '',
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.code || !formData.name) {
      setError('编码与名称必填');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        code: formData.code,
        name: formData.name,
        capacity: Number(formData.capacity ?? 1),
        efficiency: Number(formData.efficiency ?? 1),
        cost_rate: Number(formData.cost_rate ?? 0),
        manager: formData.manager || '',
        status: formData.status || 'active',
        remark: formData.remark || '',
      };
      let res;
      if (isEdit && id) {
        res = await productionApi.updateWorkCenter(id, payload);
      } else {
        res = await productionApi.createWorkCenter(payload);
      }
      if (res.code === 0) {
        message.success('保存成功');
        navigate('/production/work-centers');
      } else {
        setError(res.message || '保存失败');
      }
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑工作中心' : '新增工作中心'}
        subtitle="生产资源主数据：产能 / 效率 / 成本率"
        onBack={() => { if (confirmLeave()) navigate('/production/work-centers'); }}
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
              <label className="block text-sm font-medium text-gray-700 mb-2">编码 *</label>
              <input type="text" value={formData.code || ''} disabled={isEdit}
                onChange={(e) => handleChange('code', e.target.value)}
                className="form-input" placeholder="如：WC-ASSEMBLY"  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">名称 *</label>
              <input type="text" value={formData.name || ''}
                onChange={(e) => handleChange('name', e.target.value)}
                className="form-input" placeholder="如：组装线A" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">产能（单位/班次）</label>
              <input type="text" inputMode="decimal" value={formData.capacity ?? ''}
                onChange={(e) => handleChange('capacity', e.target.value)}
                className="form-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">效率（0-1，默认 1）</label>
              <input type="text" inputMode="decimal" value={formData.efficiency ?? ''}
                onChange={(e) => handleChange('efficiency', e.target.value)}
                className="form-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">成本率（元/小时）</label>
              <input type="text" inputMode="decimal" value={formData.cost_rate ?? ''}
                onChange={(e) => handleChange('cost_rate', e.target.value)}
                className="form-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">负责人</label>
              <input type="text" value={formData.manager || ''}
                onChange={(e) => handleChange('manager', e.target.value)}
                className="form-input" placeholder="请输入负责人" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
              <select value={formData.status || 'active'}
                onChange={(e) => handleChange('status', e.target.value)}
                className="form-select">
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </select>
            </div>
            <div className="md:col-span-2 lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
              <input type="text" value={formData.remark || ''}
                onChange={(e) => handleChange('remark', e.target.value)}
                className="form-input" placeholder="请输入备注" />
            </div>
          </div>

          <div className="form-actions">
            {/* [物理保护] 保存中锁定取消：防请求飞行+导航竞态 */}
            <button type="button" onClick={() => { if (confirmLeave()) navigate('/production/work-centers'); }} disabled={loading} className="btn-secondary">取消</button>
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
