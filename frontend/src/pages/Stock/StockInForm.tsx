import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { http } from '@/utils/request';
import { format, toLocalDateISO } from '@/utils/format';
import { EmptyState } from '@/components/EmptyState';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle, Check, LayoutGrid, Camera } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { BarcodeInput } from '@/components/BarcodeInput';
import { MultiSpecPickerModal, type SpecBatchItem } from '@/components/MultiSpecPickerModal';
import { stockInApi, locationApi, rackApi } from '@/api/inventory';
import { productApi, warehouseApi } from '@/api/product';
import { purchaseOrderApi, salesReturnApi } from '@/api/order';
import { StockIn, StockInLine, Location, Rack } from '@/types/inventory';
import { Product, Warehouse } from '@/types/product';
import { PurchaseOrder, SalesReturn } from '@/types/order';
import { productSelectGroups, matchProductByScan } from '@/utils/productLabel';
import { docLineTotals, mergeAddsIntoLines, cleanSerialNos, parseSerialNos } from '@/utils/docLines';
import { useDocDefaultWarehouse } from '@/hooks/useDocDefaultWarehouse';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';

/** 单张入库单拍照记录上限（与后端 MaxStockInPhotos 一致） */
const MAX_STOCKIN_PHOTOS = 20;

/** 拍照记录草稿：id 为空表示尚未保存（草稿随单保存；已确认单据即时保存） */
type PhotoDraft = {
  id?: string;
  url: string;
  location_id: string;
  rack_id: string;
  remark: string;
  created_at?: string;
};

