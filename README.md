# Exam Proctor Web App & Chrome Extension (v6.3)

ระบบศูนย์รวมและบริหารจัดการการคุมสอบออนไลน์ระดับองค์กรและสถานศึกษา รองรับการทำงานทั้ง:
1. **Web App Edition (แนะนำหลัก)**: ใช้งานผ่านเว็บเบราว์เซอร์ได้ทันที ครอบ Google Forms ได้ทุกรูปแบบ สร้างลิงก์ห้องสอบเฉพาะวิชา และมีระบบตรวจจับเหตุการณ์ทุจริตแบบเรียลไทม์ พร้อมหน้าจอ Live Monitor สำหรับผู้คุมสอบโดยไม่ต้องติดตั้งโปรแกรมเสริม
2. **Chrome Extension Edition**: ส่วนขยายสำหรับติดตั้งบนเครื่องคอมพิวเตอร์เพื่อเพิ่มระดับการล็อกเบราว์เซอร์ในห้องปฏิบัติการ

---

## 📖 คู่มือการใช้งานระบบฉบับสมบูรณ์ (Official User Manuals)
- **[Interactive Web Manual (เปิดผ่านระบบหลังบ้าน & สั่งพิมพ์ PDF)](admin/manual.html)**: หน้าเว็บคู่มืออินเตอร์แอคทีฟ มีสารบัญคลิกได้ ค้นหาด่วน สลับมุมมองตามสิทธิ์ครู/Admin และพิมพ์เป็นรูปเล่มได้ทันที
- **[Full Markdown User Manual (เอกสารฉบับเต็ม)](docs/USER_MANUAL.md)**: คู่มือฉบับเต็มพร้อมภาพประกอบครอบคลุมทุกฟังก์ชันและเมนู

---

## จุดเด่นของระบบ
- **รองรับทุกอุปกรณ์**: ใช้งานได้ทั้งคอมพิวเตอร์ตั้งโต๊ะ, โน้ตบุ๊ก, แท็บเล็ต, iPad, สมาร์ตโฟน และ Chromebook
- **ฟอนต์ราชการ TH Sarabun PSK**: ตัวอักษรขนาดมาตรฐาน คมชัด อ่านง่าย และแสดงผลขนาดเท่ากันในทุกขนาดหน้าจอ
- **ฐานข้อมูล Neon Serverless PostgreSQL**: ประมวลผลรวดเร็วระดับ Sub-30ms พร้อมสตรีมมิ่งสดแบบ Ultra Low-Latency SSE (<1s)
- **ระบบความปลอดภัยระดับสากล**:
  - การแฮชรหัสผ่านด้วยอัลกอริทึม Scrypt (RFC 7914) ป้องกันการโจมตีแบบ Brute-Force
  - ระบบตรวจสอบสิทธิ์ด้วย HMAC-SHA256 Token
  - การยืนยันตัวตนสองชั้น (TOTP 2FA Authentication)
- **ระบบป้องกันการทุจริต (Anti-Cheating Engine)**: บังคับโหมดเต็มจอ (Fullscreen), ตรวจจับการสลับแท็บ/ย่อหน้าจอ, ตรวจจับคลิกออกนอกหน้าข้อสอบ, บล็อกคีย์ลัดและคลิกขวา

---

## สถาปัตยกรรมโครงสร้างระบบ (System Architecture)

### 1. หน้าบ้านสำหรับนักเรียน (Student Portal)
- `index.html`: ศูนย์รวมข้อสอบออนไลน์สำหรับนักเรียน ค้นหาและระบุห้องสอบด้วยรหัสเข้าห้องสอบ (Entry Code 6 หลัก)
- `exam.html`: ระบบคุมสอบเต็มหน้าจอ (Proctor Engine) ครอบลิงก์ Google Forms พร้อมระบบแจ้งเตือนเมื่อเกิดความพยายามสลับหน้าจอ
- `js/frontend/portal.js`: สคริปต์ค้นหา กรองหมวดหมู่วิชา และเข้าสู่ห้องสอบ
- `js/frontend/proctor.js`: เครื่องยนต์ตรวจจับพฤติกรรมการสอบและส่งสัญญาณแจ้งเตือนแบบเรียลไทม์

