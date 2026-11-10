// Mẫu Workflow của FastAIVN (dựng từ các Flow App trên fastaivn.com).
// - Hieu POV AIO: chuyển từ app "Review POV AIO" (flow.google.com, https://fastaivn.com/flow-apps/u8xd)
//   Sơ đồ node đầy đủ: data/hieuPovAio.flow.json (sinh bằng gen_pov_aio.py) — nút 🧩 Sơ đồ mở đúng sơ đồ này.
import type { WorkflowTemplate } from '../types/workflow';

export const FASTAIVN_WORKFLOWS: WorkflowTemplate[] = [
  {
    id: 'fastaivn-hieu-pov-aio',
    name: 'Hieu POV AIO — Review sản phẩm góc nhìn thứ nhất',
    icon: '🤲',
    category: 'Review POV (FastAIVN)',
    description:
      '1 ảnh sản phẩm → AI nhận diện ngành hàng, viết 3 cảnh POV chỉ thấy đôi tay (khoe hộp → cận cảnh → trải nghiệm & chốt đơn), ' +
      'giọng đọc voice-over + tiếng ASMR, cùng 1 góc bàn → ghép ~30s. Hợp đồ ăn vặt, đặc sản, mỹ phẩm, gia dụng, đồ chơi.',
    builtin: true,
    scriptMode: 'pov_aff',
    extraNote:
      'Phong cách Hieu POV AIO: video POV dọc như người thật tự quay bằng điện thoại, CHỈ thấy đôi tay nữ người Việt (móng nude), không lộ mặt. ' +
      'Camera ngang tầm mắt người ngồi bàn nhìn chéo xuống 30–45°, rung tay nhẹ, có lúc đưa sát macro. ' +
      '3 cảnh: (1) HOOK – giơ hộp ngay ngắn trước ống kính + câu hook, đặt xuống mở nắp, khoe sản phẩm bên trong; ' +
      '(2) CẬN CẢNH – thao tác đặc trưng ngành hàng (đồ ăn: tách đôi, mật/sốt chảy; mỹ phẩm: bóp ra mu tay, miết chất kem; gia dụng: bật thử, cận cảnh hoạt động); ' +
      '(3) TRẢI NGHIỆM & CHỐT – đưa sản phẩm lại gần ống kính mời người xem, câu chốt "bấm giỏ hàng", 1 giây cuối giữ khung có sản phẩm + hộp. ' +
      'Lời thoại là voice-over giọng nữ trẻ miền Nam kiểu Gen Z ("cưng xỉu", "mấy bà"), kèm tiếng ASMR thật của thao tác; không nhạc nền, không phụ đề, không chữ trên hình. ' +
      'Sản phẩm giữ đúng 100% bao bì, chữ in, màu, số lượng; tả màu sản phẩm CHỈ theo ảnh (không thêm phấn trắng, nâu sẫm…). ' +
      'Hộp giữ thẳng, mặt in hướng ống kính, không xoay lật. Ánh sáng ban ngày trung tính, không tối.',
    sceneCount: 3,
    duration: 10,
    aspectRatio: '9:16',
    withDialogue: true,
    faceless: true,
    rotateProductImages: false,
    chainEndFrame: false,
    cameraMotion: '',
    autoMerge: true,
    refMode: 'reference',
    realismLock: true,
    setting:
      'Góc bàn làm việc phòng ngủ con gái nhìn chéo từ trên xuống: mặt bàn trắng trơn, đèn ngủ trụ chụp vải sáng vàng ấm bên trái, ' +
      'kệ pegboard trắng có bình thủy tinh và tượng thỏ nhỏ, tường kem dán poster hồng "FOCUS ON THE GOOD", ánh sáng ban ngày sáng trong.',
    flowGraphId: 'fastaivn-hieu-pov-aio',
    preview: { img: 'workflow-thumbs/fastaivn-hieu-pov-aio.jpg', video: 'workflow-thumbs/fastaivn-hieu-pov-aio.mp4' },
  },
];
