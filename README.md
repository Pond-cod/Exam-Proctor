# 🛡️ Exam Proctor Web App & Chrome Extension (v3.0)

ระบบคุมสอบออนไลน์แบบครบวงจร รองรับทั้ง:
1. **Web App Edition (แนะนำใหม่)**: เปิดใช้งานผ่านเบราว์เซอร์ได้ทันที ครอบ Google Forms ได้ทุกรูปแบบ สร้างลิงก์ห้องสอบ (Sub-link) แจกนักเรียน และมี Admin Monitor ในตัวโดย**ไม่ต้องติดตั้ง Extension**
2. **Chrome Extension Edition**: ส่วนขยายสำหรับเครื่องคอมพิวเตอร์ที่ต้องการล็อกระดับเบราว์เซอร์

---

## 🌟 จุดเด่นของ Web App Edition
- **ไม่ต้องติดตั้งอะไรเลย**: รองรับทั้ง PC, Mac, iPad, แท็บเล็ต, Chromebook
- **ใส่ Google Forms ลิงก์ใดก็ได้**: แปลงและครอบด้วยระบบ Fullscreen อัตโนมัติ
- **สร้าง Sub-site / ลิงก์ห้องสอบเฉพาะวิชา**: ได้ลิงก์และ QR Code สำหรับส่งทาง Line / Google Classroom ใน 1 คลิก
- **ระบบ Anti-Cheat ครบครัน**: บังคับ Fullscreen, ดักจับการสลับแท็บ/ย่อหน้าจอ, ดักจับการคลิกออกนอกจอ, บล็อกคลิกขวาและคีย์ลัด
- **บันทึกสถิติสด**: ส่งรายงานเข้า Google Sheets แบบ Real-time ผ่าน Webhook

---

### 📂 โครงสร้างเมนูแยกหน้า (Multi-Site Architecture v5.3):
- [`index.html`](index.html): **🎓 รวมข้อสอบ (Student Exam Portal)** หน้าสำหรับนักเรียนใช้ค้นหาและเข้าสอบด้วย Student ID + รหัสเข้าสอบ 6 หลัก โดยไม่ต้อง Login
- [`create.html`](create.html): **➕ สร้างห้องสอบ (Room Creator)** หน้าสำหรับคุณครู/Admin สร้างห้องสอบ ครอบ Google Forms พร้อมระบบสุ่มรหัส 2 รูปแบบ (Entry Code & Passcode) และสร้าง QR Code
- [`monitor.html`](monitor.html): **🖥️ หน้าจอคุมสอบสด (Real-time Live Monitor)** หน้าจอติดตามผู้สอบสดแบบเรียลไทม์ พร้อมตัวกรองห้องสอบ ระบบเตือนภัย และแยกประวัติผู้ส่งข้อสอบแล้ว
- [`rooms.html`](rooms.html): **📁 จัดการห้องสอบ (Rooms Management)** หน้ารวมประวัติและจัดการห้องสอบ สลับสถานะเปิด/ปิดรับนักเรียน คัดลอกลิงก์ ฉาย QR Code และแก้ไข/ลบห้องสอบ
- [`exam.html`](exam.html): **🔒 ระบบคุมสอบเต็มหน้าจอ (Proctor Engine)** หน้าจอทำข้อสอบของนักเรียน ครอบ Google Forms เต็มจอ ตรวจจับสลับแท็บ/ย่อจอ พร้อมรหัสฉุกเฉินปลดล็อก
- [`js/common.js`](js/common.js): ระบบจัดการสิทธิ์ Role (Admin/Teacher), Shared Storage และ Cloud Synchronization
- [`js/portal.js`](js/portal.js), [`js/creator.js`](js/creator.js), [`js/monitor.js`](js/monitor.js), [`js/rooms.js`](js/rooms.js): เครื่องยนต์ขับเคลื่อนแต่ละหน้าอย่างเป็นอิสระและเป็นระเบียบ

