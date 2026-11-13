// Thư viện bối cảnh dùng chung: kho, xưởng, cửa hàng lớn, đóng gói / giao hàng, chợ / sạp.
// Dùng ở: ô "Bối cảnh cố định" của mẫu Workflow, node Prompt (chèn bối cảnh) và node 🏭 Tạo bối cảnh.
// vi = câu mô tả cho kịch bản / bối cảnh cố định; en = mô tả không gian cho prompt ảnh (ánh sáng, đạo cụ);
// stock = cách CHÍNH sản phẩm của video được bày trong bối cảnh này (node Tạo bối cảnh dùng khi "xếp đầy sản phẩm").

export interface BackdropPreset {
  id: string;
  group: string;
  name: string;
  vi: string;
  en: string;
  stock: string;
}

export const BACKDROP_GROUPS = ['Kho hàng', 'Xưởng sản xuất', 'Cửa hàng lớn', 'Đóng gói & giao hàng', 'Chợ & sạp', 'Nhà & văn phòng'] as const;

export const BACKDROP_PRESETS: BackdropPreset[] = [
  // ---------------- Kho hàng ----------------
  {
    id: 'kho-tong',
    group: 'Kho hàng',
    name: 'Kho tổng kệ kim loại cao',
    vi: 'Kho hàng tổng rộng lớn, giá kệ kim loại nhiều tầng cao tới trần, lối đi sơn vạch vàng, đèn trần công nghiệp',
    en: 'vast distribution warehouse, tall multi-level steel pallet racking up to the ceiling, yellow painted floor lanes, bright industrial high-bay lights, slight depth haze',
    stock: 'the racks are densely stocked with many identical units of the product and its retail boxes, row after row',
  },
  {
    id: 'kho-carton',
    group: 'Kho hàng',
    name: 'Kho thành phẩm thùng carton',
    vi: 'Kho thành phẩm, thùng carton xếp chồng ngăn nắp thành từng khối cao, dán tem mã vạch',
    en: 'finished-goods warehouse, neat tall stacks of brown shipping cartons with barcode labels, clean concrete floor, soft overhead lighting',
    stock: 'cartons printed with the product picture, a few opened boxes showing the product inside, several units displayed on top of the stacks',
  },
  {
    id: 'kho-pallet',
    group: 'Kho hàng',
    name: 'Kho pallet + xe nâng',
    vi: 'Kho pallet gỗ chất đầy hàng bọc màng co, xe nâng hàng đậu phía sau, cửa cuốn kho mở',
    en: 'pallet warehouse, wooden pallets loaded with shrink-wrapped goods, a parked forklift in the background, open rolling loading-bay door with daylight',
    stock: 'pallets fully loaded with the product boxes wrapped in clear stretch film',
  },
  {
    id: 'kho-ke-nho',
    group: 'Kho hàng',
    name: 'Kho kệ nhỏ shop online',
    vi: 'Kho shop online cỡ vừa, kệ sắt V lỗ nhiều tầng, hộp nhựa phân loại dán nhãn, đèn tuýp sáng trắng',
    en: 'mid-size e-commerce stockroom, slotted angle steel shelves, labeled plastic bins, bright white fluorescent tube lights, busy but tidy',
    stock: 'shelves and bins filled with the product in its packaging, sorted by color / variant',
  },
  {
    id: 'kho-lanh',
    group: 'Kho hàng',
    name: 'Kho mát / kho lạnh',
    vi: 'Kho mát sạch sẽ, tường panel trắng, rèm nhựa cửa kho, kệ inox, ánh sáng lạnh',
    en: 'clean cold-storage room, white insulated panel walls, PVC strip curtain door, stainless steel shelving, cool white light, faint cold mist',
    stock: 'stainless shelves stocked with the product neatly in rows',
  },
  {
    id: 'kho-dem',
    group: 'Kho hàng',
    name: 'Kho buổi tối nhập hàng',
    vi: 'Kho buổi tối đang nhập hàng, đèn vàng ấm, thùng hàng mới về chất cao, không khí tất bật',
    en: 'warehouse at night during restocking, warm tungsten work lights, freshly delivered boxes piled high, busy atmosphere, cinematic contrast',
    stock: 'newly arrived boxes of the product stacked high, some opened',
  },
  // ---------------- Xưởng sản xuất ----------------
  {
    id: 'xuong-day-chuyen',
    group: 'Xưởng sản xuất',
    name: 'Dây chuyền sản xuất tự động',
    vi: 'Xưởng có dây chuyền máy móc sản xuất tự động hiện đại, băng chuyền chạy, tay máy, đèn sáng',
    en: 'modern automated factory production line, moving conveyor belts, robotic arms, clean epoxy floor, bright even factory lighting',
    stock: 'many identical units of the product moving along the conveyor belt',
  },
  {
    id: 'xuong-kiem-dinh',
    group: 'Xưởng sản xuất',
    name: 'Khu kiểm định chất lượng',
    vi: 'Khu kiểm định chất lượng xuất xưởng, bàn kiểm tra phủ đèn, thước đo, bảng QC treo tường',
    en: 'quality-control inspection area, inspection table under bright lamps, measuring tools, QC checklist board on the wall',
    stock: 'rows of the product lined up on the inspection table with green PASS tags',
  },
  {
    id: 'xuong-gia-cong',
    group: 'Xưởng sản xuất',
    name: 'Xưởng gia công cơ khí',
    vi: 'Xưởng đúc và gia công chi tiết cơ khí, máy CNC, phôi kim loại, tia lửa nhỏ phía xa',
    en: 'metal machining workshop, CNC machines, metal stock, distant welding sparks, gritty industrial texture, warm practical lights',
    stock: 'finished units of the product arranged on a steel workbench and in metal crates',
  },
  {
    id: 'xuong-may',
    group: 'Xưởng sản xuất',
    name: 'Xưởng may',
    vi: 'Xưởng may rộng, nhiều dãy máy may công nghiệp, cuộn vải, bàn cắt vải lớn',
    en: 'large garment factory, rows of industrial sewing machines, fabric rolls, big cutting tables, bright daylight from high windows',
    stock: 'stacks of the finished product folded on the tables and hanging on rails',
  },
  {
    id: 'xuong-nhua',
    group: 'Xưởng sản xuất',
    name: 'Xưởng ép nhựa / gia dụng',
    vi: 'Xưởng ép nhựa gia dụng, máy ép lớn, sọt hàng thành phẩm, công nhân đồng phục phía xa',
    en: 'plastic injection molding factory for household goods, large molding machines, bins of finished parts, uniformed workers in the far background',
    stock: 'big bins and trays overflowing with the finished product',
  },
  {
    id: 'xuong-thuc-pham',
    group: 'Xưởng sản xuất',
    name: 'Xưởng thực phẩm sạch',
    vi: 'Xưởng chế biến thực phẩm sạch, inox sáng bóng, công nhân đội mũ trùm đeo khẩu trang phía xa',
    en: 'hygienic food-processing facility, shiny stainless steel equipment, workers in hairnets and masks in the far background, bright clean light',
    stock: 'the packaged product coming off the line and stacked in clean crates',
  },
  {
    id: 'xuong-thu-cong',
    group: 'Xưởng sản xuất',
    name: 'Xưởng thủ công gia đình',
    vi: 'Xưởng thủ công gia đình, bàn gỗ lớn, dụng cụ treo tường, ánh nắng qua cửa sổ',
    en: 'family-run handcraft workshop, big wooden workbench, tools hanging on the wall, warm sunlight through the window, authentic Vietnamese feel',
    stock: 'handmade units of the product laid out on the workbench and shelves',
  },
  // ---------------- Cửa hàng lớn ----------------
  {
    id: 'sieu-thi-dien-may',
    group: 'Cửa hàng lớn',
    name: 'Siêu thị điện máy',
    vi: 'Siêu thị điện máy lớn, dãy kệ trưng bày sáng đèn, biển giá khuyến mãi, sàn bóng',
    en: 'large electronics & appliance megastore, long brightly lit display aisles, promotional price signs, glossy floor',
    stock: 'a full display wall of the product with price tags',
  },
  {
    id: 'showroom-gia-dung',
    group: 'Cửa hàng lớn',
    name: 'Showroom gia dụng cao cấp',
    vi: 'Showroom gia dụng cao cấp, bếp mẫu trưng bày, đèn rọi ấm, kệ gỗ sáng',
    en: 'premium home-appliance showroom, model kitchen displays, warm spotlights, light wood shelves, elegant and spacious',
    stock: 'the product showcased on several podiums and shelves like a hero display',
  },
  {
    id: 'sieu-thi',
    group: 'Cửa hàng lớn',
    name: 'Siêu thị / đại siêu thị',
    vi: 'Lối đi siêu thị lớn, kệ hàng đầy ắp hai bên, xe đẩy, đèn trần sáng',
    en: 'big supermarket aisle, fully stocked shelves on both sides, shopping carts, bright ceiling lights',
    stock: 'one whole shelf section facing the camera stocked with the product',
  },
  {
    id: 'cua-hang-tien-loi',
    group: 'Cửa hàng lớn',
    name: 'Cửa hàng tiện lợi',
    vi: 'Cửa hàng tiện lợi sáng sủa, tủ mát, quầy thu ngân, kệ hàng ngăn nắp',
    en: 'bright convenience store, glass fridges, checkout counter, neat compact shelves',
    stock: 'the product displayed at the counter and on an end-cap shelf',
  },
  {
    id: 'cua-hang-thoi-trang',
    group: 'Cửa hàng lớn',
    name: 'Cửa hàng thời trang',
    vi: 'Cửa hàng thời trang hiện đại, giá treo đồ, gương lớn, đèn rọi',
    en: 'modern fashion boutique, clothing rails, large mirrors, track spotlights, minimal interior',
    stock: 'the product hanging on rails and folded on display tables in several colors',
  },
  {
    id: 'trung-tam-thuong-mai',
    group: 'Cửa hàng lớn',
    name: 'Gian hàng trung tâm thương mại',
    vi: 'Gian hàng pop-up trong trung tâm thương mại, quầy trưng bày, người qua lại mờ phía sau',
    en: 'pop-up booth inside a shopping mall, branded display counter, blurred shoppers walking in the background',
    stock: 'the product stacked in a pyramid display on the booth counter',
  },
  // ---------------- Đóng gói & giao hàng ----------------
  {
    id: 'ban-dong-goi',
    group: 'Đóng gói & giao hàng',
    name: 'Bàn đóng gói đơn hàng',
    vi: 'Khu bàn đóng gói đơn hàng xuất kho, cuộn băng keo, máy in tem, hộp ship xếp sẵn',
    en: 'order-packing station, tape dispensers, shipping label printer, ready-to-ship parcels piled up, busy e-commerce fulfillment vibe',
    stock: 'many units of the product waiting to be packed, parcels with shipping labels',
  },
  {
    id: 'khu-xuat-hang',
    group: 'Đóng gói & giao hàng',
    name: 'Khu xuất hàng lên xe tải',
    vi: 'Khu xuất hàng, xe tải lùi sát cửa kho, thùng hàng đang được bốc lên xe',
    en: 'loading dock, delivery truck backed up to the warehouse door, boxes being loaded, daylight outside',
    stock: 'boxes of the product being loaded into the truck',
  },
  {
    id: 'live-trong-kho',
    group: 'Đóng gói & giao hàng',
    name: 'Góc livestream trong kho',
    vi: 'Góc livestream bán hàng trong kho, đèn ring light, điện thoại trên giá, hàng chất phía sau',
    en: 'livestream selling corner inside a warehouse, ring light, phone on a tripod, stock piled behind the host',
    stock: 'the product piled high behind the host and a few units on the table',
  },
  {
    id: 'buu-cuc',
    group: 'Đóng gói & giao hàng',
    name: 'Bưu cục / điểm gửi hàng',
    vi: 'Bưu cục gửi hàng đông đơn, kệ bưu kiện, cân điện tử, quầy giao nhận',
    en: 'busy parcel shipping point, parcel shelves, digital scale, service counter',
    stock: 'a pile of parcels containing the product on the counter',
  },
  // ---------------- Chợ & sạp ----------------
  {
    id: 'cho-dau-moi',
    group: 'Chợ & sạp',
    name: 'Sạp chợ đầu mối',
    vi: 'Sạp hàng chợ đầu mối, hàng chất cao chật kín, biển tên sạp, không khí buôn bán nhộn nhịp',
    en: 'wholesale market stall, goods piled high filling every space, stall sign, lively trading atmosphere, Vietnamese market',
    stock: 'the product piled high all over the stall',
  },
  {
    id: 'cho-dem',
    group: 'Chợ & sạp',
    name: 'Chợ đêm',
    vi: 'Gian hàng chợ đêm, đèn dây vàng, người qua lại mờ phía sau',
    en: 'night market stall, warm string lights, blurred passers-by in the background, bokeh',
    stock: 'the product arranged on the stall table and hanging displays',
  },
  {
    id: 'cua-hang-mat-pho',
    group: 'Chợ & sạp',
    name: 'Cửa hàng mặt phố',
    vi: 'Cửa hàng nhỏ mặt phố Việt Nam, hàng bày ra vỉa hè, biển hiệu, xe máy qua lại',
    en: 'small Vietnamese street-front shop, goods displayed out to the sidewalk, shop sign, motorbikes passing',
    stock: 'the product displayed at the shop front in neat stacks',
  },
  // ---------------- Nhà & văn phòng ----------------
  {
    id: 'bep-gia-dinh',
    group: 'Nhà & văn phòng',
    name: 'Bếp gia đình hiện đại',
    vi: 'Bếp gia đình Việt hiện đại, mặt đá sáng, tủ gỗ, ánh nắng cửa sổ',
    en: 'modern Vietnamese home kitchen, light stone countertop, wooden cabinets, natural window light',
    stock: 'the product in use on the countertop',
  },
  {
    id: 'phong-khach',
    group: 'Nhà & văn phòng',
    name: 'Phòng khách căn hộ',
    vi: 'Phòng khách căn hộ sáng sủa, sofa xám, cây xanh, ánh sáng ban ngày',
    en: 'bright apartment living room, grey sofa, green plants, daylight',
    stock: 'the product placed naturally in the room',
  },
  {
    id: 'van-phong',
    group: 'Nhà & văn phòng',
    name: 'Văn phòng / bàn làm việc',
    vi: 'Văn phòng hiện đại, bàn làm việc gọn, màn hình máy tính, ánh sáng trắng',
    en: 'modern office, tidy desk, computer monitors, neutral white light',
    stock: 'the product on the desk',
  },
];

