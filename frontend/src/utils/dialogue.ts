// Phân vai lời thoại nhiều nhân vật.
// muse.ai đặt MỘT giọng cho mỗi tài khoản, nên một clip chỉ giữ chắc được giọng của 1 người nói.
// Cách giữ đúng giọng từng người: tách cảnh nhiều người nói thành các shot, mỗi shot 1 người nói
// (tên người nói đứng đầu prompt => app dùng ảnh + giọng của họ), Gateway chuyển shot sang tài khoản
// đang dùng / dành riêng cho giọng đó.
import { StudioCharacter } from '../types/library';
import { buildVoiceInfo, resolveVoice } from '../data/voicePresets';

export interface DialogueTurn {
  speaker: StudioCharacter;
  text: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SPEECH_LEAD = /\s*(Nhân vật|nhân vật)?\s*nói bằng tiếng Việt,?\s*khẩu hình khớp lời:?\s*$/;

/** Tìm các lượt thoại dạng `Tên: "..."` / `Tên nói: ...` của nhân vật trong thư viện. */
export const parseDialogue = (
  line: string,
  characters: StudioCharacter[]
): { context: string; turns: DialogueTurn[] } => {
  const named = characters.filter((c) => c.name.trim());
  if (!named.length) return { context: line, turns: [] };
  const alt = named
    .map((c) => escape(c.name.trim()))
    .sort((a, b) => b.length - a.length)
    .join('|');
  const re = new RegExp(`(^|[\\s"“'(,.;])@?(${alt})(?:\\s+(?:nói|hỏi|đáp|thì thầm|hét))?\\s*:\\s*`, 'giu');
  const hits: { start: number; end: number; speaker: StudioCharacter }[] = [];
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const name = m[2].toLowerCase();
    const speaker = named.find((c) => c.name.trim().toLowerCase() === name)!;
    hits.push({ start: m.index + m[1].length, end: m.index + m[0].length, speaker });
  }
  if (!hits.length) return { context: line, turns: [] };
  const turns = hits
    .map((h, i) => ({
      speaker: h.speaker,
      text: line
        .slice(h.end, hits[i + 1]?.start ?? line.length)
        .replace(/^[\s"“”']+|[\s"“”']+$/g, '')
        .trim(),
    }))
    .filter((t) => t.text);
  const context = line
    .slice(0, hits[0].start)
    .replace(/["“”]\s*$/, '')
    .replace(SPEECH_LEAD, '')
    .trim()
    .replace(/[\s,;:.]+$/, '');
  return { context, turns };
};

/** Số người nói khác nhau trong 1 dòng prompt. */
export const speakerCount = (line: string, characters: StudioCharacter[]) =>
  new Set(parseDialogue(line, characters).turns.map((t) => t.speaker.id)).size;

/**
 * Tách 1 dòng có ≥ 2 người nói thành nhiều dòng, mỗi dòng 1 lượt thoại (người nói đứng đầu).
 * Dòng chỉ có 1 người nói (hoặc không có thoại) giữ nguyên.
 */
export const splitDialogueLine = (line: string, characters: StudioCharacter[]): string[] => {
  const { context, turns } = parseDialogue(line, characters);
  if (new Set(turns.map((t) => t.speaker.id)).size < 2) return [line];
  return turns.map((t) => {
    const listeners = [...new Set(turns.map((x) => x.speaker.name))].filter((n) => n !== t.speaker.name);
    const scene = context ? ` Bối cảnh: ${context}.` : '';
    return (
      `${t.speaker.name} nói bằng tiếng Việt, khẩu hình khớp lời: "${t.text.replace(/"/g, "'")}".` +
      `${scene} Camera tập trung vào ${t.speaker.name}${listeners.length ? `, ${listeners.join(', ')} lắng nghe và phản ứng` : ''}.`
    );
  });
};

export const splitDialogueText = (text: string, characters: StudioCharacter[]) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => splitDialogueLine(l, characters))
    .join('\n');

/**
 * Chỉ dẫn giọng cho cảnh có nhiều nhân vật (không tách): mỗi người một hồ sơ giọng.
 * Giọng gốc Muse của tài khoản vẫn là giọng của nhân vật chính của cảnh.
 */
export const multiVoiceInfo = (
  prompt: string,
  characters: StudioCharacter[],
  museNames: Record<string, string>
): string => {
  const { turns } = parseDialogue(prompt, characters);
  const speakers = [...new Map(turns.map((t) => [t.speaker.id, t.speaker])).values()];
  if (speakers.length < 2) return '';
  const parts = speakers.map((c) => {
    const info = buildVoiceInfo(resolveVoice(c.voicePresetId, c.museVoiceOverride, museNames), {
      emotion: c.emotion,
      characterName: c.name,
    });
    return info.replace(/^\[Voice Profile: /, `${c.name} → `).replace(/ Keep exactly this same voice in every shot\.\]$/, '');
  });
  return `[DIALOGUE VOICES: ${parts.join(' || ')}. Each character always keeps their own distinct voice.]`;
};