---

## 📋 แผนการดำเนินงาน 5 ขั้นตอนหลัก

```
+--------------------------------------------------------------------------+
|                       1. เตรียม Google Forms & Webhook                    |
| - ฟอร์ม Section 1: ตรวจสอบสิทธิ์ (Secret Token ด้วย Response Validation)  |
| - ฟอร์ม Section 2: เนื้อหาข้อสอบ                                          |
| - Google Apps Script (บันทึก Log ลง Sheets & ให้บริการ GET แก่ Monitor)   |
+--------------------------------------------------------------------------+
                                    │
                                    ▼
+--------------------------------------------------------------------------+
|                  2. โครงสร้าง Chrome Extension (Manifest V3)             |
| - manifest.json     : กำหนดสิทธิ์ tabs, windows, storage, scripting      |
| - popup.html / js   : UI สลับแท็บ ผู้สอบ / ผู้คุมสอบ                     |
| - background.js     : Service worker ดักจับแท็บ/หน้าต่าง/สลับโปรแกรม      |
| - content.js        : สคริปต์ฝังตัวใน Google Forms เพื่อซ่อน/กรอก Token  |
+--------------------------------------------------------------------------+
                                    │
                                    ▼
+--------------------------------------------------------------------------+
|                  3. ระบบป้องกันและดักจับการทุจริต (Anti-Cheat)           |
| - Auto-Fill & Hide  : กรอก Secret Token อัตโนมัติและซ่อนคำถาม            |
| - Tab Lock          : ปิดแท็บใหม่ทันที (chrome.tabs.onCreated)           |
| - Focus Lock        : ดักจับ Alt+Tab, ย่อจอ, บังคับ Fullscreen อัตโนมัติ  |
| - Shortcut Block    : บล็อก F12, DevTools, Ctrl+U, Ctrl+P, คลิกขวา, Copy  |
| - Anti-Tamper       : บล็อกการเปิด chrome://extensions เพื่อปิดปลั๊กอิน    |
+--------------------------------------------------------------------------+
                                    │
                                    ▼
+--------------------------------------------------------------------------+
|                  4. ทดสอบระบบและอุดช่องโหว่ (Testing & Hardening)         |
| - ทดสอบ Load Unpacked บน Chrome                                          |
| - จำลองสถานการณ์การโกง 5 รูปแบบ (เปิดแท็บ, สลับจอ, DevTools, ปิดแท็บ)    |
| - ทดสอบการส่งข้อมูลเข้า Google Sheets และหน้า Monitor สด                  |
+--------------------------------------------------------------------------+
                                    │
                                    ▼
+--------------------------------------------------------------------------+
|                      5. การนำไปติดตั้งใช้งานจริง (Deployment)             |
| - เครื่องห้องแล็บ/โรงเรียน : ติดตั้งแบบบังคับ (Force-install ผ่าน Registry/GPO)|
| - เครื่องส่วนตัว (BYOD)    : แจกไฟล์ .zip หรือขึ้น Chrome Web Store (Unlisted)|
+--------------------------------------------------------------------------+
```

---

## 📁 โครงสร้างไฟล์ในโปรเจกต์

