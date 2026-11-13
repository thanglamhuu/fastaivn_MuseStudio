# Bàn giao sang phiên chat mới (13/11/2026)

Đọc hết file này trước khi làm. Trả lời người dùng bằng tiếng Việt.

## Việc cần làm

Nghiên cứu video https://www.youtube.com/watch?v=MYlKiqcA1Qo (và kênh của nó nếu cần) rồi thêm một mẫu workflow mới cho dạng video đó, theo đúng quy trình đã làm với mẫu "Phim Drama Gia Đình":

1. Nghiên cứu video: thể loại, độ dài, số cảnh, nhịp kể, kiểu thoại, bối cảnh, số nhân vật. Chỉ học CẤU TRÚC, không chép kịch bản, tên, nhân vật.
2. Viết phân tích vào `taiLieu/PHAN_TICH_<ten>.md`.
3. Thêm mẫu vào `frontend/src/data/workflowTemplates.ts` (xem mẫu `wf-phim-drama-gia-dinh` làm chuẩn).
4. Nếu cần nhân vật mới: tạo trong Cài đặt → Nhân vật (state `characters.v1`, qua `PUT /studio/state/characters.v1`).
5. Chạy thử thật một lượt, chấm điểm, cải tiến workflow, chạy lại đến khi đạt.
6. Đóng gói mẫu chuẩn + thumb + json vào `E:\1FastAIVN\Srcs\TestWorkFlow\LamPhim\<Tên mẫu>\`.
7. Làm thêm một lượt mới trong lúc soạn HDSD (PDF + MP4) vào `TestWorkFlow\HuongDanSuDung`.
8. Cập nhật `changeLog/261111_KmdPc.md` (mục tiếp theo là 36), rồi commit + push khi người dùng yêu cầu.

Nếu người dùng chưa nói rõ phạm vi, hỏi họ một câu rồi làm.

## Dự án

- Gốc: `E:\1FastAIVN\Srcs\MuseStudio` — frontend React/Vite (cổng 5173), Gateway Python FastAPI (cổng 18610, header key `m2a_secret_key`), muse2api vendored, Chrome qua CDP.
- Người dùng tự chạy `run_dev.bat`. KHÔNG tự bật Gateway/Vite trên 18610/5173 rồi bỏ đó.
- Thư mục anh em: `TestWorkFlow`, `Đóng Gói App`, `TaiNguyen`, `ToolLN`.

## File chính

- `frontend/src/data/workflowTemplates.ts` — `BUILTIN_WORKFLOWS`. Mẫu drama: category 'Câu chuyện', `noProduct: true`, `characterIds: ['', '', '']`, 6 cảnh × 10 giây, công thức ghi trong idea dạng "CÔNG THỨC" + "CẢNH n".
- `frontend/src/types/workflow.ts` — kiểu mẫu (`backdrop?`, `noProduct?`, `customized?`).
- `frontend/src/services/nodeFlow/fromTemplate.ts` — dựng sơ đồ khối từ mẫu.
- `frontend/src/services/nodeFlow/runtime.ts` — chạy sơ đồ: công thức riêng của mẫu được ưu tiên (`ownFormula`), `speakerOf`, giọng theo người nói, chỉ gửi ảnh nhân vật có mặt trong cảnh, tự kiểm giọng (`/studio/qc/voice`, tối đa 2 lần tạo lại).
- `frontend/src/services/nodeFlow/definitions.ts` — định nghĩa node.
- `frontend/src/data/backdropPresets.ts`, `productPhysics.ts` — thư viện bối cảnh, luật sản phẩm, luật không giá.
- `wfthumb/wfthumb.config.json` — thumb của card mẫu (hiện 28 mẫu).
- `taiLieu/PHAN_TICH_PHIM_DRAMA_GIA_DINH.md` — bài phân tích mẫu để làm theo.
- `TestWorkFlow/LamPhim/Phim Drama Gia Đình/DOC_TRUOC.md` — cấu trúc thư mục đóng gói mẫu để làm theo.

## Công cụ chạy thử không cần giao diện

- `TestWorkFlow/_tools/run_wf.ts` — chạy runtime headless. Bundle bằng esbuild với `--define:import.meta.env={}`; đặt `library.json` (nhân vật, sản phẩm) cạnh file bundle.
- `TestWorkFlow/_tools/eval_wf.py` — chấm điểm: mặt (YuNet/SFace same_rate), sản phẩm (SIFT), lời thoại (whisper). Dùng môi trường `.labenv`.
- `TestWorkFlow/_tools/session_tools/` — bản sao script của phiên trước:
  - `drama/make_chars.py` (tạo nhân vật), `drama/prep_drama.ts` (dựng flow từ mẫu), `drama/pack_drama.ts` (đóng gói `.musestudio.json`), `drama/shoot_drama.py` (chụp màn hình app qua CDP), `drama/build_guide_drama.py` (dựng HDSD html → PDF bằng Chrome `--print-to-pdf`, MP4 bằng ffmpeg).
  - `guide/shoot.py`, `guide/build_guide.py`, `guide/build_guide_kho.py`.
  - Các script này có đường dẫn cứng tới scratchpad cũ: sửa đường dẫn trước khi chạy.

## Bài học đã rút ra

- Heredoc trong Bash hay vỡ vì dấu nháy/backslash → viết script ra file rồi chạy.
- Sửa file frontend xong phải kiểm tra Vite phục vụ đúng (curl `http://localhost:5173/src/...`, xem kích thước). Từng bị trang trắng vì Vite đọc file lúc đang ghi; `touch` lại file là hết.
- Dùng `ffmpeg` (không ghi đường dẫn đầy đủ) trong bash; tách khung hình bằng cv2.
- Clip tạo lại (`canh_04_lan*.mp4`) phải dời sang `canh_loi/` trước khi chấm điểm.
- Mỗi cảnh chỉ MỘT người nói, không thêm người lạ, không chữ/logo trên màn hình thiết bị — nếu không Muse lẫn giọng và vẽ chữ vô nghĩa.
- Kiểm giọng tự động chỉ bắt lỗi sai giới tính, không bắt lỗi phát âm.
- Video HDSD là slide có chú thích + clip kết quả, không phải quay màn hình liên tục.

