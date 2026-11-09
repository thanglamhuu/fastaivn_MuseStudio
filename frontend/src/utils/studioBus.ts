// Kênh nhắn giữa các tab (Thư viện media → màn hình Tạo video): dùng lại ảnh / khung hình.
export type StudioUseMessage =
  | { type: 'reference'; role: 'character' | 'outfit' | 'product'; dataUrl: string; name: string }
  | { type: 'pool'; dataUrl: string; name: string }
  | { type: 'startFrame'; sceneIndex: number; dataUrl: string; name: string };

const EVENT = 'museStudio:use';

export const sendToStudio = (msg: StudioUseMessage) => window.dispatchEvent(new CustomEvent(EVENT, { detail: msg }));

export const onStudioMessage = (fn: (msg: StudioUseMessage) => void) => {
  const handler = (e: Event) => fn((e as CustomEvent<StudioUseMessage>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
};
