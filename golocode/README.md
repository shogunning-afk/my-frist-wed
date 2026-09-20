# ◉ GOLOCODE — โค้ดดิ้ง AI ที่มีเอเจนต์ 100 ตัว

> พิมพ์งานอะไรก็ได้ลงไป → ระบบเลือกทีมผู้เชี่ยวชาญจากเอเจนต์ 100 ตัว →
> ทำงานเป็นเฟส → ส่งคืนเป็นโค้ดที่รันได้จริง

**English:** GOLOCODE takes any coding task, routes it to a squad drawn from a
roster of 100 specialist agents (architecture, creative code, security,
performance, delivery…), runs them in five phases, and returns complete,
runnable code. It is a single static page — HTML, CSS, and vanilla JavaScript,
no build step, no framework, no backend.

เปิด `index.html` ก็ใช้ได้ทันที

---

## 🚀 วิธีเปิดใช้ (Quick start)

```bash
# เปิดไฟล์ตรงๆ ก็ได้
xdg-open golocode/index.html     # Linux
open golocode/index.html         # macOS

# หรือรันเซิร์ฟเวอร์ในเครื่อง (แนะนำ — โหมด Live ต้องใช้ http/https)
python3 -m http.server 8000
# แล้วเปิด http://localhost:8000/golocode/
```

> โหมด **Live** โหลด Anthropic SDK จาก CDN ด้วย ES module จึงต้องเปิดผ่าน
> `http://` หรือ `https://` — เปิดด้วย `file://` จะใช้ได้เฉพาะโหมด Local Blueprint

---

## ⚙️ สองเอนจิน (Two engines)

| | **Local Blueprint** | **Live** |
|---|---|---|
| ต้องใช้ API key | ไม่ต้อง | ต้องใช้ (Anthropic) |
| เรียกโมเดล | ไม่เรียกเลย | เรียกจริงผ่าน Claude API |
| ได้อะไรกลับมา | แผนภารกิจรายเฟส, คำสั่งของเอเจนต์ทุกตัว, โครงไฟล์เริ่มต้นที่รันได้, risk register, prompt สำหรับส่งต่อ | โค้ดครบทุกไฟล์ เขียนขึ้นสำหรับงานนั้นโดยเฉพาะ + build note + วิธีรัน + ความเสี่ยงที่เหลือ |
| ความเร็ว | ทันที | ตามจำนวนเอเจนต์ (ปกติ 30 วิ – ไม่กี่นาที) |
| ค่าใช้จ่าย | ฟรี | จ่ายตามโทเคนที่ใช้จริง |

**Local Blueprint ไม่ได้เขียนโค้ดเฉพาะงานให้** — มันวางแผน จัดทีม
และสร้างโครงไฟล์มาตรฐานที่รันได้ ถ้าอยากได้โค้ดที่เขียนสำหรับงานนั้นจริงๆ
ให้สลับไปโหมด Live หรือกด **Copy prompt** ในแท็บ *Handoff prompt*
แล้วเอาไปวางใน Claude / Claude Code / ผู้ช่วยตัวไหนก็ได้

---

## 🧭 เอเจนต์ 100 ตัว — 10 กองพล กองพลละ 10

| กองพล | ขอบเขต | ตัวอย่างเอเจนต์ |
|---|---|---|
| ⬢ Core Engineering | สถาปัตยกรรม, API, ฐานข้อมูล, เซอร์วิส | KEYSTONE · LATTICE · FORGE · PRISM · VAULTKEEP |
| ✺ Creative Code Lab | shader, motion, ฟิสิกส์, เสียง, game feel | AURORA · SHADERSMITH · GRAVITY · RESONANCE · PIXELWRIGHT |
| ◈ Product & Experience | UX, UI, design system, accessibility, copy | COMPASS · ATLAS-UX · PALETTE · SYSTEMA · OPENHAND |
| ⟁ Data & Intelligence | ML, data pipeline, prompt, RAG, evals, agent | ORACLE · CONDUIT · SIGIL · LIBRARIAN · WEAVER |
| ⬗ Infrastructure | cloud, CI/CD, container, IaC, observability | GIRDER · PIPEWORK · CRATE · BEACON · HARBOR |
| ◬ Quality & Verification | test ทุกชั้น, fuzz, load, chaos, code review | PROOFWRIGHT · UNIT-ZERO · PUPPETEER · REDPEN · REGRESS |
| ⛨ Security | ช่องโหว่, threat model, crypto, secrets, auth | BULWARK · THREATCAST · KEYRING · GATEKEEP · HARDLINE |
| ⚡ Performance | profiling, memory, bundle, query, rendering | STOPWATCH · MEMWARD · TRIMMER · INDEXER · FRAMELOCK |
| ⬡ Platforms & Systems | iOS, Android, desktop, embedded, compiler | SWIFTHAND · DROIDWRIGHT · IRONCORE · BYTESMITH · TERMINAL |
| ✦ Delivery & Craft | เอกสาร, refactor, migration, การวางแผน, สอน | SCROLLKEEP · CHISEL · ARCHAEOLOGIST · TEMPO · NORTHSTAR |

