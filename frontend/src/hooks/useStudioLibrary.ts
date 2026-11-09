import { useEffect, useMemo, useState } from 'react';
import { usePersistentState } from './usePersistentState';
import { StudioCharacter, StudioProduct } from '../types/library';
import { MuseVoice, listMuseVoices } from '../services/museBatchService';

/**
 * Thư viện Nhân vật + Sản phẩm (định nghĩa ở Cài đặt, dùng ở màn hình tạo video).
 * Lưu cả localStorage và trên Gateway (data/studio/state/) vì ảnh nhân vật khá nặng.
 */
export const useStudioLibrary = () => {
  const [characters, setCharacters] = usePersistentState<StudioCharacter[]>('characters.v1', [], {
    server: true,
  });
  const [products, setProducts] = usePersistentState<StudioProduct[]>('libraryProducts.v1', [], {
    server: true,
  });
  /** Thư viện giọng gốc của muse.ai (để chọn giọng thay thế cho nhân vật) */
  const [museVoices, setMuseVoices] = useState<MuseVoice[]>([]);

  useEffect(() => {
    listMuseVoices().then(setMuseVoices).catch(() => setMuseVoices([]));
  }, []);

  const museVoiceNames = useMemo(
    () => Object.fromEntries(museVoices.map((v) => [v.id, v.name])) as Record<string, string>,
    [museVoices]
  );

  return { characters, setCharacters, products, setProducts, museVoices, museVoiceNames };
};

export type StudioLibraryState = ReturnType<typeof useStudioLibrary>;