| ชื่อไฟล์ | บทบาทหน้าที่ |
| :--- | :--- |
| [`manifest.json`](manifest.json) | ไฟล์ตั้งค่า Manifest V3 กำหนด Permissions, Host Permissions และ Script Mapping |
| [`background.js`](background.js) | Service Worker คอยเฝ้าระวังแท็บ หน้าต่าง และส่งแจ้งเตือน Webhook ด้วย `fetch()` |
| [`content.js`](content.js) | ฝังตัวในหน้า Google Forms เพื่อกรอก/ซ่อน Secret Token และดักจับ Keyboard/Blur/Visibility |
| [`popup.html`](popup.html) | หน้าต่างควบคุมของ Extension แบ่งเป็นแท็บผู้สอบ และแท็บตั้งค่า Admin |
| [`popup.js`](popup.js) | จัดการเหตุการณ์ใน Popup, ตรวจสอบรหัส Admin, เริ่ม/หยุดสอบ และทดสอบ Webhook |
| [`monitor.html`](monitor.html) | หน้าจอแดชบอร์ดสำหรับผู้คุมสอบ (มีแถบกำหนด/เปลี่ยน URL ข้อสอบ Google Forms ในตัว และติดตาม Log สด) |
| [`monitor.js`](monitor.js) | ดึงข้อมูลจาก Webhook อัตโนมัติ จัดการบันทึก URL ข้อสอบ มีระบบค้นหา ตัวจำลองเหตุการณ์ และเสียงเตือน |
| [`google-apps-script.js`](google-apps-script.js) | สคริปต์ Webhook สำหรับติดตั้งบน Google Sheets (รองรับทั้ง POST และ GET) |

---

## 🌟 จุดเด่น: ใช้งานกับ Google Forms ไหนก็ได้ 100%

ระบบถูกออกแบบให้มีความยืดหยุ่นสูงสุด รองรับการใช้งาน 2 โหมด:
1. **โหมดกำหนดฟอร์มกลาง (Centralized Mode)**:
   - ผู้คุมสอบระบุลิงก์ Google Forms ไว้ล่วงหน้า (ผ่านหน้า Popup หรือหน้า Admin Monitor)
   - เมื่อผู้สอบใส่ชื่อแล้วกด "เริ่มสอบ" ระบบจะเปิดฟอร์มนั้นให้โดยอัตโนมัติ และล็อกหน้าต่างเต็มจอทันที
2. **โหมดอิสระ (Open / Any Form Mode)**:
   - ผู้คุมสอบไม่ต้องกำหนด URL ไว้ล่วงหน้า (ปล่อยว่าง)
   - ผู้สอบสามารถนำลิงก์ Google Forms ใดก็ได้มาวาง หรือกดปุ่ม **"🎯 ใช้แท็บปัจจุบัน"** หากเปิดข้อสอบทิ้งไว้อยู่แล้ว
   - **ใช้ได้กับทุกฟอร์ม**: ไม่ว่าฟอร์มนั้นจะมีช่อง Secret Token หรือเป็นฟอร์มธรรมดาทั่วไป ระบบจะทำการล็อกหน้าจอเต็มจอ ห้ามเปิดแท็บใหม่ ห้ามกด Alt+Tab และป้องกันการโกงทุกรูปแบบเช่นเดียวกันทั้งหมด!

---

## 🛠️ ขั้นตอนที่ 1: เตรียม Google Forms และระบบรับแจ้งเตือน (30 นาที)

