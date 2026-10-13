import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShieldCheck,
  Timer,
  XCircle,
  Info,
  Copy,
  Upload,
  KeyRound,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { message } from '@/utils/appMessage';
import { PageHeader } from '@/components/PageHeader';
import { licenseApi, LicenseStatusInfo } from '@/api/license';
import { format } from '@/utils/format';
import { copyText } from '@/utils/clipboard';
import { usePermission } from '@/hooks/usePermission';

export function LicenseActivation() {
  // [2026-09-18 权限细化] 按钮级门控：激活/更新授权提交按钮=license_edit（机器码复制为只读不门控）
  const { has } = usePermission();
  const [info, setInfo] = useState<LicenseStatusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await licenseApi.status();
      if (res.code === 0 && res.data) setInfo(res.data);
    } catch {
      // 401 已跳登录
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleCopy = async () => {
    if (!info?.machine_id) return;
    const ok = await copyText(info.machine_id);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      message.success('机器码已复制');
    } else {
      message.error('复制失败，请手动复制');
    }
  };

  const handleActivateFile = async () => {
    if (!selectedFile) {
      message.warning('请先选择授权文件');
      return;
    }
    setActivating(true);
    try {
      const res = await licenseApi.activate(selectedFile);
      if (res.code === 0) {
        message.success(res.data?.message || '激活成功');
        setSelectedFile(null);
        if (fileRef.current) fileRef.current.value = '';
        await fetchStatus();
      } else {
        message.error(res.message || '激活失败');
      }
    } catch (err: any) {
      message.error(err?.message || '激活失败');
    } finally {
      setActivating(false);
    }
  };

  const handleActivatePaste = async () => {
    const content = pasteContent.trim();
    if (!content) {
      message.warning('请粘贴授权内容');
      return;
    }
    setActivating(true);
    try {
      const res = await licenseApi.activateByContent(content);
      if (res.code === 0) {
        message.success(res.data?.message || '激活成功');
        setPasteContent('');
        setPasteOpen(false);
        await fetchStatus();
      } else {
        message.error(res.message || '激活失败');
      }
    } catch (err: any) {
      message.error(err?.message || '激活失败');
    } finally {
      setActivating(false);
    }
  };

  const renderStatusCard = () => {
    if (!info) return null;
    const s = info.status;

    if (s === 'disabled') {
      return (
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-gray-700">授权校验未启用（开发模式）</div>
            <p className="text-sm text-gray-500 mt-1">
              当前构建未开启授权/试用校验，系统不限制使用。正式交付版将启用校验。
            </p>
          </div>
        </div>
      );
    }
    if (s === 'licensed') {
      return (
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-green-600">已授权</div>
            <p className="text-sm text-gray-500 mt-1">
              授权有效期：{info.expires_at ? format.date(info.expires_at) : '永久'}
            </p>
          </div>
        </div>
      );
    }
    if (s === 'trial') {
      return (
        <div className="flex items-start gap-3">
          <Timer className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-amber-600">试用模式</div>
            <p className="text-sm text-gray-500 mt-1">
              剩余试用 <span className="text-amber-600 font-semibold">{info.remaining_days}</span> 天，到期后将无法启动。
              请尽快向厂商购买授权并在下方激活。
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-start gap-3">
        <XCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold text-red-600">未授权 / 授权无效</div>
          <p className="text-sm text-gray-500 mt-1">{info.message || '授权校验未通过，系统将拒绝启动'}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title="授权激活" subtitle="离线授权管理：查看机器码与授权状态，导入授权文件激活" />

      <div className="card p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">当前授权状态</h3>
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <div className="w-7 h-7 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          renderStatusCard()
        )}
      </div>

      <div className="card p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">本机机器码</h3>
        <p className="text-xs text-gray-400 mb-3">将机器码提供给厂商，用于签发绑定本机的授权文件（防拷贝）。</p>
        <div className="flex items-center gap-3 flex-wrap">
          <code className="flex-1 min-w-[260px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm break-all">
            {loading ? '加载中...' : info?.machine_id || '-'}
          </code>
          <button
            onClick={handleCopy}
            disabled={!info?.machine_id}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <Copy className="w-4 h-4" />
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-700">在线激活</h3>
        </div>

        <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700 mb-5 space-y-1">
          <p>激活流程：</p>
          <ol className="list-decimal ml-5 space-y-0.5">
            <li>将上方「机器码」提供给厂商</li>
            <li>厂商签发授权文件（.key）后返回给您</li>
            <li>选择授权文件导入，校验通过即激活成功（无效/换机/过期授权会被拒绝）</li>
          </ol>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">① 上传授权文件（.key）</label>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                accept=".key,.json,.txt"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="form-input max-w-md"
              />
              {has('license_edit') && (
                <button
                  onClick={handleActivateFile}
                  disabled={activating || !selectedFile}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {activating ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {activating ? '激活中...' : '导入并激活'}
                </button>
              )}
            </div>
          </div>

          <div>
            <button
              onClick={() => setPasteOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              {pasteOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              ② 粘贴授权内容（备用方式）
            </button>
            {pasteOpen && (
              <div className="mt-3 space-y-3">
                <textarea
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder="将厂商返回的授权 JSON 内容粘贴到此处"
                  rows={6}
                  className="form-input w-full max-w-2xl font-mono text-xs"
                />
                {has('license_edit') && (
                  <button
                    onClick={handleActivatePaste}
                    disabled={activating}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-600 text-blue-600 text-sm font-medium hover:bg-blue-50 disabled:opacity-50"
                  >
                    {activating ? '激活中...' : '粘贴并激活'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {info?.enabled && (
          <div className="mt-5 flex items-start gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              激活成功后状态即时生效；服务重启后启动校验同样会读取该授权文件。请勿删除授权文件，否则将退回试用/被拒绝。
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