## Ràng buộc bắt buộc

- Không đóng gói/chia sẻ: `accounts.json`, `ai_config.json`, `tmpacc.k`, profile đăng nhập, `requests.db`, `seen_media`.
- Không tự nhập OTP/mật khẩu, không tạo tài khoản, không giải CAPTCHA — người dùng tự làm trong app.
- Email người dùng và email tài khoản Muse là riêng tư: che trong ảnh chụp và tài liệu.
- Không đưa giá vào thông tin sản phẩm hay kịch bản.
- Chỉ commit/push khi người dùng yêu cầu. Không commit `frontend/yarn.lock`.
- Dòng cuối commit: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Trạng thái hiện tại

- Commit mới nhất trên `master`: `f892615` (mẫu Phim Drama Gia Đình + giọng theo người nói + tự kiểm giọng).
- Nhân vật có sẵn trong Cài đặt: ThuHa (`char_drama_thuha`), MinhKhang (`char_drama_minhkhang`), BaLien (`char_drama_balien`), cùng các nhân vật cũ của người dùng.
- Việc còn treo, chưa được người dùng trả lời:
  - Gói bàn giao `Đóng Gói App\MuseVideoStudio_20261113.zip` là bản build cũ (trước mẫu drama, kiểm giọng, nút ✂️ tách sản phẩm). Build lại bằng `MuseVideoStudio.spec` + `tools/package_release.py` nếu người dùng muốn.
  - Thêm danh sách mẫu ẩn + phần sửa mẫu vào `DuLieuMau`.
  - Bộ slide bán app (https://claude.ai/artifact/JU2YqD5va7hsStr2PHaHAL) chưa được rà lại bố cục; giá/ưu đãi còn để `[…]`.