### 2. หลังบ้านสำหรับบุคลากร (Back-Office Studio - โฟลเดอร์ `admin/`)
- `admin/login.html`: ระบบเข้าสู่ระบบสำหรับบุคลากร รองรับทั้งสิทธิ์ครูผู้คุมสอบ (Teacher) และผู้ดูแลระบบหลัก (Admin) พร้อมการยืนยันตัวตน 2FA
- `admin/rooms.html`: จัดการห้องสอบ (Rooms Management) เปิด/ปิดรับผู้สอบ, แก้ไข, ลบ และฉาย QR Code สำหรับเข้าสอบ
- `admin/create.html`: สร้างห้องสอบใหม่ กำหนดวิชา ระดับชั้น ลิงก์ข้อสอบ และสุ่มรหัสผ่าน
- `admin/monitor.html`: หน้าจอศูนย์คุมสอบสด (Live Proctoring Center) และคลังประวัติย้อนหลัง (Exam Archives) ติดตามผู้สอบรายบุคคลแบบสดๆ และพิมพ์รายงานสรุปผลการสอบ PDF
- `admin/users.html`: จัดการบัญชีผู้ใช้งานระบบ (User Management) เพิ่ม/แก้ไข/ลบ กำหนดสิทธิ์ Admin หรือ Teacher
- `admin/settings.html`: ตั้งค่าระบบกลาง (System Settings) และเชื่อมต่อ Cloud API
- `admin/manual.html`: คู่มือการใช้งานระบบในตัว (Official User Manual) แยกตามสิทธิ์ Teacher และ Admin อัตโนมัติ
- `js/backend/`: รวมสคริปต์ตรรกะหลังบ้าน (`auth.js`, `rooms.js`, `creator.js`, `monitor.js`, `users.js`, `settings.js`)

### 3. ส่วนประมวลผลเซิร์ฟเวอร์และฐานข้อมูล (Cloud Backend & Database)
- `api/index.js`: Vercel Serverless Function API ให้บริการ RESTful Endpoints และ SSE Real-time Stream
- `schema.sql`: โครงสร้างฐานข้อมูล PostgreSQL 4 ตารางหลัก (`users`, `system_config`, `exam_rooms`, `exam_logs`)
- `js/shared/config.js`: การตั้งค่าระบบกลาง และตัวเชื่อมต่อ Cloud API
- `js/shared/common.js`: ฟังก์ชันกลาง, การจัดการแจ้งเตือน และระบบธีม
- `css/style.css`: ระบบการจัดสไตล์ ดีไซน์ทางการ โทนสีคมชัด ฟอนต์ TH Sarabun PSK

---

## โครงสร้างตารางฐานข้อมูล (PostgreSQL Schema)

1. **`users`**: จัดเก็บบัญชีผู้ใช้, สิทธิ์ (ADMIN / TEACHER), รหัสผ่านที่แฮชด้วย Scrypt, Secret สำหรับ 2FA
2. **`system_config`**: จัดเก็บการตั้งค่าระบบกลาง, ข้อความประกาศหน้าแรก, รหัสผ่านกลาง
3. **`exam_rooms`**: จัดเก็บข้อมูลห้องสอบ, รหัสเข้าสอบ 6 หลัก, ลิงก์ข้อสอบ Google Forms, สถานะห้อง (OPEN / CLOSED)
4. **`exam_logs`**: จัดเก็บบันทึกเหตุการณ์การสอบสด, เวลาที่เริ่มสอบ, เวลาที่ส่งข้อสอบ และประวัติการสลับหน้าจอ

---

## การติดตั้งและการเริ่มใช้งาน (Getting Started)

### การรันเซิร์ฟเวอร์สำหรับทดสอบในเครื่อง (Local Development)
```bash
# 1. ติดตั้ง Dependencies
npm install

# 2. กำหนดตัวแปรสภาพแวดล้อมฐานข้อมูลใน .env
# DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# 3. รันเซิร์ฟเวอร์
npm start
```
เปิดเบราว์เซอร์ไปที่ `http://localhost:3300`

### การ Deploy บน Vercel Production
1. นำเข้าโค้ดขึ้น GitHub Repository
2. เชื่อมต่อโปรเจกต์บน Vercel Dashboard
3. กำหนด Environment Variable:
   - `DATABASE_URL`: Connection string ของ Neon PostgreSQL Database
4. Vercel จะทำการ Build และ Deploy เป็น Serverless Web Application อัตโนมัติ

---

## สิทธิ์การเข้าใช้งานระบบเริ่มต้น (Default Accounts)
- **ผู้ดูแลระบบ (Admin)**: `admin`
- **ครูผู้คุมสอบ (Teacher)**: `teacher`
*(รหัสผ่านได้รับการปกป้องด้วย Scrypt Hashing และสามารถปรับเปลี่ยนได้ผ่านหน้าจัดการผู้ใช้)*
