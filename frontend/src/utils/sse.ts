/**
 * SSE 客户端（fetch + ReadableStream，可携带 Authorization header）
 * 用于老板看板实时推送等服务器→浏览器单向流
 * 支持断线自动重连（指数退避：3s → 6s → 12s → ... → 上限 60s）
 */
import { storage } from './storage';

export interface SSEHandlers {
  onMessage: (data: any) => void;
  onError?: (err: any) => void;
}

/**
 * 建立 SSE 连接并返回断开函数
 * @param url  完整 API URL（不含 baseURL，走相对路径即可）
 * @param token 认证 token（Bearer）
 * @param handlers 消息/错误回调
 * @param options 可选：maxRetries（-1 表示无限重试，默认无限）
 */
export function connectSSE(url: string, token: string, handlers: SSEHandlers, options?: { maxRetries?: number }): () => void {
  const maxRetries = options?.maxRetries ?? -1;
  const controller = new AbortController();
  let stopped = false;
  let retryCount = 0;

  const connect = async () => {
    if (stopped) return;
    try {
      // 每次连接读取最新 token（access 刷新后重连仍有效）
      const currentToken = storage.getToken() || token;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${currentToken}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`SSE 连接失败: ${res.status}`);
      }
      retryCount = 0; // 成功建立连接后重置重试计数
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data:')) {
              const payload = line.slice(5).trim();
              if (payload) {
                try {
                  handlers.onMessage(JSON.parse(payload));
                } catch {
                  // 忽略非 JSON 事件
                }
              }
            }
          }
        }
      }
      // 服务端正常关闭流（如服务重启）→ 自动重连；主动 disconnect 由 stopped 拦截
      if (!stopped) {
        scheduleReconnect();
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || stopped) return;
      handlers.onError?.(err);
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    if (maxRetries >= 0 && retryCount >= maxRetries) return;
    const delay = Math.min(3000 * Math.pow(2, retryCount), 60000);
    retryCount++;
    setTimeout(() => {
      if (!stopped) connect();
    }, delay);
  };

  connect();

  return () => {
    stopped = true;
    controller.abort();
  };
}
