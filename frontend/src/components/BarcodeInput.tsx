import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { Camera, Flashlight, ScanLine, ZoomIn } from 'lucide-react';

/**
 * 条码 / 扫码输入框（扫码枪 + 手机摄像头，2026-09-11 易用性 P2；2026-09-14 手机端三层兜底；2026-09-19 识别率增强）
 *
 * 三种扫码来源：
 * 1) 扫码枪：本质是「快速键盘输入 + 回车」→ 输入框监听 Enter 直接触发 onDetect（无需点任何按钮）
 * 2) 手机 / 平板摄像头（实时扫描）——自动选解码器：
 *    a. 浏览器原生 `BarcodeDetector`（Android Chrome 等；快、零依赖）
 *    b. 原生不可用时（iOS Safari / Firefox / Windows 桌面 Chrome / Electron）→ **按需动态加载**
 *       `@zxing/browser` 解码（懒加载 chunk，不进主包）
 * 3) 「拍照识别」兜底：**HTTP（非安全上下文）下浏览器禁止网页调用摄像头**（`navigator.mediaDevices` 不存在），
 *    此时引导用系统相机拍条码照片再解码（`<input type="file" accept="image/*" capture="environment">`），
 *    手机端仍然可用；同时覆盖：无摄像头 / 权限被拒 / 实时扫描对不上焦等场景。
 *
 * ⚠️ 实时摄像头需要 HTTPS 或 localhost（浏览器安全策略）；HTTP 部署的手机端走「拍照识别」。
 * 任一步失败都必须给出**可操作的下一步**提示（换拍照 / 扫码枪 / 手动输入），不做点了没反应的假按钮。
 *
 * 2026-09-19 识别率增强（用户反馈「手机扫码能力弱」）：
 *   ① 取流分辨率：请求 1280×720（低分辨率 640×480 时 1D 细纹常解不出）；
 *   ② 连续对焦：部分安卓机型支持 `focusMode: continuous`（applyConstraints 尝试，不支持则忽略）；
 *   ③ 手电筒：探测 `torch` 能力后显示开关（仓库/暗处扫码；iOS Safari 不支持则隐藏）；
 *   ④ zxing hints：限定 16 种码制（含 DataMatrix / PDF417 / Aztec / DataBar 等非标准码制）+ 拍照加 TRY_HARDER；
 *   ⑤ 拍照多轮解码：全图 → 中心裁剪 85% / 55%（条码通常居中，裁剪后条纹像素密度更高）；
 *   ⑥ 成功反馈：安卓震动一下（扫上没有用户能感知）。
 *   ⑦ 非重叠扫描循环（禁 setInterval 重叠排队，安卓机「越扫越卡」）+ 点按手动对焦 + 变焦滑条（zoom 能力）。
 */

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement | ImageBitmap) => Promise<Array<{ rawValue: string }>>;
};
type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

// 覆盖零售/仓储/医药常见码制 + 非标准/客户自带码制（原生 BarcodeDetector 格式名）
const FORMATS = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'code_128', 'code_93', 'code_39', 'itf', 'codabar',
  'qr_code', 'data_matrix', 'pdf417', 'aztec',
];

// 拍照多轮解码的裁剪比例（中心裁剪；条码通常被用户放在画面中间）
const PHOTO_CROP_RATIOS = [0.85, 0.55] as const;

const nativeDetector = (): BarcodeDetectorCtor | undefined =>
  (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

/** 动态加载 zxing（懒加载 chunk 不进主包；离线部署本地打包不得用 CDN） */
async function loadZxing() {
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const { DecodeHintType, BarcodeFormat } = await import('@zxing/library');
  /**
   * 解码 hints：
   *   - POSSIBLE_FORMATS：限定码制（不限定=默认全码制逐类尝试，又慢又弱）；
   *   - ASSUME_GS1：GS1-128 / DataMatrix 的 FNC1 语义（不影响普通 Code128）；
   *   - TRY_HARDER：拍照场景多花时间换准确率（实时视频不加，保帧率）。
   */
  const makeHints = (photo: boolean): Map<import('@zxing/library').DecodeHintType, unknown> => {
    const hints: Map<import('@zxing/library').DecodeHintType, unknown> = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128, BarcodeFormat.CODE_93, BarcodeFormat.CODE_39, BarcodeFormat.ITF,
      BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417,
      // 非标准/客户自带码制的兜底（2026-09-19）：Aztec、DataBar(RSS)、Micro QR 也要能扫
      BarcodeFormat.AZTEC, BarcodeFormat.RSS_14, BarcodeFormat.RSS_EXPANDED, BarcodeFormat.MICRO_QR_CODE,
    ]);
    hints.set(DecodeHintType.ASSUME_GS1, true);
    if (photo) hints.set(DecodeHintType.TRY_HARDER, true);
    return hints;
  };
  return { BrowserMultiFormatReader, makeHints };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

