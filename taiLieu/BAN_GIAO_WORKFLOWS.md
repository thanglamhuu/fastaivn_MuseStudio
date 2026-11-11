# Bàn giao phần Workflows — MuseStudio (11/11/2026)

Tài liệu để chuyển sang máy khác làm tiếp. Đọc kèm: `changeLog/261110*.md`, `changeLog/261111.md`, `taiLieu/FASTAIVN_CATALOG.md`.

## 1. Chuyển máy — mang theo gì

| Thứ cần mang | Ở đâu | Ghi chú |
|---|---|---|
| Mã nguồn | git `thanglamhuu/fastaivn_MuseStudio` | Commit mới nhất `a28a8ce Xuất / Nhập bộ workflow`. **Còn 2 file sửa dở chưa commit** (mục 5): `frontend/src/types/workflow.ts`, `frontend/src/services/nodeFlow/fromTemplate.ts` + thư mục mới `tools/workflow_lab/`, tài liệu này → commit trước khi chuyển. |
| Dữ liệu app (mẫu tự lưu, sơ đồ khối, nhân vật, sản phẩm, dòng đã chạy) | `data/studio/state/*.json` (không nằm trong git) | Cách gọn: mở app → 🧩 Workflow làm clip → **📤 Xuất bộ workflow** → máy mới **📥 Nhập bộ workflow**. Hoặc chép nguyên thư mục `data/studio/state`. |
| Tài khoản Muse, giọng | `data/` của gateway (accounts, cookie) | Đăng nhập lại trên máy mới (Cài đặt → Tài khoản Muse) — không chép cookie qua chat / git. |
| Kết quả thí nghiệm, báo cáo, video mẫu | `D:\1FastAIVN\srcs\HNDWorkflow\` | Chép cả thư mục nếu cần tra lại (xem mục 4). |
| Ảnh sản phẩm thử | `D:\1FastAIVN\srcs\TaiNguyen\` | Hồng treo gió VijiFarm: `TaiNguyen\HongTreoGio`. |

Chạy trên máy mới: `.venv\Scripts\python.exe gateway_server.py` (cổng 18610, key `m2a_secret_key`) + `cd frontend && npm run dev` (cổng 5173).
Dùng `.venv` của dự án (python hệ thống thiếu uvicorn).

## 2. Kiến trúc Workflows

```
🧩 Workflow làm clip
 ├─ 📋 Mẫu & danh sách dòng   (WorkflowStudio.tsx + WorkflowTemplateGallery.tsx)
 │    lưới card 9:16 (4/6 cột) · lọc theo nhóm · 🧩 Sơ đồ mở mẫu trong Sơ đồ khối
 │    nguồn mẫu = catalog fastaivn.com + FASTAIVN_WORKFLOWS + BUILTIN_WORKFLOWS (8) + HND_WORKFLOWS (13) + mẫu tự lưu
 ├─ 🧩 Sơ đồ khối (tự lắp)     (NodeFlowStudio.tsx — luôn mount, ẩn bằng CSS để không mất lượt chạy)
 │    12 node kiểu HND: Prompt, Upload Image, Gemini Script, Generate Image/Video, Upscale, Merge, Trích frame cuối, Xóa logo, Result
 └─ 📤 Xuất / 📥 Nhập bộ workflow (WorkflowBundleModal.tsx)