ดูครบทั้ง 100 ตัวได้ที่ปุ่ม **Roster** ในหน้าเว็บ (ค้นหาด้วยสกิล บทบาท หรือ codename ได้)

เอเจนต์แต่ละตัวมี: `codename`, `role`, เฟสที่รับผิดชอบ, tag สำหรับ routing,
คำอธิบายสั้น และ `directive` — ซึ่งก็คือ system prompt ที่ใช้จริงตอนรันโหมด Live

---

## 🔁 ห้าเฟสของภารกิจ (Five phases)

```
RECON  →  DESIGN  →  BUILD  →  VERIFY  →  SHIP  →  SYNTHESIS
เข้าใจ    ออกแบบ    เขียน     พิสูจน์    ส่งมอบ    NORTHSTAR รวมทุกอย่าง
```

แต่ละเฟสจะรันเอเจนต์ของเฟสนั้นก่อน แล้วส่งผลลัพธ์เป็นบริบทให้เฟสถัดไป
เฟสสุดท้าย **NORTHSTAR** (Mission Commander) รวมทุกความเห็น ตัดสินตรงที่ขัดกัน
แล้วเขียนออกมาเป็นไฟล์จริงทั้งหมด

---

## 🎯 การเลือกทีมทำงานยังไง (How routing works)

`assets/js/router.js` อ่านข้อความงานแล้ว:

1. **จับประเภทงาน** จาก 13 profile เช่น Creative / Interactive, Backend Service,
   Security Review, Performance Work, Refactor / Migration
2. **จับ stack** ที่พูดถึง (Python, React, Rust, Postgres, Docker …)
3. **ให้คะแนนเอเจนต์ทุกตัว** จาก tag ที่ตรง + บทบาท + กองพลที่เข้ากับงาน
   + anchor ของ profile นั้น
4. **แบ่งโควตาตามเฟส** ตามน้ำหนักของ profile
   (งานดีบักจะเน้น VERIFY, งานสร้างใหม่จะเน้น BUILD)
5. **NORTHSTAR ติดไปด้วยเสมอ**

ผลลัพธ์เป็น deterministic — งานเดิมได้ทีมเดิมทุกครั้ง จึงอธิบายและทำซ้ำได้

เลือกขนาดทีมได้ 4 ระดับ: **Strike 5** · **Squad 12** · **Wing 30** · **Full fleet 100**

---

## 🔑 API key และความปลอดภัย

- key ถูกเก็บใน `localStorage` ของเบราว์เซอร์เครื่องนั้น **เท่านั้น** และส่งตรงไปที่
  `api.anthropic.com` — GOLOCODE ไม่มีเซิร์ฟเวอร์เป็นของตัวเอง ไม่มีที่เก็บ ไม่มีการส่งต่อ
- ใช้ SDK ทางการ (`@anthropic-ai/sdk`) พร้อมออปชัน `dangerouslyAllowBrowser: true`
- **ข้อควรระวัง:** อะไรที่อยู่ใน browser storage อ่านได้จากสคริปต์อื่นในเบราว์เซอร์นั้น
  ควรใช้ key ที่ตั้ง spend limit ไว้ อย่าใช้ key ของ production
  และกด **Clear stored key** เมื่อเลิกใช้
- ถ้าจะเอาไปใช้แบบจริงจังหรือให้คนอื่นใช้ด้วย ให้ย้ายการเรียก API ไปไว้หลังเซิร์ฟเวอร์ของตัวเอง
  แล้วให้หน้าเว็บคุยกับเซิร์ฟเวอร์นั้นแทน

---

## 💸 ค่าใช้จ่ายโหมด Live

เอเจนต์จะถูกจัดเป็น **cell ละ 5 ตัว ต่อ 1 request** แล้วปิดท้ายด้วย synthesis อีก 1 request

| ขนาดทีม | จำนวน request | ประมาณการ (Opus 5, depth = Standard) |
|---|---|---|
| Strike 5 | ~2 + 1 | ต่ำกว่า $0.10 |
| Squad 12 | ~5 + 1 | ~$0.10 – $0.30 |
| Wing 30 | ~9 + 1 | ~$0.30 – $0.80 |
| Full fleet 100 | ~21 + 1 | ~$0.80 – $2.50 |

