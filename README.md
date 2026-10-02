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
