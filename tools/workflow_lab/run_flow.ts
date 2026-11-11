// Chạy 1 file sơ đồ flow-workflow bằng đúng runtime của MuseStudio (frontend/src/services/nodeFlow/runtime.ts),
// ngoài trình duyệt. Dùng cho thí nghiệm đồng nhất. node run_flow.cjs <file.json> [threads]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseFlowJson } from '../../frontend/src/services/nodeFlow/flowIO';
import { runFlow } from '../../frontend/src/services/nodeFlow/runtime';

const file = process.argv[2];
const threads = Number(process.argv[3] || 2);
// *.result.json = sơ đồ đã chạy (giữ kết quả từng node) → chạy tiếp các node chưa xong
const resume = file.endsWith('.result.json');
const workflow = resume ? JSON.parse(readFileSync(file, 'utf8')) : parseFlowJson(JSON.parse(readFileSync(file, 'utf8'))).workflow;
const t0 = Date.now();
const log = (m: string) => console.log(`${new Date().toLocaleTimeString()} ${m}`);
runFlow(workflow, resume ? { kind: 'resume' } : { kind: 'all' }, {
  threads: () => threads,
  shouldStop: () => false,
  patchNode: (id, patch) => {
    const n = workflow.nodes.find((x) => x.id === id);
    if (n) n.data = { ...n.data, ...patch };
  },
  log,
  project: `Node - ${workflow.name}`.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 70),
  characters: [],
  products: [],
})
  .then((r) => {
    log(`XONG ${Math.round((Date.now() - t0) / 1000)}s, lỗi ${r.errors}`);
    // Lưu prompt thực tế đã gửi (để báo cáo)
    writeFileSync(resume ? file : file.replace(/\.json$/, '.result.json'), JSON.stringify(workflow, null, 1));
  })
  .catch((e) => {
    log(`LỖI ${e?.message || e}`);
    process.exit(1);
  });