export function StockInForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<Partial<StockIn>>({
    warehouse_id: '',
    warehouse_name: '',
    location_id: '',
    rack_id: '',
    source_type: 'purchase',
    source_no: '',
    source_id: '',
    lines: [],
  });

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  // [2026-09-12] 开单默认仓库（P-02）：上次使用 → 仓库档案默认 → 第一个；选中后自动记住
  useDocDefaultWarehouse('stock-in', {
    isEdit,
    warehouses,
    value: formData.warehouse_id,
    onChange: (id) => setFormData((prev) => ({ ...prev, warehouse_id: id })),
  });
  const [locations, setLocations] = useState<Location[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // [2026-09-16] 商品自定义字段中文名（行内「商品信息」小字展示用）
  const productLabels = useProductFieldLabels();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [salesReturns, setSalesReturns] = useState<SalesReturn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  // W-01：规格矩阵批量添加弹窗 / 扫码快速添加输入（连续扫码自动累加数量）
  const [specPickerOpen, setSpecPickerOpen] = useState(false);
  const [scanValue, setScanValue] = useState('');
  // 入库位置拍照记录（2026-09-14）：草稿态随单保存；已确认单据走独立接口即时保存（仅留档，不影响库存）
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);

  // 商品下拉选项：多规格 SKU 按款分组（同名 SKU 归到「款号 · 款名」组头下，叶子=规格（编码））
  const productOptions = useMemo(() => productSelectGroups(products), [products]);

  useEffect(() => {
    fetchOptions();
  }, []);

  useEffect(() => {
    if (isEdit) {
      fetchDetail();
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 各数据源相互独立：单个接口失败（如当前角色无采购订单/销售退货模块权限）
      // 不得拖垮其它下拉——此前 Promise.all 一拒全空，「已建好仓库但新建入库不显示仓库列表」即此因。
      const [whRes, productRes, poRes, srRes, locRes, rackRes] = await Promise.allSettled([
        warehouseApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        // 来源单候选放开：已确认 + 已审核（approve/审批通过后订单才能收料入库；仅 confirmed 会匹配不到已审核单）
        purchaseOrderApi.list({ page: 1, page_size: 1000 }),
        salesReturnApi.list({ page: 1, page_size: 1000 }),
        locationApi.list({ page: 1, page_size: 1000 }),
        rackApi.list({ page: 1, page_size: 1000 }),
      ]);
      if (whRes.status === 'fulfilled' && whRes.value.code === 0) setWarehouses(whRes.value.data.list);
      if (productRes.status === 'fulfilled' && productRes.value.code === 0) setProducts(productRes.value.data.list);
      if (poRes.status === 'fulfilled' && poRes.value.code === 0) setPurchaseOrders((poRes.value.data.list || []).filter((o: any) => o.status === 'confirmed' || o.status === 'approved'));
      if (srRes.status === 'fulfilled' && srRes.value.code === 0) setSalesReturns((srRes.value.data.list || []).filter((o: any) => o.status === 'confirmed' || o.status === 'approved'));
      if (locRes.status === 'fulfilled' && locRes.value.code === 0) setLocations(locRes.value.data?.list || []);
      if (rackRes.status === 'fulfilled' && rackRes.value.code === 0) setRacks(rackRes.value.data?.list || []);
      // 失败项控制台留痕（常见原因：当前角色缺对应模块权限），不阻塞表单
      for (const r of [whRes, productRes, poRes, srRes, locRes, rackRes]) {
        if (r.status === 'rejected') console.warn('部分选项加载失败（可能缺模块权限）:', r.reason?.message || r.reason);
      }
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  const fetchDetail = async () => {
    if (!id) return;
    setDetailLoading(true);
    try {
      const res = await stockInApi.get(id);
      if (res.code === 0 && res.data) {
        const data = res.data;
        const lines = (data.edges?.lines || data.lines || []).map((line: any) => ({
          id: line.id,
          product_id: line.product_id,
          product_code: line.product_code || line.edges?.product?.code || '',
          product_name: line.product_name || line.edges?.product?.name || '',
          spec: line.spec || line.edges?.product?.spec || '',
          unit_id: line.unit_id || line.edges?.product?.unit_id || '',
          // [2026-09-16] 回填商品自定义字段（行内「商品信息」小字；商品字段后续修改不追溯历史单）
          ext_fields: line.edges?.product?.ext_fields,
          quantity: Number(line.qty || 0),
          cost_price: Number(line.unit_cost) || 0,
          amount: Number(line.amount) || (Number(line.qty || 0) * Number(line.unit_cost || 0)) || 0,
          batch_no: line.batch_no || '',
          production_date: line.production_date || '',
          expiry_date: line.expiry_date || '',
        }));
        setFormData({
          id: data.id,
          stock_in_no: data.stock_in_no,
          source_type: data.type,
          source_no: data.source_no,
          source_id: data.source_id,
          warehouse_id: data.warehouse_id,
          warehouse_name: data.edges?.warehouse?.name || data.warehouse_name,
          location_id: data.location_id || '',
          rack_id: data.rack_id || '',
          stock_in_date: data.stock_in_date,
          status: data.status,
          total_amount: data.total_amount,
          total_qty: data.total_qty,
          remark: data.remark,
          lines,
        });

        // 拍照记录回显（2026-09-14）：按记录时间正序
        setPhotos((data.edges?.photos || data.photos || []).map((p: any) => ({
          id: p.id,
          url: p.url,
          location_id: p.location_id || '',
          rack_id: p.rack_id || '',
          remark: p.remark || '',
          created_at: p.created_at,
        })));

        // 编辑回显：来源单若已不在候选状态（如已关闭/完成等）则补拉，保证下拉可见可改
        const sid = data.source_id as string;
        const stype = data.type as string;
        if (sid && stype === 'purchase') {
          try {
            const g = await purchaseOrderApi.get(sid);
            if (g.code === 0 && g.data) setPurchaseOrders(prev => (prev.some((o: any) => o.id === g.data.id) ? prev : [g.data, ...prev]));
          } catch { /* 来源单已删除则忽略 */ }
        } else if (sid && stype === 'sales_return') {
          try {
            const g = await salesReturnApi.get(sid);
            if (g.code === 0 && g.data) setSalesReturns(prev => (prev.some((r: any) => r.id === g.data.id) ? prev : [g.data, ...prev]));
          } catch { /* 来源单已删除则忽略 */ }
        }
      }
    } catch (err) {
      console.error('Failed to fetch detail:', err);
      setError(err instanceof Error && err.message ? err.message : '加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleWarehouseChange = (warehouseId: string) => {
    const warehouse = warehouses.find(w => w.id === warehouseId);
    setFormData(prev => ({
      ...prev,
      warehouse_id: warehouseId,
      warehouse_name: warehouse?.name || '',
      location_id: '',
      rack_id: '',
    }));
  };

  const handleSourceTypeChange = (type: string) => {
    setFormData(prev => ({
      ...prev,
      source_type: type,
      source_no: '',
      source_id: '',
      lines: isEdit && prev.status === 'confirmed' ? prev.lines : [],
      total_amount: isEdit && prev.status === 'confirmed' ? prev.total_amount : 0,
    }));
  };

  const handleSourceOrderChange = async (orderId: string) => {
    if (!orderId) {
      setFormData(prev => ({
        ...prev,
        source_no: '',
        source_id: '',
        lines: isEdit && prev.status === 'confirmed' ? prev.lines : [],
        total_amount: isEdit && prev.status === 'confirmed' ? prev.total_amount : 0,
      }));
      return;
    }

    if (formData.source_type === 'purchase') {
      const order = purchaseOrders.find(o => o.id === orderId);
      if (order) {
        const orderLines = order.edges?.lines || order.lines || [];
        // C-2：自动带出未收明细行（数量=剩余未收，已收满跳过）
        const lines: StockInLine[] = orderLines
          .map((line: any) => {
            const total = Number(line.quantity || line.qty || 0);
            const delivered = Number(line.delivered_qty || 0);
            const remaining = Math.max(0, total - delivered);
            return {
              id: '',
              product_id: line.product_id,
              product_code: line.product_code || line.edges?.product?.code || '',
              product_name: line.product_name || line.edges?.product?.name || '',
              spec: line.spec || line.edges?.product?.spec || '',
              // [2026-09-16] 从采购订单带入的行：带回商品自定义字段（行内「商品信息」小字）
              ext_fields: line.edges?.product?.ext_fields,
              unit_id: line.unit_id,
              unit_name: line.unit_name || line.edges?.unit?.name || '',
              quantity: remaining,
              cost_price: line.price || 0,
              amount: remaining * (line.price || 0),
              batch_no: line.batch_no || '',
              production_date: line.production_date || '',
              expiry_date: line.expiry_date || '',
            };
          })
          .filter((l: StockInLine) => (l.quantity || 0) > 0);
        setFormData(prev => ({
          ...prev,
          source_no: order.order_no,
          source_id: order.id,
          lines,
          total_amount: lines.reduce((sum, line) => sum + (line.amount || 0), 0),
          total_qty: lines.reduce((sum, line) => sum + (line.quantity || 0), 0),
        }));
      }
    } else if (formData.source_type === 'sales_return') {
      const ret = salesReturns.find(r => r.id === orderId);
      if (ret) {
        const retLines = ret.edges?.lines || ret.lines || [];
        const lines: StockInLine[] = retLines.map((line: any) => ({
          id: '',
          product_id: line.product_id,
          product_code: line.product_code || '',
          product_name: line.product_name || '',
          spec: line.spec || '',
          unit_id: line.unit_id,
          unit_name: line.unit_name || '',
          quantity: Number(line.quantity || 0),
          cost_price: Number(line.price) || 0,
          amount: Number(line.amount) || 0,
          batch_no: line.batch_no || '',
          production_date: line.production_date || '',
          expiry_date: line.expiry_date || '',
        }));
        setFormData(prev => ({
          ...prev,
          source_no: ret.order_no,
          source_id: ret.id,
          lines,
          total_amount: lines.reduce((sum, line) => sum + (line.amount || 0), 0),
          total_qty: lines.reduce((sum, line) => sum + (line.quantity || 0), 0),
        }));
      }
    }
  };

  const handleAddLine = () => {
    if (isEdit && formData.status === 'confirmed') return;
    const newLine: StockInLine = {
      id: '',
      product_id: '',
      product_code: '',
      product_name: '',
      spec: '',
      unit_id: '',
      unit_name: '',
      quantity: 1,
      cost_price: 0,
      amount: 0,
      batch_no: '',
      production_date: '',
      expiry_date: '',
      serial_nos: [],
    };
    setFormData(prev => ({
      ...prev,
      lines: [...(prev.lines || []), newLine],
    }));
  };

  // W-01：批量添加（规格矩阵 / 扫码共用）——同商品已在明细则数量累加，不产生重复行
  const handleBatchAdd = (adds: SpecBatchItem[]) => {
    if (isEdit && formData.status === 'confirmed') return;
    if (!adds.length) return;
    const productOf = new Map(adds.map((a) => [a.product.id, a.product]));
    const { lines, merged } = mergeAddsIntoLines(
      formData.lines || [],
      adds.map((a) => ({ productId: a.product.id, qty: a.qty })),
      (add) => {
        const p = productOf.get(add.productId)!;
        const qty = add.qty;
        return {
          id: '',
          product_id: p.id,
          product_code: p.code,
          product_name: p.name,
          spec: p.spec,
          unit_id: p.unit_id,
          unit_name: p.unit_name,
          quantity: qty,
          cost_price: Number(p.purchase_price) || 0,
          amount: qty * (Number(p.purchase_price) || 0),
          // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字）
          ext_fields: p.ext_fields,
          batch_no: '',
          production_date: '',
          expiry_date: '',
          serial_nos: [],
        };
      },
    );
    const totals = docLineTotals(lines);
    setFormData((prev) => ({ ...prev, lines, total_amount: totals.totalAmount, total_qty: totals.totalQty }));
    message.success(`已添加 ${adds.length} 个商品${merged ? `，其中 ${merged} 个累加到已有明细行` : ''}`);
  };

  // W-01：扫码/输码快速添加——条码/编码精确命中，连续扫码同一商品自动累加数量
  const handleScanDetect = async (code: string) => {
    if (isEdit && formData.status === 'confirmed') return;
    const raw = code.trim();
    setScanValue('');
    if (!raw) return;
    let match = matchProductByScan(products, raw);
    if (!match.hit && match.count === 0) {
      // 本地列表（1000 上限）未命中：按关键词回源查一次，支持大目录扫码
      try {
        const res = await productApi.list({ page: 1, page_size: 20, keyword: raw, status: 'active' });
        if (res.code === 0) match = matchProductByScan(res.data?.list || [], raw);
      } catch {
        /* 回源失败按未找到提示 */
      }
    }
    if (!match.hit) {
      message.warning(match.count > 1 ? `「${raw}」匹配到 ${match.count} 个商品，请扫条码或用编码精确录入` : `未找到商品：${raw}`);
      return;
    }
    handleBatchAdd([{ product: match.hit, qty: 1 }]);
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    if (isEdit && formData.status === 'confirmed') return;
    const newLines = [...(formData.lines || [])];
    newLines[index] = { ...newLines[index], [field]: value };
    
    if (field === 'product_id') {
      const product = products.find(p => p.id === value);
      if (product) {
        newLines[index].product_code = product.code;
        newLines[index].product_name = product.name;
        newLines[index].spec = product.spec;
        newLines[index].unit_id = product.unit_id;
        newLines[index].unit_name = product.unit_name;
        newLines[index].cost_price = product.purchase_price;
        // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字；保存后由商品边提供）
        newLines[index].ext_fields = product.ext_fields;
      }
    }
    
    // 数量/成本输入以字符串保留小数中间态；参与 + 求和处必须 Number() 化（避免字符串拼接）
    newLines[index].amount = (Number(newLines[index].quantity) || 0) * (Number(newLines[index].cost_price) || 0);
    
    const { totalAmount, totalQty } = docLineTotals(newLines);
    
    setFormData(prev => ({
      ...prev,
      lines: newLines,
      total_amount: totalAmount,
      total_qty: totalQty,
    }));
  };

  const handleRemoveLine = (index: number) => {
    if (isEdit && formData.status === 'confirmed') return;
    const newLines = [...(formData.lines || [])];
    newLines.splice(index, 1);
    const { totalAmount, totalQty } = docLineTotals(newLines);
    setFormData(prev => ({
      ...prev,
      lines: newLines,
      total_amount: totalAmount,
      total_qty: totalQty,
    }));
  };

  // ── 入库位置拍照记录（2026-09-14）────────────────────────────────────────
  // 草稿/新建：照片随「保存」整体提交（payload.photos）；已确认：走专属接口即时保存。
  const photoPayload = (p: PhotoDraft) => ({
    url: p.url,
    location_id: p.location_id || undefined,
    rack_id: p.rack_id || undefined,
    remark: p.remark || '',
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (files.length === 0) return;
    const remain = MAX_STOCKIN_PHOTOS - photos.length;
    if (remain <= 0) {
      message.warning(`单张入库单最多记录 ${MAX_STOCKIN_PHOTOS} 张照片，请先删除不再需要的记录`);
      return;
    }
    const picked = files.slice(0, remain);
    if (files.length > remain) message.warning(`最多还能记录 ${remain} 张，已忽略多余文件`);
    setPhotoUploading(true);
    try {
      const urls: string[] = [];
      for (const f of picked) {
        const fd = new FormData();
        fd.append('file', f);
        const res = await http.upload<{ url: string }>('/v1/upload/image', fd);
        if (res.code === 0 && res.data?.url) urls.push(res.data.url);
        else { message.error(res.message || '图片上传失败'); break; }
      }
      if (urls.length === 0) return;
      // 新照片默认带出单据库位/货架（单张可再改）
      const drafts: PhotoDraft[] = urls.map((url) => ({
        url,
        location_id: formData.location_id || '',
        rack_id: formData.rack_id || '',
        remark: '',
      }));
      if (isConfirmed && id) {
        // 已确认单据：直接入库（仅留档，不影响库存与单据状态）
        const res = await stockInApi.addPhotos(id, drafts.map(photoPayload));
        if (res.code === 0) {
          setPhotos((prev) => [...prev, ...((res.data || []) as any[]).map((p) => ({
            id: p.id,
            url: p.url,
            location_id: p.location_id || '',
            rack_id: p.rack_id || '',
            remark: p.remark || '',
            created_at: p.created_at,
          }))]);
          message.success(`已记录 ${urls.length} 张照片`);
        } else {
          message.error(res.message || '保存拍照记录失败');
        }
      } else {
        setPhotos((prev) => [...prev, ...drafts]);
        message.success(`已添加 ${urls.length} 张照片，保存入库单后生效`);
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '图片上传失败，请稍后重试');
    } finally {
      setPhotoUploading(false);
    }
  };

  // 确认态改元数据即时保存（草稿态仅改本地，随单保存）
  const persistPhotoMeta = async (photoId: string, next: PhotoDraft) => {
    if (!isConfirmed || !id || !photoId) return;
    const res = await stockInApi.updatePhoto(id, photoId, photoPayload(next));
    if (res.code !== 0) {
      message.error(res.message || '保存拍照记录失败');
      fetchDetail();
    }
  };

  const handlePhotoChange = (index: number, patch: Partial<PhotoDraft>, persist = true) => {
    const current = photos[index];
    if (!current) return;
    const next = { ...current, ...patch };
    setPhotos((prev) => prev.map((p, i) => (i === index ? next : p)));
    if (persist && next.id) void persistPhotoMeta(next.id, next);
  };

  const handleRemovePhoto = async (index: number) => {
    const photo = photos[index];
    if (!photo) return;
    if (photo.id && isConfirmed && id) {
      if (!(await confirmAction({ title: '确定删除这条拍照记录吗？', content: '删除后不再显示（后台留痕可追溯）', danger: true }))) return;
      const res = await stockInApi.deletePhoto(id, photo.id);
      if (res.code === 0) {
        setPhotos((prev) => prev.filter((_, i) => i !== index));
        message.success('已删除拍照记录');
      } else {
        message.error(res.message || '删除失败');
      }
    } else {
      setPhotos((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleConfirm = async () => {
    if (!id || !(await confirmAction({ title: '确定确认该入库单吗？', content: '确认后不可修改' }))) return;
    try {
      const res = await stockInApi.confirm(id);
      if (res.code === 0) {
        fetchDetail();
      }
    } catch (err) {
      console.error('Failed to confirm:', err);
      setError(err instanceof Error && err.message ? err.message : '确认失败');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit && formData.status === 'confirmed') return;
    setError('');
    if (!formData.warehouse_id) { setError('请选择仓库'); return; }
    // 退货类入库已由退货单审批自动回冲，禁止手工建单（防库存翻番双轨）
    if (formData.source_type === 'sales_return') {
      setError('销售退货已由退货单审批自动回冲入库，禁止手工建「退货入库」单，请删除本单或改用其他类型');
      return;
    }
    setLoading(true);
    try {
      const submitData = {
        type: formData.source_type || 'purchase',
        warehouse_id: formData.warehouse_id,
        location_id: formData.location_id || undefined,
        rack_id: formData.rack_id || undefined,
        stock_in_date: formData.stock_in_date || toLocalDateISO(format.today()),
        source_no: formData.source_no || '',
        source_id: formData.source_id || undefined,
        remark: formData.remark,
        // 拍照记录（2026-09-14）：草稿态随单整体提交；已确认后由专属接口维护
        photos: photos.map(photoPayload),
        lines: (formData.lines || []).map((line, index) => ({
          line_no: index + 1,
          product_id: line.product_id,
          unit_id: line.unit_id || null,
          product_name: line.product_name,
          product_code: line.product_code,
          qty: Number(line.quantity) || 0,
          unit_cost: Number(line.cost_price) || 0,
          batch_no: line.batch_no || '',
          serial_nos: cleanSerialNos(line.serial_nos),
          production_date: line.production_date || undefined,
          expiry_date: line.expiry_date || undefined,
          remark: '',
        })),
      };

      let response;
      if (isEdit) {
        response = await stockInApi.update(id, submitData);
      } else {
        response = await stockInApi.create(submitData);
      }
      if (response.code === 0) {
        navigate('/stock-in');
      }
    } catch (err) {
      console.error('Failed to save stock in:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  if (detailLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isConfirmed = isEdit && formData.status === 'confirmed';
  // 退货入库真实类型值为 sales_return（与 select option / 取数分支一致）
  const showSourceOrder = formData.source_type === 'purchase' || formData.source_type === 'sales_return';

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '入库单详情' : '新建入库单'}
        subtitle={isEdit ? '查看入库单详情' : '创建新的入库单'}
        onBack={() => navigate('/stock-in')}
        backDisabled={loading}
        extra={
          isConfirmed && (
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
              已确认
            </span>
          )
        }
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
            {isEdit && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">入库单号</label>
                <input
                  type="text"
                  value={formData.stock_in_no || ''}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">仓库 *</label>
              <SearchSelect
                required
                value={formData.warehouse_id}
                onChange={(v) => handleWarehouseChange(v ?? '')}
                placeholder="请选择仓库"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                disabled={isConfirmed}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">库位</label>
              <SearchSelect
                value={formData.location_id}
                onChange={(v) => setFormData(prev => ({ ...prev, location_id: v ?? '', rack_id: '' }))}
                placeholder="请选择库位"
                options={locations.filter(l => !formData.warehouse_id || l.warehouse_id === formData.warehouse_id).map((l) => ({ value: l.id, label: l.name }))}
                disabled={isConfirmed}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">货架</label>
              <SearchSelect
                value={formData.rack_id}
                onChange={(v) => setFormData(prev => ({ ...prev, rack_id: v ?? '' }))}
                placeholder="请选择货架"
                options={racks.filter(r => !formData.location_id || r.location_id === formData.location_id).map((r) => ({ value: r.id, label: r.name }))}
                disabled={isConfirmed}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">来源类型</label>
              <select
                value={formData.source_type || 'purchase'}
                onChange={(e) => handleSourceTypeChange(e.target.value)}
                disabled={isConfirmed}
                className="form-select"
              >
                <option value="purchase">采购入库</option>
                <option value="sales_return" disabled>退货入库（已停用：由退货单审批自动回冲入库）</option>
                <option value="production" disabled>生产入库（已停用：请使用「生产完工入库单」）</option>
                <option value="transfer" disabled>调拨入库（已停用：请使用「库存调拨单」）</option>
                <option value="opening">期初库存</option>
                <option value="manual">其他入库</option>
              </select>
            </div>
            {showSourceOrder && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {formData.source_type === 'purchase' ? '采购订单' : '退货单号'}
                </label>
                <SearchSelect
                  value={formData.source_id}
                  onChange={(v) => handleSourceOrderChange(v ?? '')}
                  placeholder="请选择"
                  options={
                    formData.source_type === 'purchase'
                      ? purchaseOrders.map((o) => ({ value: o.id, label: o.order_no }))
                      : formData.source_type === 'sales_return'
                        ? salesReturns.map((r) => ({ value: r.id, label: r.order_no }))
                        : []
                  }
                  disabled={isConfirmed}
                />
              </div>
            )}
            {showSourceOrder && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">来源单号</label>
                <input
                  type="text"
                  value={formData.source_no || ''}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">总数量</label>
              <input
                type="text"
                value={formData.total_qty || 0}
                disabled
                className="form-input bg-gray-50 text-gray-600"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">总金额</label>
              <input
                type="text"
                value={`¥${Number(formData.total_amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                disabled
                className="form-input bg-gray-50 text-gray-600"
              />
            </div>
            {isEdit && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
                <input
                  type="text"
                  value={formData.status === 'confirmed' ? '已确认' : '草稿'}
                  disabled
                  className="form-input bg-gray-50 text-gray-600"
                />
              </div>
            )}
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3">
              <h3 className="font-medium text-gray-700 whitespace-nowrap">入库明细</h3>
              {!isConfirmed && (
                <div className="w-full sm:max-w-xs">
                  <BarcodeInput
                    value={scanValue}
                    onChange={setScanValue}
                    onDetect={handleScanDetect}
                    placeholder="扫码/输码快速添加：条码 / 编码，回车"
                  />
                </div>
              )}
              {!isConfirmed && (
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSpecPickerOpen(true)}
                    className="btn-secondary text-sm flex items-center gap-1"
                    title="多规格商品：选款后在「颜色×尺码」网格里直接填数量，一次生成多条明细"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    按规格批量添加
                  </button>
                  <button type="button" onClick={handleAddLine} className="btn-secondary text-sm flex items-center gap-1">
                    <Plus className="w-4 h-4" />
                    添加商品
                  </button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">商品</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">规格</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">单位</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">成本价</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">数量</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">批次号</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">序列号（逗号分隔）</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">生产日期</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">到期日期</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">金额</th>
                    {!isConfirmed && (
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">操作</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(formData.lines || []).map((line, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3">
                        {isConfirmed ? (
                          <span className="text-gray-900">{line.product_code} - {line.product_name}</span>
                        ) : (
                          <SearchSelect
                            value={line.product_id}
                            onChange={(v) => handleLineChange(index, 'product_id', v ?? '')}
                            placeholder="请选择商品"
                            options={[
                              // 编辑态保留已删除/不在列表中的商品（原样展示，不可再改选别的值）
                              ...(!products.some((p) => p.id === line.product_id) && line.product_id
                                ? [{ value: line.product_id, label: `${line.product_code} - ${line.product_name || '已删除商品'}` }]
                                : []),
                              // 多规格 SKU 按款分组（叶子=规格（编码）），选规格不用再逐个对编码
                              ...productOptions,
                            ]}
                          />
                        )}
                        <LineProductExt line={line} labels={productLabels} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{line.spec || '-'}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{line.unit_name || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        {isConfirmed ? (
                          <span className="text-gray-900">¥{formatCurrency(line.cost_price)}</span>
                        ) : (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={line.cost_price ?? ''}
                            onChange={(e) => handleLineChange(index, 'cost_price', e.target.value)}
                            className="form-input text-right"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isConfirmed ? (
                          <span className="text-gray-900">{line.quantity}</span>
                        ) : (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={line.quantity ?? ''}
                            onChange={(e) => handleLineChange(index, 'quantity', e.target.value)}
                            className="form-input text-right"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isConfirmed ? (
                          <span className="text-gray-900 text-sm">{line.batch_no || '-'}</span>
                        ) : (
                          <input
                            type="text"
                            value={line.batch_no || ''}
                            onChange={(e) => handleLineChange(index, 'batch_no', e.target.value)}
                            className="form-input"
                            placeholder="批次号"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isConfirmed ? (
                          <span className="text-gray-500 text-sm">{(line.serial_nos || []).join(', ') || '-'}</span>
                        ) : (
                          <input
                            type="text"
                            value={(line.serial_nos || []).join(', ')}
                            onChange={(e) => handleLineChange(index, 'serial_nos', parseSerialNos(e.target.value))}
                            onBlur={(e) => handleLineChange(index, 'serial_nos', cleanSerialNos(parseSerialNos(e.target.value)))}
                            className="form-input"
                            placeholder="SN0001, SN0002"
                           autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isConfirmed ? (
                          <span className="text-gray-500 text-sm">{line.production_date ? line.production_date.slice(0, 10) : '-'}</span>
                        ) : (
                          <input
                            type="date"
                            value={line.production_date ? line.production_date.slice(0, 10) : ''}
                            onChange={(e) => handleLineChange(index, 'production_date', e.target.value)}
                            className="form-input"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isConfirmed ? (
                          <span className="text-gray-500 text-sm">{line.expiry_date ? line.expiry_date.slice(0, 10) : '-'}</span>
                        ) : (
                          <input
                            type="date"
                            value={line.expiry_date ? line.expiry_date.slice(0, 10) : ''}
                            onChange={(e) => handleLineChange(index, 'expiry_date', e.target.value)}
                            className="form-input"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">¥{formatCurrency(line.amount)}</td>
                      {!isConfirmed && (
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => handleRemoveLine(index)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {(!formData.lines || formData.lines.length === 0) && (
                    <tr><td colSpan={isConfirmed ? 10 : 11} className="px-4 py-8"><EmptyState title="暂无明细数据" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 入库位置拍照记录（2026-09-14）：记录货物实际存放位置（照片 + 库位/货架），方便查找与留档 */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-gray-700 flex items-center gap-1.5">
                <Camera className="w-4 h-4" />
                入库位置拍照记录
              </h3>
              <span className="text-xs text-gray-400">
                {isConfirmed
                  ? '确认后仍可补拍/修改（仅留档，不影响库存）'
                  : '可先拍照，保存入库单后生效'}
              </span>
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading || photos.length >= MAX_STOCKIN_PHOTOS}
                  className="btn-secondary text-sm flex items-center gap-1"
                  title={photos.length >= MAX_STOCKIN_PHOTOS ? `最多 ${MAX_STOCKIN_PHOTOS} 张` : '手机可直接拍照，或从相册选择'}
                >
                  {photoUploading ? (
                    <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4" />
                  )}
                  {photoUploading ? '上传中...' : '拍照 / 上传图片'}
                </button>
                <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} />
              </div>
            </div>
            <div className="p-4">
              {photos.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-400">
                  暂无拍照记录；点右上角「拍照 / 上传图片」记录货物存放位置（最多 {MAX_STOCKIN_PHOTOS} 张）
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {photos.map((photo, index) => (
                    <div key={photo.id || `${photo.url}-${index}`} className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="relative h-32 bg-gray-100">
                        <img
                          src={photo.url}
                          alt={`拍照记录 ${index + 1}`}
                          className="w-full h-full object-cover cursor-zoom-in"
                          onClick={() => setPreviewUrl(photo.url)}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemovePhoto(index)}
                          title="删除该拍照记录"
                          className="absolute top-2 right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="p-3 space-y-2">
                        <SearchSelect
                          value={photo.location_id}
                          onChange={(v) => handlePhotoChange(index, { location_id: v ?? '', rack_id: '' })}
                          placeholder="库位（默认=单据库位）"
                          options={locations.filter((l) => !formData.warehouse_id || l.warehouse_id === formData.warehouse_id).map((l) => ({ value: l.id, label: l.name }))}
                        />
                        <SearchSelect
                          value={photo.rack_id}
                          onChange={(v) => handlePhotoChange(index, { rack_id: v ?? '' })}
                          placeholder="货架"
                          options={racks.filter((r) => !photo.location_id || r.location_id === photo.location_id).map((r) => ({ value: r.id, label: r.name }))}
                        />
                        <input
                          type="text"
                          value={photo.remark}
                          onChange={(e) => handlePhotoChange(index, { remark: e.target.value }, false)}
                          onBlur={() => { const p = photos[index]; if (p?.id) void persistPhotoMeta(p.id, p); }}
                          placeholder="备注（如：A区第二排 / 托盘号）"
                          className="form-input text-sm"
                        />
                        {photo.created_at && (
                          <div className="text-[11px] text-gray-400">记录时间：{photo.created_at.slice(0, 16).replace('T', ' ')}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="form-actions">
            <button type="button" onClick={() => navigate('/stock-in')} className="btn-secondary">返回</button>
            {!isConfirmed && (
              <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                <Save className="w-5 h-5" />
                {loading ? '保存中...' : '保存'}
              </button>
            )}
            {isEdit && formData.status === 'draft' && (
              <button type="button" onClick={handleConfirm} className="btn-success flex items-center gap-2">
                <Check className="w-5 h-5" />
                确认
              </button>
            )}
          </div>
        </form>
      </div>

      {/* 拍照记录预览（点击缩略图） */}
      <Modal open={!!previewUrl} onCancel={() => setPreviewUrl('')} footer={null} centered title="拍照记录预览">
        {previewUrl && <img src={previewUrl} alt="拍照记录预览" className="w-full rounded-lg" />}
      </Modal>

      {/* W-01：多规格商品按款矩阵批量录入（入库：格子显示当前总在库） */}
      <MultiSpecPickerModal
        open={specPickerOpen}
        onClose={() => setSpecPickerOpen(false)}
        products={products}
        existingProductIds={(formData.lines || []).map((l) => l.product_id).filter(Boolean) as string[]}
        onConfirm={(items) => {
          handleBatchAdd(items);
          setSpecPickerOpen(false);
        }}
      />
    </div>
  );
}

function formatCurrency(value: number): string {
  return (value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
