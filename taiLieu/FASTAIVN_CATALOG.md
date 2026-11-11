# Mẫu Workflow dùng chung — quản trị trên fastaivn.com (Giải pháp 2: catalog tĩnh)

```
fastaivn.com · trang "Quản trị mẫu Workflow" (admin)
   │ soạn / sửa / ẩn mẫu  →  Firestore  workflowTemplates/{id}   (BẢN NHÁP, chỉ admin đọc ghi)
   │ tải ảnh, video, sơ đồ →  Storage    workflows/thumbs|previews|graphs/…
   │ bấm 📢 "Xuất bản"
   ▼
workflows/catalog.v1.json   (1 file tĩnh, công khai, có lịch sử catalog.v1.<thời gian>.json để rollback)
   ▲
MuseStudio (app đóng gói) — GET qua Gateway /studio/catalog, lưu đệm trên máy, ETag; không cần Firebase SDK / key
```

## 1. Địa chỉ catalog

- Mặc định trong app: `https://fastaivn.com/workflows/catalog.v1.json` (`studio_catalog.py` → `DEFAULT_URL`).
- Đổi khi build: biến môi trường `MUSESTUDIO_CATALOG_URL`. Đổi khi chạy (staging, thử): `PUT /studio/catalog/config {"url": "..."}`.
- **Nên dùng Firebase Hosting** (tên miền fastaivn.com hoặc `templates.fastaivn.com`) → đường dẫn trong catalog được viết **tương đối**
  (`thumbs/a.jpg`). Nếu để trên Firebase **Storage**, đường dẫn Storage có `%2F` + `?alt=media` nên trong catalog phải ghi **URL tuyệt đối**
  (download URL) cho thumbnailUrl / previewUrl / graphUrl.
- Không cần cấu hình CORS: app tải catalog & sơ đồ qua Gateway (phía máy), ảnh / video chỉ hiển thị bằng `<img>` / `<video>`.

## 2. Định dạng `catalog.v1.json`

```jsonc
{
  "catalogVersion": 1,                       // đổi cấu trúc → xuất thêm catalog.v2.json, giữ v1 cho app cũ
  "publishedAt": "2026-11-10T10:00:34Z",
  "publishedBy": "admin@fastaivn.com",
  "templates": [
    {
      "id": "gia-dinh-linh-mit",             // ỔN ĐỊNH, a-z0-9-, không đổi giữa các phiên bản
      "version": 3,                          // tăng mỗi lần sửa sơ đồ
      "title": "Gia Đình Hài Hước (Linh Mít)",
      "description": "…",
      "category": "Gia đình",                // nhóm lọc trong app (trùng tên nhóm có sẵn thì gộp chung)
      "icon": "👨‍👩‍👧",
      "tags": ["family"],
      "sortOrder": 10,                        // nhỏ đứng trước
      "isPremium": false,                     // hiện nhãn PRO (chưa khóa — xem mục 6)
      "minAppVersion": "1.0.0",               // app cũ hơn sẽ ẩn mẫu và báo "cần bản app mới hơn"
      "published": true,                      // false = ẩn (dù có trong file)
      "thumbnailUrl": "thumbs/gia-dinh-linh-mit.jpg",       // 9:16, ~360×640 jpg
      "previewUrl": "previews/gia-dinh-linh-mit.mp4",       // 5–6s, 270×480, không tiếng, < 300 KB
      "graphUrl": "graphs/gia-dinh-linh-mit.v3.json",       // sơ đồ flow-workflow (Sơ đồ khối) — đặt tên kèm version để CDN không giữ bản cũ
      "bundleUrl": "bundles/gia-dinh-linh-mit.musestudio.json", // (tùy chọn) bộ workflow đầy đủ kèm nhân vật / sản phẩm — xem mục 6
      "trendUrl": "https://www.tiktok.com/…",               // video trend tham khảo (tùy chọn)
      "listTemplate": {                       // cấu hình cho màn "Mẫu & danh sách dòng" (tùy chọn)
        "scriptMode": "short_film",           // tvc5 | pov_aff | short_film | template
        "sceneCount": 3, "duration": 10, "aspectRatio": "9:16",
        "extraNote": "Hướng dẫn thêm cho AI viết kịch bản…",
        "withDialogue": true, "faceless": false,
        "outfit": { "description": "…" }, "setting": "Bối cảnh cố định…"
      }
    }
  ]
}
```

