# 🌌 THE GRAND FRONTIER: PROJECT OMNI — เว็บไซต์นำเสนอคอนเซปต์เกม

เว็บไซต์หน้าเดียว (landing page) สำหรับนำเสนอคอนเซปต์เกม
**THE GRAND FRONTIER: PROJECT OMNI** — เกมแนว Action-Adventure / Physics Sandbox / Endless Co-op

เขียนด้วย HTML + CSS + JavaScript ล้วน ไม่มี framework ไม่ต้อง build
เปิดไฟล์ `index.html` ก็ใช้งานได้ทันที

---

## ✨ จุดเด่นของเว็บ

- **Hero ที่ใช้ฟิสิกส์จริง** — เศษวัตถุบน canvas ตกตามแรงโน้มถ่วง ชนกัน เด้ง และหมุนตามแรงเสียดทาน
  - ลากเมาส์หรือนิ้ว = ผลักวัตถุให้กระเด็น
  - คลิกหรือแตะ = ระเบิดกระจายออกจากจุดที่กด
  - จำลองด้วย fixed timestep (120 Hz) เพื่อให้ผลลัพธ์นิ่งทุกอัตราเฟรม
- **รองรับมือถือเต็มรูปแบบ** — เลย์เอาต์แบบ responsive พร้อมเมนูแฮมเบอร์เกอร์
- **เข้าถึงง่าย (Accessibility)** — skip link, โครงสร้าง ARIA ของแท็บพร้อมควบคุมด้วยลูกศร,
  สถานะโฟกัสที่มองเห็นชัด และรองรับ `prefers-reduced-motion` (ปิดแอนิเมชันทั้งหมด วาดฉากนิ่งแทน)
- **ประหยัดพลังงาน** — หยุดการจำลองฟิสิกส์อัตโนมัติเมื่อเลื่อนพ้นจอหรือสลับแท็บเบราว์เซอร์

---

## 📁 โครงสร้างโปรเจกต์

```
.
├── index.html                  # หน้าเว็บหลัก (ทุกส่วนอยู่ในไฟล์เดียว)
├── assets/
│   ├── css/style.css           # ธีม ตัวแปรสี เลย์เอาต์ และ responsive
│   └── js/
│       ├── physics-hero.js     # เอนจินฟิสิกส์ + การวาดฉาก hero
│       └── main.js             # เมนู, scroll-spy, reveal, แท็บสายการเล่น
├── docs/CONCEPT.md             # เอกสารคอนเซปต์เกมฉบับเต็ม
└── README.md
```

---

## 🚀 วิธีเปิดดู

เปิดไฟล์ตรงๆ:

```bash
open index.html        # macOS
xdg-open index.html    # Linux
```

หรือรันเซิร์ฟเวอร์ในเครื่อง (แนะนำ เพื่อให้ path ของไฟล์ทำงานถูกต้องทุกกรณี):

```bash
python3 -m http.server 8000
# แล้วเปิด http://localhost:8000
```

---

## 🌐 การนำขึ้นออนไลน์ (GitHub Pages)

เป็นเว็บแบบ static ล้วน จึงเผยแพร่ได้ทันที:

1. ไปที่ **Settings → Pages** ของ repository
2. เลือก **Source: Deploy from a branch**
3. เลือกบรานช์ที่ต้องการ และโฟลเดอร์ `/ (root)` แล้วกด Save

---

## 🎨 ปรับแต่งธีม

สีทั้งหมดถูกกำหนดเป็น CSS custom properties อยู่ที่ `:root` ใน `assets/css/style.css`
แก้ที่เดียวแล้วเปลี่ยนทั้งเว็บ:

```css
--ember:  #ff7a3d;   /* สีหลัก (ไฟ/แอ็กชัน) */
--amber:  #ffc25c;   /* สีเน้น */
--plasma: #46e0d0;   /* สีรอง (เทคโนโลยี) */
--void:   #8b5cf6;   /* สีอวกาศ */
```

ส่วนค่าพฤติกรรมของฟิสิกส์ปรับได้ที่ส่วนหัวของ `assets/js/physics-hero.js`
เช่น `GRAVITY` (แรงโน้มถ่วง), `RESTITUTION` (ความเด้ง) และ `FRICTION` (แรงเสียดทาน)

---

## 📄 เนื้อหา

คอนเซปต์เกมฉบับเต็มอยู่ที่ [`docs/CONCEPT.md`](docs/CONCEPT.md)