/** 中心裁剪到 canvas（裁剪后每根条纹占更多像素，1D 条码更易解出） */
function cropCenterToCanvas(img: HTMLImageElement, ratio: number): HTMLCanvasElement {
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const cw = Math.max(1, Math.round(sw * ratio));
  const ch = Math.max(1, Math.round(sh * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, Math.round((sw - cw) / 2), Math.round((sh - ch) / 2), cw, ch, 0, 0, cw, ch);
  }
  return canvas;
}

/** 从条码照片解码：原生 BarcodeDetector → zxing（全图 → 中心裁剪多轮） */
async function decodeBarcodeFromImageFile(file: File, url: string): Promise<string> {
  // 1) 原生解码（Android Chrome）：最快路径
  const Detector = nativeDetector();
  if (Detector) {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const codes = await new Detector({ formats: FORMATS }).detect(bitmap);
        const text = codes[0]?.rawValue?.trim();
        if (text) return text;
      } finally {
        bitmap.close();
      }
    } catch {
      /* 原生解码失败 → 落 zxing */
    }
  }
  // 2) zxing（TRY_HARDER + 限定码制）：全图一轮，失败后中心裁剪两轮
  const { BrowserMultiFormatReader, makeHints } = await loadZxing();
  const reader = new BrowserMultiFormatReader(makeHints(true));
  const tryDecode = async (fn: () => Promise<{ getText(): string }> | { getText(): string }): Promise<string> => {
    try {
      return (await fn()).getText().trim();
    } catch {
      return '';
    }
  };
  const full = await tryDecode(() => reader.decodeFromImageUrl(url));
  if (full) return full;
  const img = await loadImage(url);
  for (const ratio of PHOTO_CROP_RATIOS) {
    const code = await tryDecode(() => reader.decodeFromCanvas(cropCenterToCanvas(img, ratio)));
    if (code) return code;
  }
  return '';
}