export const backdropById = (id?: string) => BACKDROP_PRESETS.find((b) => b.id === id);

/** Cấu hình bối cảnh của màn Tạo video hàng loạt */
export interface BackdropPick {
  /** Bối cảnh cố định ('' = không ép) */
  backdropId?: string;
  /** Xoay vòng: mỗi dòng (mỗi clip) 1 bối cảnh khác trong các nhóm đã tích */
  backdropRotate?: boolean;
  backdropGroups?: string[];
}

/** Danh sách bối cảnh tham gia xoay vòng: các nhóm đã tích; chưa tích nhóm nào → nhóm của bối cảnh đang chọn, không thì mọi nhóm. */
export const backdropRotation = (cfg: BackdropPick): BackdropPreset[] => {
  const groups = (cfg.backdropGroups || []).filter((g) => BACKDROP_PRESETS.some((b) => b.group === g));
  const base = backdropById(cfg.backdropId);
  const use = groups.length ? groups : base ? [base.group] : [];
  const list = use.length ? BACKDROP_PRESETS.filter((b) => use.includes(b.group)) : BACKDROP_PRESETS;
  // Bắt đầu từ bối cảnh đang chọn (nếu nó nằm trong danh sách)
  const at = base ? list.findIndex((b) => b.id === base.id) : -1;
  return at > 0 ? [...list.slice(at), ...list.slice(0, at)] : list;
};

