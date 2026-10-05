# gmv-max-report-web

หน้าเว็บดูรายงาน GMV Max ของ TikTok Shop ดึงข้อมูลจาก gmv-max-report-api

React + Vite + TypeScript, Tailwind, deploy เป็น static site บน Cloudflare Workers

## รัน

```
npm install
npm run dev
```

เปิด http://localhost:5178

ตอน dev จะ proxy `/api` ไปที่ API ในเครื่อง (port 3100) ต้องรัน API ไว้ด้วย ถ้า API อยู่ port อื่นให้ตั้ง `VITE_PROXY_TARGET` ใน `.env.local`

คำสั่งอื่น

```
npm test
npm run build
npm run deploy
```

## env

- `VITE_API_BASE_URL` url ของ API ค่าของ production อยู่ใน `.env.production` ที่เก็บใน Git (เป็น URL สาธารณะ ไม่ใช่ secret) ห้ามใส่ token หรือ secret ในตัวแปร `VITE_*`
- `VITE_PROXY_TARGET` ใช้ตอน dev อย่างเดียว

ค่า `VITE_API_BASE_URL` ถูกฝังตอน build ถ้าเปลี่ยน url ต้อง build แล้ว deploy ใหม่ และอย่าลืมเพิ่มโดเมนของเว็บใน `CORS_ORIGINS` ฝั่ง API

## หน้าที่มี

- `/login`
- `/` หน้ารายงาน มีแท็บ Product กับ LIVE, export Excel ได้
- `/stores` ดูสถานะสิทธิ์ของแต่ละร้าน ขอสิทธิ์จาก TikTok และกด sync รายร้าน

### ตัวกรองวันที่

ใช้ร่วมกันทั้ง Product และ LIVE: ปฏิทินสองเดือนบนจอใหญ่/เดือนเดียวบนจอเล็ก
พิมพ์วันเริ่มต้นและวันสิ้นสุดในรูปแบบ `YYYY-MM-DD` (ค.ศ.) หรือเลือกจากปฏิทิน/ช่วงวันที่ลัด
การเลือกเป็น draft จนกด `ใช้ช่วงวันที่นี้`; ยกเลิก, Escape หรือคลิกนอกกล่องไม่เปลี่ยนรายงาน
นับช่วงรวมวันเริ่มต้นและวันสิ้นสุด ไม่อนุญาตวันที่ไม่มีจริง, ช่วงกลับด้าน หรือวันในอนาคต
วันนี้อิงวันที่ท้องถิ่นใน browser เช่นเดียวกับค่าเริ่มต้นของ dashboard เดิม
ช่วง 3/6/12 เดือนล่าสุดเป็นเดือนปฏิทินย้อนหลังรวมวันนี้ (เช่น 3 เดือนถึง 2026-10-05 เริ่ม 2026-07-06)
ไม่เปลี่ยน scope ของ API หรือการส่งออก Excel; ทุกส่วนใช้ช่วงที่ยืนยันแล้วเท่านั้น

### Overall รายวัน

ปุ่ม `ดาวน์โหลด Overall รายวัน` เหนือการ์ดสรุป ส่งออกหนึ่งแถวต่อวันตามช่วงที่เลือกและแถว Total
ใช้ scope เดียวกับการ์ด: ร้าน, วันที่, Product/LIVE และ LIVE Creator ไม่ใช้ตัวกรองของตารางชิ้นงาน
ไฟล์ใช้ข้อมูลรายวันที่ API มีอยู่แล้ว: Cost, SKU orders, Gross revenue, ROI, Cost per order
และสำหรับ Product เพิ่ม Videos advertised, Videos with sales, Creators with sales
Campaigns with data และ Live duration ยังไม่มีข้อมูลแยกรายวันใน endpoint นี้ จึงไม่ใส่ตัวเลขที่คาดเดา
วันที่ไม่มีแถวข้อมูลจะเว้นว่างพร้อม Data status ส่วนวันนี้ระบุว่ายังไม่จบวัน
Total ยอดเงิน/ออเดอร์ใช้สูตร SUM; ROI และ Cost per order คำนวณจากยอดรวม
Total วิดีโอ/ครีเอเตอร์ใช้จำนวนไม่ซ้ำทั้งช่วงจาก summary API ไม่บวกจำนวนรายวันเข้าด้วยกัน
วันที่เป็นเซลล์ date และตัวเลขไม่ถูกแปลงเป็นข้อความ จึงนำไปทำ daily trend ต่อได้

## โฟลเดอร์

```
src/api         เรียก API + zod schema
src/components  component ต่างๆ
src/hooks       react-query hooks
src/lib         คำนวณตัวเลข, format, export excel
src/pages       หน้าเว็บ
src/store       zustand (auth, filter)
```

## deploy

`npm run build` แล้ว `npm run deploy` (wrangler) ต้อง login cloudflare ก่อนด้วย `npx wrangler login`