Ví dụ đầy đủ (3 mẫu + ảnh + video + sơ đồ): `D:\1FastAIVN\srcs\HNDWorkflow\fastaivn_catalog_mau\workflows\` — chép nguyên thư mục
`workflows/` vào `public/` của Firebase Hosting là chạy.

## 3. Gói mẫu xuất từ MuseStudio

Sơ đồ khối → **📤 Xuất mẫu cho fastaivn.com** → file `<id>.fastaivn-template.json`:

```jsonc
{
  "kind": "fastaivn-template", "packageVersion": 1,
  "entry": { "id", "version": 1, "title", "description", "category", "icon", "sortOrder", "isPremium", "minAppVersion", "trendUrl", "listTemplate" },
  "graph": { …flow-workflow, đã bỏ trạng thái chạy… },
  "thumbnailDataUrl": "data:image/jpeg;base64,…",   // cắt từ video kết quả (nếu đã chạy thử)
  "previewVideoPath": "C:\\Users\\…\\GHEP_3_CANH.mp4" // video trên máy để quản trị viên tải lên làm preview
}
```

## 4. Firestore + Storage (phía web)

```
workflowTemplates/{id}          // bản nháp: mọi trường của entry + graphStoragePath, updatedAt, updatedBy, status: "draft"|"ready"|"hidden"
catalogReleases/{releaseId}     // lịch sử xuất bản: publishedAt, publishedBy, templateIds[], storagePath  (để Rollback)
admins/{uid}                    // danh sách quản trị viên (hoặc dùng custom claim admin=true)
Storage: workflows/thumbs/{id}.jpg · workflows/previews/{id}.mp4 · workflows/graphs/{id}.v{version}.json
         workflows/catalog.v1.json · workflows/releases/catalog.v1.{timestamp}.json