/** Bối cảnh của dòng thứ sceneNo (từ 0): xoay vòng → lần lượt trong danh sách; không → bối cảnh cố định (hoặc không có). */
export const backdropForScene = (cfg: BackdropPick, sceneNo: number): BackdropPreset | undefined => {
  if (cfg.backdropRotate) {
    const list = backdropRotation(cfg);
    return list.length ? list[((sceneNo % list.length) + list.length) % list.length] : undefined;
  }
  return backdropById(cfg.backdropId);
};

/** Thẻ khóa bối cảnh chèn vào prompt video / ảnh khung hình */
export const backdropTag = (b: BackdropPreset): string =>
  `[BACKDROP — the whole shot takes place here: ${b.en}. Bối cảnh: ${b.vi}. Keep this same location for the entire shot; the product may also appear stocked in the background.]`;

/** Lựa chọn cho ô select: "Nhóm · Tên" */
export const BACKDROP_OPTIONS: [string, string][] = BACKDROP_PRESETS.map((b) => [b.id, `${b.group} · ${b.name}`]);

/** Mật độ sản phẩm trong bối cảnh (node Tạo bối cảnh) */
export const BACKDROP_DENSITY: [string, string][] = [
  ['none', 'Không bày sản phẩm (bối cảnh trống)'],
  ['few', 'Vài món bày quanh'],
  ['full', 'Xếp đầy kệ / quầy'],
  ['massive', 'Nguyên kho đầy ắp (hàng số lượng lớn)'],
];
