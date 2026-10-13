import { useCallback, useEffect, useRef, useState } from 'react';
import { Save, Building2, Package, Upload, Trash2, Image as ImageIcon, User } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { http } from '@/utils/request';
import { isolationApi } from '@/api/system';
import { PageHeader } from '@/components/PageHeader';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/store/app';

// 批次分配策略选项（B-03b）：与后端 inventory.ValidateAllocationSettingValue 同一份取值口径
const BATCH_STRATEGIES = [
  { value: 'fifo', label: '先进先出（FIFO）', desc: '按生产日期/入库时间先后出库（默认，与升级前一致）' },
  { value: 'fefo', label: '先到期先出（FEFO）', desc: '按到期日先后出库，临期批次优先——食品/药品/化妆品建议选此项' },
];

// 「个人模式」选项（2026-09-22）：字形与后端 system_setting.personal_mode.enabled 一一对应
const PERSONAL_MODES = [
  { value: false, label: '标准模式（推荐）', desc: '单据按审批流程逐级审批，出库严格校验库存——适合有分工/多人的正规企业' },
  { value: true, label: '个人模式', desc: '去掉“审批链”与“必须有库存才能开单”——夫妻店 / 个人 / 小加工作坊' },
];

const FIELDS = [
  { key: 'name', label: '公司名称', placeholder: '如 XX 有限公司' },
  { key: 'tax_no', label: '税号', placeholder: '统一社会信用代码' },
  { key: 'address', label: '地址', placeholder: '公司地址' },
  { key: 'phone', label: '联系电话', placeholder: '公司电话' },
  { key: 'currency', label: '本位币', placeholder: '如 CNY' },
];

