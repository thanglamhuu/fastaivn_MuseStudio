# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[2].joinpath(r"frontend\src\components\WorkflowStudio.tsx")
L = p.read_text(encoding="utf-8").split("\n")
assert L[599].strip().startswith('<div className="p-4 lg:p-6 grid'), L[599]
assert L[673].strip() == "</section>", L[673]
new = '''    <div className="p-4 lg:p-6 space-y-5">
      {/* ---------------- 1. Lưới card mẫu workflow (thumbnail 9:16 từ video đã tạo) ---------------- */}
      <WorkflowTemplateGallery
        templates={allTemplates}
        rows={rows}
        groupOf={catGroup}
        filter={catFilter}
        setFilter={setCatFilter}
        search={tplSearch}
        setSearch={setTplSearch}
        cols={galleryCols}
        setCols={setGalleryCols}
        selectedId={selected.id}
        onSelect={setSelectedId}
        onOpenNodes={openInNodes}
      />
    <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5">
      {/* ---------------- Cột trái: tùy chỉnh mẫu đang chọn ---------------- */}
      <aside className="space-y-4">'''.split("\n")
L[599:674] = new
p.write_text("\n".join(L), encoding="utf-8")
print("ok", len(L))
print("\n".join(L[-14:]))
