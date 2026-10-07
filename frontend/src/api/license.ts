import { http } from '@/utils/request';

export type LicenseStatus = 'disabled' | 'licensed' | 'trial' | 'denied';

export interface LicenseStatusInfo {
  /** 是否启用授权/试用校验（false=开发模式不限制） */
  enabled: boolean;
  /** 本机机器码（发给厂商换取授权文件） */
  machine_id: string;
  /** disabled=未启用 / licensed=已授权 / trial=试用中 / denied=拒绝 */
  status: LicenseStatus;
  /** 试用剩余天数（trial 时有值） */
  remaining_days: number;
  /** 授权到期时间（RFC3339，空=永久） */
  expires_at: string;
  /** 配置的试用期天数 */
  trial_days: number;
  /** 状态说明 */
  message: string;
}

export interface ActivateResult {
  activated: boolean;
  file: string;
  message: string;
}

export const licenseApi = {
  /** 查询授权状态（机器码 + 授权/试用/拒绝） */
  status: async () => {
    return http.get<LicenseStatusInfo>('/v1/license/status');
  },

  /** 上传授权文件（.key）在线激活 */
  activate: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return http.upload<ActivateResult>('/v1/license/activate', formData);
  },

  /** 粘贴授权内容在线激活 */
  activateByContent: async (content: string) => {
    return http.post<ActivateResult>('/v1/license/activate', { content });
  },
};