export function CompanySettings() {
  // [2026-09-18 权限细化] 按钮级门控：保存公司信息/库存参数/数据隔离=setting_edit
  const { has } = usePermission();
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isolationMode, setIsolationMode] = useState('off');
  // 库存参数：批次分配策略（B-03b）——出库未指定批次时按此策略自动拆批
  const [batchStrategy, setBatchStrategy] = useState('fifo');
  // 「个人模式」（2026-09-22）：拖妻店/小加工 —— 去掉审批链与库存硬校验（保存后写回全局 store）
  const [personalMode, setPersonalMode] = useState(false);
  // 公司 LOGO（2026-09-16）：支持本地上传——复用 /v1/upload/image（system 权限）
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await http.get<Record<string, any>>('/v1/settings');
      if (res.code === 0 && res.data?.company) {
        const company = res.data.company;
        const next: Record<string, string> = {};
        for (const f of FIELDS) next[f.key] = String(company[f.key] ?? '');
        // LOGO 为独立控件（本地上传 + URL 兼容），不属于 FIELDS，需单独回填——否则预览为空、保存会清掉已存 LOGO
        next.logo = String(company.logo ?? '');
        setForm(next);
      }
      if (res.code === 0 && res.data?.inventory) {
        setBatchStrategy(String(res.data.inventory.batch_strategy || 'fifo'));
      }
      if (res.code === 0 && res.data?.personal_mode) {
        setPersonalMode(res.data.personal_mode.enabled === true);
      }
      const iso = await isolationApi.get();
      if (iso.code === 0) {
        setIsolationMode(iso.data?.mode || 'off');
      }
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  // LOGO 本地上传：选择文件 → 调统一图片上传接口 → 成功后填入表单（点「保存」才落库）
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await http.upload<{ url: string }>('/v1/upload/image', fd);
      const url = res.data?.url;
      if (res.code === 0 && url) {
        setForm(prev => ({ ...prev, logo: url }));
        message.success('LOGO 已上传，点击右上角「保存」后生效');
      } else {
        message.error(res.message || 'LOGO 上传失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : 'LOGO 上传失败，请稍后重试');
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await http.put('/v1/settings', {
        settings: {
          company: { ...form },
          inventory: { batch_strategy: batchStrategy },
          personal_mode: { enabled: personalMode },
          data_isolation: { mode: isolationMode },
        },
      });
      if (res.code === 0) {

        // 写回全局 store：侧边栏/单据页据此隐藏审批入口（无需刷新）
        useAppStore.getState().setPersonalMode(personalMode);
        message.success('设置已保存');
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (err) {
message.error(err instanceof Error && err.message ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="公司设置"
        subtitle="企业基础信息（用于单据抬头等）"
        extra={
          has('setting_edit') && (
            <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" />
              <span className="hidden md:inline">{saving ? '保存中...' : '保存'}</span>
            </button>
          )
        }
      />

      <div className="card p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="max-w-2xl space-y-5">
            <div className="flex items-center gap-3 text-gray-400">
              <Building2 className="w-5 h-5" />
              <span className="text-sm">保存后，单据打印抬头将使用以下信息</span>
            </div>
            {FIELDS.map(field => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-gray-700 mb-2">{field.label}</label>
                <input
                  type="text"
                  value={form[field.key] || ''}
                  placeholder={field.placeholder}
                  onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                  className="form-input"
                />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">公司 LOGO</label>
              <div className="flex items-start gap-3 flex-wrap">
                {form.logo ? (
                  <div className="relative w-20 h-20 shrink-0">
                    <img
                      key={form.logo}
                      src={form.logo}
                      alt="公司 LOGO 预览"
                      className="w-full h-full object-contain rounded-lg border border-gray-200 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, logo: '' }))}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow"
                      title="移除 LOGO"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="w-20 h-20 shrink-0 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300" title="尚未设置 LOGO">
                    <ImageIcon className="w-6 h-6" />
                  </div>
                )}
                <div className="flex-1 min-w-[220px] space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={form.logo || ''}
                      placeholder="可粘贴图片 URL，或点击右侧按钮上传本地图片"
                      onChange={e => setForm(prev => ({ ...prev, logo: e.target.value }))}
                      className="form-input flex-1 min-w-0"
                    />
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoUploading}
                      className="btn-secondary flex items-center gap-1.5 shrink-0"
                      title="上传本地图片"
                    >
                      {logoUploading ? (
                        <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      <span className="hidden md:inline">{logoUploading ? '上传中...' : '上传图片'}</span>
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">
                    支持 jpg/jpeg/png/gif/webp/bmp（建议透明底 PNG），不超过 10MB；上传后点「保存」生效。LOGO 将显示在登录页与单据打印抬头。
                  </p>
                </div>
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoUpload}
              />
            </div>
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-700">部门数据隔离</h3>
          <p className="text-xs text-gray-400 mt-1">开启后，普通用户只能看到本部门的数据（超级管理员/管理员不受限制）。需要先在「部门管理」创建部门并给用户分配部门，再到「角色管理」把角色数据范围设为「本部门数据」。</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { value: 'off', label: '关闭隔离', desc: '所有用户可见全部数据（当前默认）' },
            { value: 'sales', label: '销售隔离（A）', desc: '客户/供应商/销售单据/应收按部门隔离；商品/采购/库存全公司共享' },
            { value: 'full', label: '完全隔离（B）', desc: '客户/商品/销售/采购/库存/应收全部按部门隔离' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setIsolationMode(opt.value)}
              className={`p-4 rounded-xl border-2 text-left transition-colors ${isolationMode === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <div className="text-sm font-medium text-gray-800">{opt.label}</div>
              <div className="text-xs text-gray-500 mt-1">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <User className="w-4 h-4 text-gray-400" />
            个人模式
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            夫妻店 / 个人 / 小加工作坊通常只有 1~2 个人，不需要逐级审批，也常常「先开单、后进货」。
            开启个人模式后，系统会去掉这类内部管控限制（随时可切回标准模式）。
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
          {PERSONAL_MODES.map(opt => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => setPersonalMode(opt.value)}
              className={`p-4 rounded-xl border-2 text-left transition-colors ${personalMode === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <div className="text-sm font-medium text-gray-800">{opt.label}</div>
              <div className="text-xs text-gray-500 mt-1">{opt.desc}</div>
            </button>
          ))}
        </div>
        {personalMode && (
          <ul className="text-xs text-amber-600 mt-3 list-disc pl-5 space-y-1">
            <li>单据不再强制审批：「审批流程」「我的审批」入口隐藏；未配置审批流程时「提交审批」直接视为通过。</li>
            <li>允许无库存开单/出库：库存不足不再拦单，库存余额可为负（后续补货自动回正）。</li>
            <li>允许入库/出库超过订单数量；退货无历史库存时自动回冲到默认仓库。</li>
            <li>提示：负库存与超订单数量属「先开单后补货」的正常现象，请自行把握账实一致。</li>
          </ul>
        )}
      </div>

      <div className="card p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Package className="w-4 h-4 text-gray-400" />
            库存参数
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            批次分配策略——出库单/发货未指定批次时，系统按此策略自动拆批。仅对启用「批次管理」的商品生效（商品档案里的开关）。
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
          {BATCH_STRATEGIES.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setBatchStrategy(opt.value)}
              className={`p-4 rounded-xl border-2 text-left transition-colors ${batchStrategy === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <div className="text-sm font-medium text-gray-800">{opt.label}</div>
              <div className="text-xs text-gray-500 mt-1">{opt.desc}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-amber-600 mt-3">
          提示：改成「先到期先出」后，已存在的草稿单据下次确认时即按新策略拆批；已完成的出库不会重算。
        </p>
      </div>
    </div>
  );
}
