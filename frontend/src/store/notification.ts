import { create } from 'zustand';
import { notificationApi } from '@/api/system';
import { NotificationItem } from '@/types/notification';

interface NotificationState {
  unreadCount: number;
  list: NotificationItem[];
  loading: boolean;
  refreshUnread: () => Promise<void>;
  fetchList: (params?: { page?: number; page_size?: number }) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unreadCount: 0,
  list: [],
  loading: false,

  refreshUnread: async () => {
    try {
      const res = await notificationApi.unreadCount();
      const count = res.data?.count ?? 0;
      if (get().unreadCount !== count) {
        set({ unreadCount: count });
      }
    } catch {
      // 静默失败，不打断界面
    }
  },

  fetchList: async (params) => {
    set({ loading: true });
    try {
      const res = await notificationApi.list({ page: params?.page ?? 1, page_size: params?.page_size ?? 8 });
      set({ list: res.data?.list ?? [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  markRead: async (id) => {
    await notificationApi.markRead(id);
    set((state) => ({
      list: state.list.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllRead: async () => {
    await notificationApi.markAllRead();
    set((state) => ({
      list: state.list.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    }));
  },
}));