### 1.1 ตั้งค่า Google Forms ข้อสอบ
1. เข้าไปที่ [Google Forms](https://forms.google.com/) แล้วสร้างแบบฟอร์มใหม่
2. **สร้างส่วนที่ 1 (Section 1 - ส่วนตรวจสอบสิทธิ์)**:
   - เพิ่มคำถามข้อที่ 1: `รหัสประจำตัว หรือ ชื่อ-นามสกุล` (ประเภท: **คำตอบสั้นๆ / Short answer**) ตั้งเป็น "จำเป็นต้องตอบ" (Required)
   - เพิ่มคำถามข้อที่ 2: `รหัสลับเข้าสอบ (Secret Token)` (ประเภท: **คำตอบสั้นๆ / Short answer**)
   - กดจุดสามจุด (⋮) ที่มุมขวาล่างของคำถามข้อที่ 2 แล้วเลือก **"การตรวจสอบการตอบกลับ" (Response validation)**
   - กำหนดเงื่อนไข:
     - ช่องที่ 1: เลือก **นิพจน์ทั่วไป (Regular expression)**
     - ช่องที่ 2: เลือก **ตรงกัน (Matches)**
     - ช่องที่ 3: ระบุรหัสลับ เช่น `EXAM_LOCK_999`
     - ช่องที่ 4 (ข้อความแสดงข้อผิดพลาด): พิมพ์ `ไม่อนุญาตให้เข้าสอบโดยไม่ผ่านระบบคุมสอบ Extension`
3. **สร้างส่วนที่ 2 (Section 2 - ข้อสอบจริง)**:
   - กดปุ่ม **"เพิ่มส่วน" (Add section)** ไอคอนรูปสี่เหลี่ยมผืนผ้าสองชั้น
   - ตั้งชื่อส่วน เช่น "ข้อสอบวิชาคอมพิวเตอร์"
   - สร้างข้อสอบปรนัยหรืออัตนัยตามต้องการในส่วนนี้
   > **ผลลัพธ์**: หากผู้สอบไม่เปิดผ่าน Extension จะไม่รู้รหัสลับ และจะไม่สามารถกดปุ่ม "ถัดไป" (Next) เพื่อเข้าทำข้อสอบในส่วนที่ 2 ได้เลย!

### 1.2 ติดตั้ง Google Apps Script Webhook
1. เปิด [Google Sheets](https://sheets.new) ตั้งชื่อไฟล์ เช่น `Exam_Proctor_Database`
2. ไปที่เมนู **ส่วนขยาย (Extensions)** -> **Apps Script**
3. ลบโค้ดในไฟล์ `Code.gs` ออกทั้งหมด แล้วคัดลอกโค้ดจากไฟล์ [`google-apps-script.js`](google-apps-script.js) ไปวาง
4. กดบันทึก (Ctrl+S)
5. กดปุ่มสีน้ำเงิน **ทำให้ใช้งานได้ (Deploy)** -> **การทำให้ใช้งานได้รายการใหม่ (New deployment)**
6. กดรูปเฟือง ⚙️ เลือก **เว็บแอป (Web app)**:
   - **คำอธิบาย**: `Exam Proctor Webhook`
   - **ดำเนินการในฐานะ (Execute as)**: `ฉัน (Me)`
   - **ผู้มีสิทธิ์เข้าถึง (Who has access)**: `ทุกคน (Anyone)` *(สำคัญที่สุด)*
7. กด **ทำให้ใช้งานได้ (Deploy)** -> กด **ให้สิทธิ์การเข้าถึง (Authorize Access)**
8. คัดลอก **URL ของเว็บแอป (Web App URL)** ที่ได้มา (เช่น `https://script.google.com/macros/s/.../exec`) เพื่อนำไปใส่ใน Extension

---

## ⚙️ ขั้นตอนที่ 2 & 3: การทำงานของระบบ Extension และ Anti-Cheating

### กลไกการทำงานที่สำคัญ
1. **Auto-Fill & Hide Secret Token ([`content.js`](content.js))**:
   - เมื่อผู้สอบกดเริ่มสอบ Extension จะเปิดลิงก์ Google Forms
   - `content.js` ตรวจจับช่องที่มีคำว่า "รหัสลับ" หรือ "Secret Token"
   - ใส่รหัส `EXAM_LOCK_999` ให้อัตโนมัติ พร้อมสั่ง `dispatchEvent` เพื่อให้ Google Forms รับรู้ค่า
   - ซ่อนคำถามข้อนั้นด้วย `display: none !important` ทำให้นักเรียนมองไม่เห็นช่องนี้
2. **Tab Lockdown ([`background.js`](background.js))**:
   - ใช้ `chrome.tabs.onCreated` ตรวจจับทันทีหากมีการกด `Ctrl+T` หรือกดเปิดแท็บใหม่
   - Extension จะสั่ง `chrome.tabs.remove(tab.id)` ปิดแท็บนั้นทิ้งทันทีภายในเสี้ยววินาที และยิงรายงานแจ้งเตือน
3. **Window Blur & Focus Lock ([`background.js`](background.js) & [`content.js`](content.js))**:
   - ตรวจจับการกด `Alt+Tab`, ย่อหน้าจอ, หรือคลิกเปิดโปรแกรมอื่นทับ
   - บังคับดึงหน้าต่างกลับมา Focus และเข้าสู่โหมดเต็มจอ `fullscreen` อัตโนมัติ
4. **DevTools & Inspection Block ([`content.js`](content.js))**:
   - บล็อกปุ่ม `F12`, `Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+Shift+C`
   - บล็อกคลิกขวา (Context Menu) และบล็อก `Ctrl+U`, `Ctrl+P`, `Ctrl+S`
   - บล็อกการลากคลุมข้อความ (user-select: none)
5. **Anti-Tamper Lockdown ([`background.js`](background.js))**:
   - หากผู้สอบพยายามเปิด `chrome://extensions` หรือ `chrome://settings` เพื่อกดปิด Extension ระบบจะปิดแท็บนั้นทันทีและส่งแจ้งเตือนระดับวิกฤต
6. **Auto-Unlock upon Submit**:
   - เมื่อผู้สอบกดส่งฟอร์มสำเร็จ ระบบจะตรวจพบข้อความ "เราได้บันทึกคำตอบของคุณไว้แล้ว" และปลดล็อกหน้าต่างเต็มจอกลับสู่สภาพปกติอัตโนมัติ

---

## 🧪 ขั้นตอนที่ 4: การทดสอบระบบและอุดช่องโหว่ (Testing & Hardening)

### วิธีนำ Extension ไปทดสอบในเบราว์เซอร์:
1. เปิด Google Chrome แล้วเข้าไปที่ `chrome://extensions/`
2. เปิดสวิตช์ **โหมดนักพัฒนา (Developer mode)** ที่มุมขวาบน
3. กดปุ่ม **โหลดส่วนขยายที่คลายการแพค (Load unpacked)**
4. เลือกโฟลเดอร์โปรเจกต์ `d:\ExamProctorExtension`
5. จะพบไอคอน Extension **Exam Proctor Lock v2.1** ปรากฏขึ้นมา

### เช็กลิสต์ทดสอบสถานการณ์โกง 5 รูปแบบ:
| รายการทดสอบ | การกระทำ | ผลลัพธ์ที่ถูกต้อง |
| :--- | :--- | :--- |
| **1. ทดสอบ Flow ปกติ** | ใส่ชื่อ -> กดเริ่มทำข้อสอบ | เปิดหน้าข้อสอบแบบเต็มจอ, รหัสลับถูกกรอกและซ่อนอัตโนมัติ, กด "ถัดไป" เข้าหน้า 2 ได้ทันที |
| **2. เปิดแท็บใหม่** | กด `Ctrl+T` หรือคลิกเครื่องหมาย `+` | แท็บใหม่ถูกปิดทันที และมีแจ้งเตือนบันทึกลงในชีต/หน้า Monitor |
| **3. สลับโปรแกรม** | กด `Alt+Tab` หรือกดปุ่ม `Windows` | หน้าต่างถูกดึงกลับมาเป็น Fullscreen ทันที พร้อมแสดงแถบเตือนสีแดง |
| **4. เปิด DevTools** | กด `F12` หรือคลิกขวาบนหน้าข้อสอบ | ถูกบล็อกทันที ไม่แสดงแถบตรวจสอบโค้ด และส่ง Log แจ้งเตือน |
| **5. ปิด Extension** | พิมพ์ `chrome://extensions` ใน Address Bar | แท็บถูกปิดทันที และส่งสัญญาณแจ้งเตือนระดับวิกฤต |

---

## 🚀 ขั้นตอนที่ 5: การนำไปติดตั้งใช้งานจริง (Deployment)

### รูปแบบที่ 1: สำหรับเครื่องคอมพิวเตอร์ในห้องปฏิบัติการ (Lab / Managed Devices) - *ปลอดภัยสูงสุด*
สำหรับเครื่องที่ควบคุมโดยแอดมินหรือติดตั้งในห้องสอบ สามารถใช้ฟีเจอร์ **Force-install** เพื่อบังคับติดตั้ง Extension และป้องกันไม่ให้ผู้สอบกดลบหรือปิดการทำงานได้:

#### วิธีตั้งค่าผ่าน Windows Registry:
1. เปิดโปรแกรม Notepad แล้วบันทึกโค้ดด้านล่างเป็นไฟล์ `install_exam_lock.reg`:
```reg
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist]
"1"="<EXTENSION_ID>;file:///C:/ExamProctorExtension/update.xml"
```
*(หรือหากติดตั้งผ่าน Local unpacked ในห้องแล็บ สามารถเปิดโหมด Kiosk ด้วยคำสั่ง Chrome flag)*

#### วิธีตั้งค่าผ่าน Chrome Enterprise / Google Admin Console (Chromebook หรือ Chrome Browser Cloud Management):
1. เข้าไปที่ Google Admin Console (`admin.google.com`)
2. ไปที่ **Devices** -> **Chrome** -> **Apps & extensions** -> **Users & browsers**
3. เพิ่ม Extension และตั้งค่านโยบายเป็น **Force install + pin to browser toolbar**
4. ปิดกั้นการเปิด URL `chrome://extensions` และ `chrome://settings` สำหรับโปรไฟล์นักเรียน

---

### รูปแบบที่ 2: สำหรับเครื่องส่วนตัวของผู้สอบ (BYOD - Bring Your Own Device)
1. **วิธีแจกไฟล์ (.zip)**:
   - บีบอัดไฟล์ในโฟลเดอร์นี้เป็น `.zip` ส่งให้นักเรียนล่วงหน้า
   - ให้นักเรียนแตกไฟล์ แล้วเข้า `chrome://extensions/` -> เปิด Developer Mode -> กด "Load unpacked"
   - ในเช้าวันสอบ ครูผู้คุมสอบแจ้งลิงก์ Google Forms ในแชทหรือกระดาน
   - นักเรียนเปิด Extension วางลิงก์ ใส่รหัสประจำตัว แล้วกดเริ่มสอบ
   - **ความปลอดภัย**: หากนักเรียนคนใดไม่เปิดผ่าน Extension จะไม่รู้ Secret Token และไม่สามารถผ่านหน้าแรกของ Google Forms เข้าไปทำข้อสอบได้
2. **วิธี Chrome Web Store (Unlisted)**:
   - นำโฟลเดอร์นี้ไปอัปโหลดขึ้น Chrome Web Store
   - ตั้งค่าการเผยแพร่เป็น **ไม่เป็นสาธารณะ (Unlisted)**
   - แจกลิงก์ Chrome Web Store ให้นักเรียนกด "เพิ่มลงใน Chrome" ได้ทันทีด้วยคลิกเดียว

---

## 📊 หน้าจอผู้คุมสอบสด (Admin Real-time Monitor)

- เปิดได้ผ่านไอคอน Extension -> แท็บ **⚙️ ตั้งค่า / Monitor** -> กด **🖥️ เปิดหน้าจอ Admin Monitor แบบสด**
- ระบบจะซิงค์ข้อมูลจาก Google Sheets อัตโนมัติทุกๆ 4 วินาที
- มีระบบนับสถิติจำนวนคนทำผิด สถิติการส่งข้อสอบ และส่งเสียงเตือนอัตโนมัติเมื่อพบการทำผิดกฎ
- มีช่องค้นหาสำหรับกรองดูเฉพาะรายชื่อผู้สอบที่ต้องการตรวจสอบ
