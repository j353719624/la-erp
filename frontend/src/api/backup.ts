import { http } from '@/utils/request';

export interface BackupInfo {
  name: string;
  size: number;
  time: string;
}

export interface BackupSettings {
  auto: boolean; // 每日自动备份
  keep: number; // 自动备份保留份数
  dir: string; // 备份目录（空=默认数据目录/backups；建议不同物理盘/网络存储）
}

export const backupApi = {
  // 备份列表
  list: async () => {
    return http.get<BackupInfo[]>('/v1/backups');
  },

  // 手动备份
  create: async () => {
    return http.post<BackupInfo>('/v1/backups');
  },

  // 下载备份文件（blob）
  download: async (name: string): Promise<Blob> => {
    return http.download('/v1/backups/download', { name });
  },

  // 删除备份
  remove: async (name: string) => {
    return http.delete(`/v1/backups?name=${encodeURIComponent(name)}`);
  },

  // 恢复备份（排队，重启后生效）
  restore: async (name: string) => {
    return http.post<{ message: string }>('/v1/backups/restore', { name });
  },

  // 自动备份设置
  getSettings: async () => {
    return http.get<BackupSettings>('/v1/backups/settings');
  },

  updateSettings: async (settings: BackupSettings) => {
    return http.put<BackupSettings>('/v1/backups/settings', settings);
  },
};
