import React from 'react';
import { MATRIX_12_VOICES, ResolvedVoice } from '../data/voicePresets';
import { MuseVoice } from '../services/museBatchService';

const selectCls =
  'w-full bg-slate-950 border border-white/5 text-[11px] text-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer';

/** Chọn hồ sơ giọng Matrix 12: nhóm Nam trước, nhóm Nữ sau. */
export const VoiceSelect: React.FC<{
  value: string;
  onChange: (id: string) => void;
  emptyLabel?: string;
  className?: string;
}> = ({ value, onChange, emptyLabel = '-- Chọn giọng --', className }) => (
  <select value={value || ''} onChange={(e) => onChange(e.target.value)} className={className || selectCls}>
    <option value="">{emptyLabel}</option>
    <optgroup label="Nam (Male)">
      {MATRIX_12_VOICES.filter((v) => v.gender === 'male').map((v) => (
        <option key={v.id} value={v.id}>
          {v.label} ({v.region})
        </option>
      ))}
    </optgroup>
    <optgroup label="Nữ (Female)">
      {MATRIX_12_VOICES.filter((v) => v.gender === 'female').map((v) => (
        <option key={v.id} value={v.id}>
          {v.label} ({v.region})
        </option>
      ))}
    </optgroup>
  </select>
);

/** Chọn giọng gốc trong thư viện của muse.ai (thay cho giọng gốc mặc định của hồ sơ). */
export const MuseVoiceSelect: React.FC<{
  voices: MuseVoice[];
  value: string;
  onChange: (id: string) => void;
  emptyLabel: string;
}> = ({ voices, value, onChange, emptyLabel }) => {
  const groups = new Map<string, MuseVoice[]>();
  // Giọng tiếng Việt lên đầu, rồi theo nhóm của Muse
  [...voices]
    .sort((a, b) => Number(b.group === 'vi_native') - Number(a.group === 'vi_native'))
    .forEach((v) => groups.set(v.group_label, [...(groups.get(v.group_label) || []), v]));
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      <option value="">{emptyLabel}</option>
      {[...groups.entries()].map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} · {v.gender === 'female' ? 'Nữ' : v.gender === 'male' ? 'Nam' : v.gender}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
};

/** Badge màu của giọng đang dùng (thẻ cảnh, thẻ nhân vật). Rê chuột xem chi tiết. */
export const VoiceBadge: React.FC<{ voice: ResolvedVoice; characterName?: string; compact?: boolean }> = ({
  voice,
  characterName,
  compact,
}) => {
  if (!voice.preset && !voice.museVoiceId) return null;
  const p = voice.preset;
  const title = p
    ? `${p.label}\n${p.subLabel}\nGiọng gốc Muse: ${voice.museVoiceName}\nTốc độ ${p.speed} · Cao độ ${p.pitch}\n${p.acousticProfile}`
    : `Giọng gốc Muse: ${voice.museVoiceName}`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 max-w-full truncate px-1.5 py-0.5 rounded border text-[10px] ${
        p ? p.badgeColor : 'bg-slate-800 text-slate-300 border-slate-700'
      }`}
    >
      🎙 {characterName ? `${characterName} · ` : ''}
      {p ? (compact ? p.label.replace(/^\d+\.\s*/, '') : p.label) : voice.museVoiceName}
    </span>
  );
};
