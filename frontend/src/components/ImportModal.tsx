import { useState } from 'react';
import { Modal, Radio } from 'antd';
import { message } from '@/utils/appMessage';
import { Upload, Download, Eye } from 'lucide-react';
import { http } from '@/utils/request';
import { saveBlob } from '@/utils/exportBackend';
import { PERM_IMPORT_EXPORT, hasPermissionNow } from '@/hooks/usePermission';

export interface ImportResultData {
  total?: number;
  success?: number;
  /** 其中「同名更新」的条数 */
  updated?: number;
  /** 「同名跳过」的条数 */
  skipped?: number;
  failed?: number;
  /** 预览（试算）结果：数字同正式导入，但未写入任何数据 */
  dry_run?: boolean;
  messages?: string[];
}

/** 同名档案处理策略选项（后端 on_duplicate：skip/update/create） */
const DUP_OPTIONS = [
  { value: 'skip', label: '同名跳过', desc: '已存在同名或同编码档案时跳过该行（推荐，防止重复档案）' },
  { value: 'update', label: '同名更新', desc: '用本行「非空」字段更新既有档案（留空列保持原值，编码不变）' },
  { value: 'create', label: '全部新建', desc: '不查重，允许建出同名档案（导入历史行为）' },
];

interface ImportModalProps {
  open: boolean;
  title: string;
  /** 导入接口（POST /v1/import/xxx） */
  importUrl: string;
  /** CSV 模板下载地址（可选） */
  templateUrl?: string;
  /** Excel 模板下载地址（可选） */
  templateUrlXlsx?: string;
  /** 列说明提示文本 */
  templateHint?: string;
  /** 提示区补充说明（如「预览不会写入数据」类业务须知，可选） */
  hintExtra?: string;
  /** 是否提供「同名档案处理」选项（客户/供应商导入用；默认不显示 = 全部新建） */
  duplicateStrategy?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * 通用导入弹窗：选择 CSV / Excel(.xlsx) → **先预览（试算，不写入）→ 确认导入**。
 *
 * 预览走后端同一个导入接口（`dry_run=true`）：服务端在事务里真跑一遍再回滚，
 * 因此「将新建/更新/跳过/失败」与逐行原因与正式导入一致，但一个字节也不落库。
 */
export function ImportModal({
  open,
  title,
  importUrl,
  templateUrl,
  templateUrlXlsx,
  templateHint,
  hintExtra,
  duplicateStrategy,
  onClose,
  onSuccess,
}: ImportModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportResultData | null>(null);
  const [result, setResult] = useState<ImportResultData | null>(null);
  const [dupStrategy, setDupStrategy] = useState('skip');

  const reset = () => {
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    setImporting(false);
    setDupStrategy('skip');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // 换文件 / 换策略：旧预览失效（否则会拿着过期预览确认落库）
  const invalidatePreview = () => {
    setPreview(null);
    setResult(null);
  };

  const upload = async (dryRun: boolean) => {
    const formData = new FormData();
    formData.append('file', selectedFile as File);
    // 同名档案策略：商品/客户/供应商/仓库/单位导入支持（后端参数 on_duplicate，缺省 = 全部新建）
    if (duplicateStrategy) {
      formData.append('on_duplicate', dupStrategy);
    }
    if (dryRun) {
      formData.append('dry_run', 'true');
    }
    return http.upload<ImportResultData>(importUrl, formData);
  };

  const applyFinalResult = (data: ImportResultData) => {
    const skipped = data.skipped ?? 0;
    setResult(data);
    if ((data.failed ?? 0) === 0) {
      message.success(`导入成功 ${data.success ?? 0} 条${skipped > 0 ? `，跳过 ${skipped} 条` : ''}`);
      onSuccess?.();
    } else {
      message.warning(`导入完成：成功 ${data.success ?? 0} 条，失败 ${data.failed ?? 0} 条`);
    }
  };

  const handlePreview = async () => {
    // 2026-09-12：导入统一由 import_export 权限码管控（后端已改用专用码）；此处为界面层兑底提示
    if (!hasPermissionNow(PERM_IMPORT_EXPORT)) {
      message.warning('无导入权限（请管理员在角色中分配「数据导入导出」）');
      return;
    }
    if (!selectedFile) {
      message.warning('请先选择 CSV 或 Excel 文件');
      return;
    }
    setImporting(true);
    setPreview(null);
    setResult(null);
    try {
      const res = await upload(true);
      if (res.code !== 0) {
        message.error(res.message || '预览失败');
        return;
      }
      const data = res.data || {};
      if (data.dry_run) {
        setPreview(data);
        message.success('预览完成（未写入任何数据）');
      } else {
        // 后端未启用预览（返回的就是正式结果）→ 不得再让用户点「确认」重复导入
        applyFinalResult(data);
      }
    } catch (err: any) {
      message.error(err?.message || '预览失败');
    } finally {
      setImporting(false);
    }
  };

  const handleConfirm = async () => {
    setImporting(true);
    try {
      const res = await upload(false);
      if (res.code === 0) {
        setPreview(null);
        applyFinalResult(res.data || { success: 0, failed: 0 });
      } else {
        message.error(res.message || '导入失败');
      }
    } catch (err: any) {
      message.error(err?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = async (url: string, ext: 'csv' | 'xlsx') => {
    if (!url) return;
    try {
      const blob = await http.download(url);
      saveBlob(blob, `template.${ext}`);
      message.success('模板已下载');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '模板下载失败');
    }
  };

  return (
    <Modal title={title} open={open} onCancel={handleClose} footer={null} width={560}>
      <div className="space-y-4 pt-2">
        {templateHint && (
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700 space-y-1">
            <p>支持 CSV / Excel(.xlsx) 文件（首行为表头，UTF-8 编码）：</p>
            <code className="block bg-white px-2 py-1 rounded text-xs break-all">{templateHint}</code>
            {hintExtra && <p className="text-xs text-blue-500">{hintExtra}</p>}
          </div>
        )}
        {(templateUrl || templateUrlXlsx) && (
          <div className="flex items-center gap-3">
            {templateUrl && (
              <button
                onClick={() => handleDownloadTemplate(templateUrl, 'csv')}
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
              >
                <Download className="w-4 h-4" /> 下载 CSV 模板
              </button>
            )}
            {templateUrlXlsx && (
              <button
                onClick={() => handleDownloadTemplate(templateUrlXlsx, 'xlsx')}
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
              >
                <Download className="w-4 h-4" /> 下载 Excel 模板
              </button>
            )}
          </div>
        )}
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => {
            setSelectedFile(e.target.files?.[0] || null);
            invalidatePreview();
          }}
          className="form-input"
        />
        {duplicateStrategy && (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-sm text-gray-600 mb-2">同名档案处理</p>
            <Radio.Group
              value={dupStrategy}
              onChange={(e) => {
                setDupStrategy(e.target.value);
                invalidatePreview();
              }}
              className="flex flex-col gap-1.5"
            >
              {DUP_OPTIONS.map((o) => (
                <Radio key={o.value} value={o.value} className="text-sm">
                  <span className="font-medium">{o.label}</span>
                  <span className="ml-1 text-xs text-gray-400">{o.desc}</span>
                </Radio>
              ))}
            </Radio.Group>
          </div>
        )}
        {!preview ? (
          <button
            onClick={handlePreview}
            disabled={importing || !selectedFile}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
            {importing ? '预览中...' : '预览（不写入数据）'}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              以上为预览结果，<strong>尚未写入</strong>；点「确认导入」才会真正保存。
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePreview}
                disabled={importing}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                重新预览
              </button>
              <button
                onClick={handleConfirm}
                disabled={importing}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {importing ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {importing ? '导入中...' : `确认导入（新建 ${preview.success ?? 0} · 更新 ${preview.updated ?? 0} · 跳过 ${preview.skipped ?? 0}）`}
              </button>
            </div>
          </div>
        )}
        {preview && (
          <div className="p-3 rounded-lg text-sm bg-blue-50 border border-blue-200 text-blue-800">
            <p className="font-medium">预览结果（未写入）</p>
            <p className="mt-0.5">
              共 {preview.total ?? 0} 条，将新建 {preview.success ?? 0} 条
              {(preview.updated ?? 0) > 0 ? `（其中更新 ${preview.updated} 条）` : ''}
              {(preview.skipped ?? 0) > 0 ? `，将跳过 ${preview.skipped} 条` : ''}，失败 {preview.failed ?? 0} 条。
            </p>
            {preview.messages && preview.messages.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-xs max-h-32 overflow-y-auto">
                {preview.messages.slice(0, 20).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {result && (
          <div
            className={`p-3 rounded-lg text-sm ${
              (result.failed ?? 0) > 0
                ? 'bg-orange-50 border border-orange-200 text-orange-700'
                : 'bg-green-50 border border-green-200 text-green-700'
            }`}
          >
            <p>
              共 {result.total ?? 0} 条，成功 {result.success ?? 0} 条
              {(result.updated ?? 0) > 0 ? `（其中更新 ${result.updated} 条）` : ''}
              {(result.skipped ?? 0) > 0 ? `，跳过 ${result.skipped} 条` : ''}，失败 {result.failed ?? 0} 条。
            </p>
            {result.messages && result.messages.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-xs max-h-32 overflow-y-auto">
                {result.messages.slice(0, 20).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