ตัวเลขจริงขึ้นกับความยาวของงานและคำตอบ — แถบ meter ใต้ mission log
แสดงโทเคนที่ใช้จริงและค่าประมาณเป็น USD ตลอดการรัน
เลือกโมเดลถูกลงได้ (Sonnet 5 / Haiku 4.5) และลด **Depth** เพื่อประหยัด

---

## 📁 โครงสร้างไฟล์

```
golocode/
├── index.html                  # หน้าแอป
├── assets/
│   ├── css/golocode.css        # ธีมทั้งหมด (ตัวแปรสีอยู่ที่ :root)
│   └── js/
│       ├── agents.js           # ทะเบียนเอเจนต์ 100 ตัว + กองพล + เฟส
│       ├── router.js           # วิเคราะห์งาน → เลือกทีม (deterministic)
│       ├── blueprint.js        # เอนจิน Local Blueprint + handoff prompt
│       ├── engine.js           # เอนจิน Live (Claude API, streaming, cost)
│       └── app.js              # UI ทั้งหมด
└── README.md
```

---

## 🛠️ ปรับแต่ง (Customizing)

**เพิ่ม/แก้เอเจนต์** — แก้ที่ `ROWS` ใน `assets/js/agents.js`
หนึ่งแถวคือหนึ่งเอเจนต์:

```js
["CODENAME", "Role Title", "build",
 "tag|multi word tag|another",       // คำที่ใช้ match กับงาน
 "คำอธิบายสั้นๆ ที่โชว์บนการ์ด",
 "You are CODENAME, a <role>. <คำสั่งจริงที่ใช้เป็น system prompt>"],
```

**เปลี่ยนธีม** — แก้ตัวแปรที่ `:root` ใน `assets/css/golocode.css`
(`--glc-green`, `--glc-cyan`, `--glc-bg` …)

**เปลี่ยนขนาด cell / concurrency** — ที่ `runLive()` ใน `app.js`
(`cellSize`, `concurrency`)

---

## ⚠️ ข้อจำกัดที่ควรรู้ (Honest limits)

- "100 เอเจนต์" คือ **นิยามบทบาท 100 แบบ** ที่ถูกจัดกลุ่มเป็น cell แล้วส่งเข้าโมเดล
  ไม่ใช่โมเดล 100 ตัวแยกกันรัน — ทีมคือ *โครงสร้างการ prompt* ไม่ใช่จำนวนเครื่อง
- Local Blueprint ไม่ได้เขียนโค้ดเฉพาะงาน มันวางแผนและวางโครงเท่านั้น
- คุณภาพของโหมด Live ขึ้นกับโมเดลและโจทย์ที่เขียน — โจทย์ที่ละเอียดกว่าให้ผลดีกว่าเสมอ
- ทีมใหญ่ไม่ได้แปลว่าดีกว่าเสมอ งานเล็กใช้ **Strike 5** มักได้ผลคมกว่าและถูกกว่า
- ยังไม่มีระบบ memory ข้ามภารกิจ — แต่ละครั้งเริ่มใหม่หมด

---

## 🧪 ที่ทดสอบแล้ว

ทดสอบด้วย Chromium (Playwright) ครบทั้ง: routing preview, การรันโหมด Local,
การรันโหมด Live แบบ 12 และ 100 เอเจนต์ (ผ่าน mock SDK), การยกเลิกกลางคัน,
roster/ค้นหา/ฟิลเตอร์, แท็บและการดาวน์โหลด, มือถือ 390px และไม่มี horizontal scroll

---

GOLOCODE · 100 specialist agents, one mission at a time.

---

## 📦 ไฟล์เดียวจบ (Single-file build)

`dist/golocode.html` คือ GOLOCODE ทั้งตัวรวมอยู่ในไฟล์ HTML ไฟล์เดียว
(CSS + JS ทั้งหมดถูก minify และฝังไว้ข้างใน) เปิดได้เลย ไม่ต้องมีไฟล์อื่นประกอบ
เหมาะกับการส่งต่อ แนบไปกับอีเมล หรือเอาไปวางบนโฮสต์ที่รับไฟล์เดียว

สร้างใหม่ได้ด้วย esbuild — ดูขั้นตอนใน commit ที่เพิ่มไฟล์นี้
ตัวไฟล์สร้างจากซอร์สใน `assets/` เสมอ จึงควรแก้ที่ `assets/` แล้วค่อย build ใหม่
