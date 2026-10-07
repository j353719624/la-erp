/**
 * 人民币金额大写转换（正式单据打印「合计金额（大写）」用）
 * 例：1234.56 → 壹仟贰佰叁拾肆元伍角陆分；100 → 壹佰元整；0.05 → 伍分
 */
const CN_NUM = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const CN_UNIT = ['', '拾', '佰', '仟'];
const CN_GROUP = ['', '万', '亿', '万亿'];

/** 0~9999 一组转中文（前导零自然消失，内部零按中文习惯） */
function groupCn(n: number): string {
  if (n === 0) return '零';
  const s = String(n).padStart(4, '0');
  let out = '';
  for (let i = 0; i < 4; i++) {
    const d = Number(s[i]);
    if (d === 0) {
      if (out && !out.endsWith('零')) out += '零';
    } else {
      out += CN_NUM[d] + CN_UNIT[3 - i];
    }
  }
  return out.replace(/零+$/, '');
}

/** 正整数 → 中文（万/亿分级，段间零自动补） */
function intCn(x: number): string {
  if (x === 0) return '零';
  const groups: number[] = [];
  let v = x;
  while (v > 0) {
    groups.push(v % 10000);
    v = Math.floor(v / 10000);
  }
  let res = '';
  let pendingZero = false;
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) {
      pendingZero = true;
      continue;
    }
    if (res && !res.endsWith('零') && (pendingZero || g < 1000)) {
      res += '零';
    }
    res += groupCn(g) + CN_GROUP[i];
    pendingZero = false;
  }
  return res;
}

/** 人民币金额转中文大写；非数字返回空串 */
export function rmbUpper(amount: number | string | null | undefined): string {
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (num === null || num === undefined || isNaN(num) || !isFinite(num)) return '';

  const neg = num < 0;
  const abs = Math.abs(num);
  const intPart = Math.floor(abs);
  const frac = Math.round((abs - intPart) * 100);
  const jiao = Math.floor(frac / 10);
  const fen = frac % 10;
  const hasInt = intPart > 0;

  let res = '';
  if (hasInt) res = intCn(intPart) + '元';
  if (jiao === 0 && fen === 0) {
    res = res === '' ? '零元' : res;
    res += '整';
  } else if (jiao > 0) {
    res += CN_NUM[jiao] + '角';
    if (fen > 0) res += CN_NUM[fen] + '分';
  } else {
    // 无角有分：整数部分存在时中间补“零”（如 1.05 → 壹元零伍分）
    if (fen > 0) {
      if (hasInt) res += '零';
      res += CN_NUM[fen] + '分';
    }
  }
  return (neg ? '负' : '') + res;
}