```

| File | Vai trò |
|---|---|
| `services/nodeFlow/definitions.ts` | Kiểu node, cổng, mặc định (R8: autoDescribe, imagePriority, keyframeFirst bật sẵn), khóa tham chiếu `RefLock` |
| `services/nodeFlow/runtime.ts` | Bộ chạy DAG: Upload Image (AI mô tả ảnh), Gemini Script (`scriptInstruction`, `parseScriptParts`, tự viết bù cảnh thiếu), Generate Video (ảnh khung hình trước, khóa ưu tiên ảnh + khóa SẢN PHẨM & BAO BÌ), hậu kỳ qua Gateway |
| `services/nodeFlow/flowIO.ts` | `parseFlowJson` (nhập HND / MuseStudio), `exportFlowJson`, `loadHndFlowTemplates` (mẫu FastAIVN + 13 HND), gói fastaivn-template |
| `services/nodeFlow/fromTemplate.ts` | Mẫu → sơ đồ: `flowGraph` nhúng → catalog `graphUrl`/`bundleUrl` → `flowGraphId`/`hnd` → dựng sơ đồ tương đương |
| `services/workflowBundle.ts` | Bộ `.musestudio.json`: `buildBundle` (nhúng ảnh Gateway thành data URL), `parseBundle`, `planImport` (id mới, nhân vật / sản phẩm trùng tên dùng lại, nối lại id), `fetchBundleFromUrl` |
| `services/templateCatalog.ts` + `studio_catalog.py` | Catalog fastaivn.com (catalog.v1.json, ETag, bản đệm), `/studio/catalog/graph`, `/studio/catalog/bundle` (80MB) |
| `hooks/usePersistentState.ts` | localStorage + Gateway `data/studio/state`. **Đã sửa 11/11:** chưa đọc xong Gateway thì không nâng mốc thời gian (trước đó bản cũ trong trình duyệt đè dữ liệu đã xóa) |
| `data/hieuPovAio.flow.json`, `data/fastaivnWorkflowTemplates.ts` | Mẫu Hieu POV AIO (sinh bằng `tools/workflow_lab/gen_pov_aio.py`) |
| `data/hndFlowTemplates.json`, `data/hndWorkflowTemplates.ts`, `public/workflow-thumbs/` | 13 mẫu HND + ảnh / video card |

## 3. Bài học giữ tham chiếu (đã đo, đưa vào mặc định)

- Muse **bám chữ hơn ảnh** → khóa "ưu tiên ảnh" cuối prompt + AI tả lại ảnh; không để chữ mô tả khác ảnh (vd. "phủ phấn trắng" làm hồng ra nâu sẫm).
- **Ảnh khung hình trước rồi mới video**: mặt Bố 6% → 93% (mẫu Gia đình). Nhưng muse.ai chỉ coi khung đầu là gợi ý — nhịp đầu prompt phải khớp ảnh.
- Tối đa **4 ảnh / video** (3 khi có khung đầu). Mặt phải to trong ảnh tham chiếu (ghép toàn thân + cận mặt).
- Bao bì: **không xoay / lật hộp**, mô tả vị trí hình in + chữ, giống nhau mọi cảnh (hộp VijiFarm: điểm khớp 11 → 454).
- Ánh sáng ban ngày trung tính; ảnh bối cảnh tối làm sản phẩm tối theo.
- Cảnh không có nhân vật: lệnh tạo khung hình không được đòi "nhìn rõ mặt" (gây lộ môi).

## 4. Tài liệu & kết quả (ngoài git, `D:\1FastAIVN\srcs\HNDWorkflow\`)

| Thư mục / file | Nội dung |
|---|---|
| `<13 mẫu HND>\`, `Prompt <tên>.md`, `BANG_MO_TA_WORKFLOW.md`, `PHAN_TICH_NODE_HND.md` | Chạy thử 13 mẫu HND, prompt thật gửi Muse, phân tích node |
| `HND worflows export\1_…3_` | Sơ đồ HND gốc / đã đồng bộ / sơ đồ thử đủ 12 node |
| `HND worflows export\4_thi_nghiem_dong_nhat\` | 9 lượt R1–R8 mẫu Gia đình (khuôn mặt, trang phục, sản phẩm) |
| `HND worflows export\5_hieu_pov_aio\` | Phân tích app POV AIO (Flow), 3 lần chạy thử |
| `HND worflows export\6_pov_giu_bao_bi_mau\` | Thí nghiệm giữ bao bì + màu (V0–V4), `BAO_CAO_GIU_BAO_BI_MAU.md` |
| `BaoCao_DongNhat_Muse\…v2.docx` | Báo cáo Word giữ đồng nhất (13 trang) |
| `HuongDan_POV_HongTreoGio\…docx` | Hướng dẫn làm tay video POV Hồng treo gió (11 trang) |
| `fastaivn_catalog_mau\workflows\` | Catalog mẫu để chép lên Firebase Hosting |

## 5. Đang làm dở — xuất cả 22 mẫu có sẵn

Yêu cầu: hộp **📤 Xuất bộ workflow** đang chỉ liệt kê mẫu tự lưu (0) + sơ đồ khối (1); cần liệt kê **cả 22 mẫu có sẵn** (8 MuseStudio + 13 HND + Hieu POV AIO, cộng mẫu catalog nếu có), mặc định chọn hết.

Đã làm (chưa commit, đã qua `tsc`):
- `types/workflow.ts`: thêm `flowGraph?: unknown` — sơ đồ nhúng trong mẫu.
- `fromTemplate.ts`: `templateToFlow` ưu tiên `tpl.flowGraph` (mẫu nhập từ bộ mở đúng sơ đồ nhúng).

Còn lại:
1. `WorkflowBundleModal.tsx`: thêm prop `builtinTemplates` (= `allTemplates` trừ mẫu tự lưu, truyền từ `WorkflowStudio.tsx`), nhóm **📚 Mẫu có sẵn (22)** có "Chọn hết / Bỏ hết", mặc định chọn hết; danh sách cuộn (max-h).
2. `workflowBundle.ts → buildBundle`: mẫu có sẵn → `flowGraph = (await templateToFlow(t)).workflow` (bỏ RUN_KEYS, nhúng ảnh); **nhúng cả ảnh đường dẫn tương đối** `workflow-thumbs/…` (fetch theo `location`) để máy app cũ vẫn có ảnh bàn POV; giữ `id` gốc để nhận diện khi nhập. `referencedLibrary` duyệt thêm node trong `flowGraph`.
3. `planImport`: nhận thêm danh sách mẫu đang có (gồm mẫu có sẵn); mẫu trùng `id` với mẫu có sẵn ở máy nhận → **bỏ qua** (ghi "đã có sẵn"), khác thì thêm thành mẫu tự lưu (id mới, tên "(nhập)").
4. Thử: xuất 22 mẫu + 1 sơ đồ → nhập lại máy này (22 bỏ qua, 0 trùng) → nhập vào "máy mới" giả lập (`planImport` với danh sách rỗng) → 🧩 Sơ đồ một mẫu nhập → "✓ Sơ đồ hợp lệ".
5. Cập nhật `changeLog/261111.md`, `FASTAIVN_CATALOG.md` mục 6.

## 6. Việc khác còn mở

- Kiểm tra API `/studio/catalog/bundle` trên Gateway thật sau khi khởi động lại (đã thử riêng bằng TestClient: `tools/workflow_lab/test_bundle_endpoint.py`).
- Chưa chạy lại trên Muse một sơ đồ vừa nhập từ bộ (mới kiểm tra "Sơ đồ hợp lệ").
- Danh mục mẫu fastaivn.com (Giải pháp 2): **tạm dừng** — chưa có trang quản trị, `catalog.v1.json` trên web đang 404.
- Video vẫn tối hơn ảnh sản phẩm ~50–60 độ sáng khi dùng ảnh bàn chụp tối → cân nhắc thay ảnh bàn ban ngày cho mẫu Hieu POV AIO.

## 7. Công cụ thí nghiệm — `tools/workflow_lab/`

Chép từ thư mục tạm của phiên làm việc (đường dẫn trong script trỏ máy cũ — sửa lại trước khi chạy).

| Script | Dùng để |
|---|---|
| `run_flow.ts` | Chạy 1 sơ đồ flow-workflow bằng đúng runtime của app, ngoài trình duyệt. Build: `node node_modules/esbuild/bin/esbuild <run_flow.ts> --bundle --platform=node --format=cjs --outfile=run_flow.cjs "--define:import.meta.env={}"` (chạy trong `frontend/`), rồi `node run_flow.cjs <file.json> [luồng]`; `*.result.json` = chạy tiếp |
| `gen_pov_aio.py` | Sinh `data/hieuPovAio.flow.json` (Brief POV AIO) |
| `pov_metrics.py`, `compare_sheet.py`, `face_score.py`, `eval_exp.py` | Đo bao bì (SIFT) / màu / khuôn mặt (OpenCV YuNet + SFace), ảnh so sánh |
| `make_pov_exps.py`, `make_family_exps.py`, `prep_pov_*.py`, `fetch_exp_videos.py`, `save_keyframes.py` | Dựng & tải kết quả thí nghiệm |
| `inventory_templates.py`, `inventory_diff.py`, `prune_templates.py`, `dump_user_flow.py` | Kiểm kê / lọc mẫu, đọc prompt thực tế của lượt chạy |
| `test_bundle_endpoint.py` | Thử API tải bộ workflow |
| `make_report_docx.py`, `make_guide_pov_docx.py` | Sinh 2 file Word (python-docx) |
| `transcribe.py` | Chép lời thoại video (faster-whisper, đọc WAV) |
| `gen_hnd_templates.py`, `gen_flow_json.py`, `export_hnd.py`, `run_hnd_workflows.py`, `make_reports.py`, `make_thumbs.py`, `make_sample_catalog.py` | Chuyển 13 mẫu HND, ảnh card, catalog mẫu |

Môi trường Python thí nghiệm (venv riêng, không nằm trong dự án): `opencv-python opencv-contrib-python numpy python-docx pymupdf faster-whisper`;
model nhận diện mặt YuNet / SFace tải từ opencv_zoo.