interface BarcodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** 回车（扫码枪）或摄像头识别到条码时回调，参数为去掉首尾空白的条码文本 */
  onDetect: (code: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function BarcodeInput({ value, onChange, onDetect, placeholder, className, autoFocus }: BarcodeInputProps) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  // 变焦（安卓多数后置摄像头支持；小码/远距离扫不出时用户手动放大）
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  // 点按对焦视觉反馈
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  // ⚠️ 必须用「回调 ref + state」拿 video 元素：antd Modal 的 portal 内容挂载晚于父组件 effect，
  //    普通 ref 对象在 effect 首次执行时必为 null（2026-09-14 实测：摄像头逻辑整体被跳过，
  //    表现为「手机扫码不可用」——点了没反应、连提示都没有）。state 变化会重跑 effect。
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 摄像头/解码器的停止函数（原生 interval 或 zxing controls 各注册一种）
  const stopRef = useRef<(() => void) | null>(null);
  // 统一持有的流与轨道（原生与 zxing 共用；手电筒/对焦都作用于该轨道）
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  // onDetect 每次渲染都是新函数 → 用 ref 持有，避免「父组件一重渲染就重启摄像头」
  const onDetectRef = useRef(onDetect);
  const lastHitRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  const stopCamera = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
  }, []);

  // 命中统一出口：去空白 + 同一条码 1.5s 内只触发一次（连续帧会反复命中同一码）
  const hit = useCallback((raw: string) => {
    const code = String(raw || '').trim();
    if (!code) return;
    const now = Date.now();
    if (lastHitRef.current.code === code && now - lastHitRef.current.at < 1500) return;
    lastHitRef.current = { code, at: now };
    // 成功反馈：安卓 Chrome 支持震动（iOS / 桌面忽略）——扫上了用户能感知到
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(40);
    } catch {
      /* 忽略 */
    }
    onDetectRef.current(code);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open || !videoEl) return;
    let disposed = false;
    const video = videoEl;

    // HTTP（非安全上下文）下 navigator.mediaDevices 不存在 → 必须先判空，否则直接抛错成死路
    const canUseCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    const Detector = nativeDetector();

    const start = async () => {
      if (!canUseCamera) {
        // HTTP 部署 / 老浏览器：网页无法调摄像头 → 引导「拍照识别」（用系统相机拍条码）
        setHint('当前访问方式不允许网页调用摄像头（实时扫描需 HTTPS 或 localhost）——请点下方「拍照识别」拍条码，或改用扫码枪 / 手动输入');
        return;
      }
      // 统一取流（原生与 zxing 共用）：请求高分辨率——低分辨率下 1D 细纹常解不出（手机扫码「弱」的主要成因之一）
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        setHint(
          name === 'NotAllowedError'
            ? '摄像头权限被拒——请在浏览器/系统设置里允许本站摄像头权限，或改用「拍照识别」/ 扫码枪 / 手动输入'
            : name === 'NotFoundError'
              ? '未检测到摄像头——可点下方「拍照识别」（用系统相机拍条码），或改用扫码枪 / 手动输入'
              : '无法访问摄像头——可点下方「拍照识别」拍条码解码，或改用扫码枪 / 手动输入',
        );
        return;
      }
      if (disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      // 连续对焦（部分安卓机型支持；不支持会抛错，忽略即可）
      try {
        await track?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as unknown as MediaTrackConstraintSet] });
      } catch {
        /* 机型/浏览器不支持连续对焦，忽略 */
      }
      // 手电筒 / 变焦能力探测（Chrome/Android 支持；iOS Safari 多半不支持 → 自动隐藏控件）
      try {
        const caps = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number; step?: number } })
          | undefined;
        setTorchAvailable(!!caps?.torch);
        const z = caps?.zoom;
        if (z && typeof z.max === 'number' && z.max > z.min) {
          setZoomRange({ min: z.min, max: z.max, step: z.step && z.step > 0 ? z.step : 0.1 });
          setZoom(z.min);
        }
      } catch {
        /* 忽略 */
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      if (Detector) {
        // 原生解码（最快路径）
        let detector: BarcodeDetectorLike;
        try {
          const supported = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : FORMATS;
          const formats = FORMATS.filter((f) => supported.includes(f));
          detector = new Detector(formats.length ? { formats } : undefined);
        } catch {
          detector = new Detector();
        }
        // 非重叠扫描循环（2026-09-19）：上一帧解码完成后再等一小段才发起下一帧——
        // setInterval 在设备解码慢时会让 async detect 重叠排队，安卓机上表现为「越扫越卡还没结果」。
        let scanAlive = true;
        const scanLoop = async () => {
          while (scanAlive && !disposed) {
            const startedAt = Date.now();
            try {
              const codes = await detector.detect(video);
              const code = codes[0]?.rawValue;
              if (code) hit(code);
            } catch {
              /* 单帧识别失败忽略，下一帧继续 */
            }
            const elapsed = Date.now() - startedAt;
            await new Promise((r) => window.setTimeout(r, Math.max(120, 250 - elapsed)));
          }
        };
        void scanLoop();
        stopRef.current = () => {
          scanAlive = false;
        };
      } else {
        // 原生 BarcodeDetector 不可用（iOS Safari / Firefox / Windows 桌面 Chrome / Electron）→ zxing
        setHint('正在加载兼容解码器…（首次打开需加载解码组件，稍候）');
        try {
          const { BrowserMultiFormatReader, makeHints } = await loadZxing();
          if (disposed) return;
          const reader = new BrowserMultiFormatReader(makeHints(false), {
            delayBetweenScanAttempts: 250,
            delayBetweenScanSuccess: 1500,
          });
          // 用 decodeFromStream 复用上面已取的流：手电筒/对焦由我们控制（decodeFromConstraints 会另取一条流）
          const controls = await reader.decodeFromStream(stream, video, (result) => {
            if (result) hit(result.getText());
          });
          if (disposed) {
            controls.stop();
            return;
          }
          stopRef.current = () => controls.stop();
          setHint('');
        } catch (err) {
          const name = err instanceof Error ? err.name : '';
          setHint(
            name === 'NotAllowedError'
              ? '摄像头权限被拒——可点下方「拍照识别」拍条码解码，或改用扫码枪 / 手动输入'
              : '摄像头不可用——可点下方「拍照识别」拍条码解码，或改用扫码枪 / 手动输入',
          );
        }
      }
    };

    void start();
    return () => {
      disposed = true;
      stopCamera();
      setTorchAvailable(false);
      setTorchOn(false);
      setZoomRange(null);
      setZoom(1);
      setFocusPoint(null);
    };
  }, [open, videoEl, hit, stopCamera]);

  /** 手电筒开关（仅探测到 torch 能力的机型显示） */
  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setHint('本机型/浏览器不支持闪光灯控制——请靠近光源或改用「拍照识别」');
    }
  };

  /** 变焦（仅探测到 zoom 能力的机型显示滑条）：小码/远距离扫不出时手动放大 */
  const applyZoom = async (v: number) => {
    setZoom(v);
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ zoom: v } as unknown as MediaTrackConstraintSet] });
    } catch {
      /* 机型不支持，忽略（滑条仍反映用户意图） */
    }
  };

  /** 点按画面手动对焦（pointsOfInterest；部分机型不支持则忽略） */
  const focusAtPoint = async (e: React.MouseEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setFocusPoint({ x, y });
    window.setTimeout(() => setFocusPoint(null), 700);
    try {
      await track.applyConstraints({
        advanced: [
          { pointsOfInterest: [{ x, y }] } as unknown as MediaTrackConstraintSet,
          { focusMode: 'single-shot' } as unknown as MediaTrackConstraintSet,
        ],
      });
      // 单次对焦完成后恢复连续对焦（部分机型需显式恢复，否则停在单次对焦上）
      window.setTimeout(() => {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as unknown as MediaTrackConstraintSet] }).catch(() => undefined);
      }, 2500);
    } catch {
      /* 机型不支持触控对焦，忽略 */
    }
  };

  /** 拍照/相册识别（HTTP 手机端的主要通道；也兜底实时扫描对不上焦的场景） */
  const handlePhotoPick = async (file: File | null | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setHint('照片识别中…');
    const url = URL.createObjectURL(file);
    try {
      const code = await decodeBarcodeFromImageFile(file, url);
      if (code) {
        hit(code);
      } else {
        setHint('未能从照片识别到条码：请让条码占满画面、光线充足、对焦清晰，且尽量把条码放在画面中央后重拍（也可改用扫码枪 / 手动输入）');
      }
    } catch (err) {
      setHint(
        err instanceof Error && err.message
          ? `照片识别失败：${err.message}（可改用扫码枪 / 手动输入）`
          : '照片识别失败，请重试或改用扫码枪 / 手动输入',
      );
    } finally {
      URL.revokeObjectURL(url);
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = ''; // 允许重选同一张照片
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // ⚠️ 先阻止默认行为再判空值（2026-09-13 审查修复）：本组件嵌在单据表单（含 type=submit 保存按钮）里，
    // 空值回车若不 preventDefault 会触发浏览器"隐式提交"——空扫/漏扫后回车会意外提交整单。
    e.preventDefault();
    const code = value.trim();
    if (!code) return;
    onDetect(code);
  };

  return (
    <>
      <div className={`relative ${className || ''}`}>
        <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder || '搜索或扫码：条码 / 编码 / 名称'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="form-input pl-10 pr-11"
        />
        <button
          type="button"
          title="用摄像头扫码"
          aria-label="用摄像头扫码"
          onClick={() => {
            setHint('');
            setOpen(true);
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
        >
          <ScanLine className="w-4 h-4" />
        </button>
      </div>

      <Modal open={open} onCancel={() => setOpen(false)} footer={null} title="扫码" width={420} destroyOnHidden>
        <div className="space-y-3">
          <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-black cursor-pointer" onClick={(e) => void focusAtPoint(e)}>
            <video ref={setVideoEl} className="w-full h-full object-cover" playsInline muted />
            {focusPoint && (
              <div
                className="absolute w-14 h-14 -ml-7 -mt-7 rounded-full border-2 border-yellow-300/90 pointer-events-none"
                style={{ left: `${focusPoint.x * 100}%`, top: `${focusPoint.y * 100}%` }}
              />
            )}
            {!hint && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                {/* 取景框 + 周边压暗：引导用户把条码放进框内、保持 10~20cm */}
                <div className="w-3/4 h-1/3 border-2 border-white/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
            )}
            {hint && (
              <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs leading-relaxed text-white/90 bg-black/75">
                {hint}
              </div>
            )}
          </div>
          {zoomRange && (
            <div className="flex items-center gap-2">
              <ZoomIn className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                type="range"
                min={zoomRange.min}
                max={zoomRange.max}
                step={zoomRange.step}
                value={zoom}
                onChange={(e) => void applyZoom(Number(e.target.value))}
                className="flex-1"
                aria-label="摄像头变焦"
              />
              <span className="text-xs text-gray-500 w-10 text-right">{zoom.toFixed(1)}×</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy}
              className="btn-secondary text-sm flex items-center gap-1"
              title="用系统相机拍条码照片后自动识别（HTTP 访问 / 摄像头不可用时的兜底）"
            >
              <Camera className="w-4 h-4" />
              {photoBusy ? '识别中…' : '拍照识别'}
            </button>
            {torchAvailable && (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                className="btn-secondary text-sm flex items-center gap-1"
                title="光线不足时开闪光灯补光"
              >
                <Flashlight className="w-4 h-4" />
                {torchOn ? '关手电筒' : '开手电筒'}
              </button>
            )}
            <span className="text-xs text-gray-500">实时摄像头不可用 / 对不上焦时，拍一张条码照片也能识别</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void handlePhotoPick(e.target.files?.[0])}
          />
          <p className="text-xs text-gray-500">
            把条码对准取景框（距离 10~20cm）即可自动识别；对不上焦时点一下画面手动对焦，码小/较远用上方变焦放大。
            支持标准条码与<b>自定义内容的条码/二维码</b>（Code128、QR、DataMatrix 等）；也可用扫码枪对准输入框直接扫（无需打开此窗口），或在输入框手动输入后回车。
          </p>
        </div>
      </Modal>
    </>
  );
}