```

### Security Rules

```js
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function isAdmin() { return request.auth != null && (request.auth.token.admin == true || exists(/databases/$(db)/documents/admins/$(request.auth.uid))); }
    match /workflowTemplates/{id} { allow read, write: if isAdmin(); }
    match /catalogReleases/{id}   { allow read, write: if isAdmin(); }
    match /admins/{uid}           { allow read: if request.auth != null && request.auth.uid == uid; allow write: if false; }
  }
}
// storage.rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /workflows/{all=**} {
      allow read: if true;                                   // app & người dùng đọc công khai
      allow write: if request.auth != null && request.auth.token.admin == true
                   && request.resource.size < 20 * 1024 * 1024;
    }
  }
}
```

Nếu dùng Firebase Hosting cho `catalog.v1.json`, thêm vào `firebase.json` để app luôn thấy bản mới (ETag vẫn tiết kiệm băng thông):

```json
{ "hosting": { "headers": [
  { "source": "/workflows/catalog.v*.json", "headers": [{ "key": "Cache-Control", "value": "public, max-age=60" }] },
  { "source": "/workflows/{thumbs,previews,graphs}/**", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
] } }
```
(Ảnh / video / sơ đồ nên đặt tên kèm version khi thay → cache vĩnh viễn an toàn.)

## 5. Prompt dán vào Google AI Studio (Build) để làm trang quản trị

> Thêm vào web fastaivn.com (đang dùng Firebase Auth + Firestore + Storage) một trang **/admin/workflow-templates** chỉ cho
> quản trị viên (custom claim `admin == true` hoặc có document `admins/{uid}`). Trang quản lý collection `workflowTemplates`
> theo đúng các trường: id (slug a-z0-9-, không sửa sau khi tạo), version (số, tự +1 khi thay sơ đồ), title, description, category,
> icon, tags[], sortOrder, isPremium, minAppVersion, status ("draft" | "ready" | "hidden"), thumbnailUrl, previewUrl, graphUrl,
> trendUrl, listTemplate {scriptMode, sceneCount, duration, aspectRatio, extraNote, withDialogue, faceless, outfit{description}, setting},
> updatedAt, updatedBy.
>
> Chức năng:
> 1. Lưới card 9:16 (thumbnail, rê chuột phát video preview), lọc theo category / status, tìm kiếm, kéo thả đổi sortOrder.
> 2. Form sửa mẫu; tải ảnh thumbnail (tự cắt 9:16, nén ~360×640 jpg) lên `workflows/thumbs/{id}.v{version}.jpg`,
>    video preview mp4 lên `workflows/previews/{id}.v{version}.mp4`, lưu download URL vào document.
> 3. Nút **"Nhập gói từ MuseStudio"**: đọc file `*.fastaivn-template.json` (kind = "fastaivn-template"); lấy `entry` điền form;
>    lưu `graph` thành `workflows/graphs/{id}.v{version}.json`; nếu có `thumbnailDataUrl` thì tải lên làm thumbnail.
>    Nếu id đã tồn tại thì hỏi "cập nhật phiên bản mới?" và tăng version.
> 4. Nút **"📢 Xuất bản"**: lấy mọi mẫu status = "ready", sắp theo sortOrder, tạo JSON
>    `{ catalogVersion: 1, publishedAt, publishedBy, templates: [...] }` (mỗi template gồm các trường ở trên + published: true,
>    bỏ status/updatedBy), tải lên `workflows/catalog.v1.json` (contentType application/json, cacheControl "public, max-age=60")
>    và bản lưu `workflows/releases/catalog.v1.{yyyyMMddHHmmss}.json`; ghi `catalogReleases/{id}`. Hiện xem trước JSON + số mẫu trước khi bấm xác nhận.
> 5. Tab **"Lịch sử xuất bản"**: danh sách catalogReleases, nút **Rollback** = chép bản release đó đè lên `workflows/catalog.v1.json`.
> 6. Kiểm tra trước khi xuất bản: id trùng, thiếu thumbnail / graphUrl, graph không có node `generate-video` → cảnh báo.
>
> Viết kèm `firestore.rules` và `storage.rules` như sau: (dán mục Security Rules ở trên).

## 6. Bộ workflow (.musestudio.json) — chuyển máy / chia sẻ / cài từ fastaivn.com

Màn 🧩 Workflow làm clip → **📤 Xuất bộ workflow** / **📥 Nhập bộ workflow** (có ở cả "Mẫu & danh sách dòng" và "Sơ đồ khối").

```jsonc
{
  "kind": "musestudio-workflow-bundle", "bundleVersion": 1,
  "name": "Bộ POV đồ ăn vặt", "description": "…", "exportedAt": "2026-11-11T09:45:05Z", "appVersion": "1.0.0",
  "templates":  [ /* mẫu "Mẫu & danh sách dòng" (WorkflowTemplate) */ ],
  "flows":      [ /* sơ đồ Sơ đồ khối (flow-workflow, đã bỏ trạng thái chạy) */ ],
  "characters": [ /* nhân vật Cài đặt mà mẫu / sơ đồ dùng (characterId, characterIds, @tên trong prompt) */ ],
  "products":   [ /* sản phẩm Cài đặt được dùng (productId, @@tên trong prompt) */ ]
}
```

- **Xuất:** chọn mẫu tự lưu + sơ đồ; tùy chọn kèm nhân vật / sản phẩm đang dùng. Ảnh trên Gateway / máy này (`http://127.0.0.1:18610/v1/media/…`)
  được **nhúng thành data URL**; ảnh đi kèm app (`workflow-thumbs/…`) giữ đường dẫn. Bỏ kết quả / khung hình / trạng thái lượt chạy.
- **Nhập:** từ file, link (tải qua Gateway `GET /studio/catalog/bundle?url=` — tới 80MB, có bản đệm khi mất mạng, link tương đối tính theo địa chỉ catalog)
  hoặc mục **🌐 Bộ workflow trên fastaivn.com**. Xem trước, tích chọn từng mục rồi nhập:
  mẫu / sơ đồ được **thêm mới** (id mới, trùng tên thì thêm "(nhập)"); nhân vật / sản phẩm **trùng tên dùng cái có sẵn**, chưa có thì thêm vào Cài đặt;
  `characterId` / `productId` / `characterIds` được nối lại theo id mới. Cũng nhận 1 sơ đồ JSON (MuseStudio / HND export) hay gói `fastaivn-template`.
- **Đăng lên fastaivn.com:** tải file lên `workflows/bundles/<id>.musestudio.json`, thêm `"bundleUrl": "bundles/<id>.musestudio.json"` vào mẫu trong
  `catalog.v1.json` → mẫu hiện trong 📥 Nhập bộ workflow → 🌐; nếu mẫu không có `graphUrl` thì 🧩 Sơ đồ trên card mở sơ đồ đầu tiên của bộ.
  Hoặc chỉ cần gửi link file cho người dùng dán vào ô link.

## 7. Hướng phát triển
- **Mẫu trả phí:** `isPremium` hiện chỉ gắn nhãn. Khi cần khóa thật: để `graphUrl` của mẫu PRO trỏ tới Cloud Function kiểm tra
  token đăng nhập fastaivn.com (Firebase Auth) rồi trả sơ đồ — app thêm bước đăng nhập (kết hợp Giải pháp 1 cho riêng mẫu PRO).
- Thống kê lượt dùng mẫu: app gửi sự kiện "dùng mẫu {id}" (tùy chọn, ẩn danh) tới 1 endpoint Firebase.
