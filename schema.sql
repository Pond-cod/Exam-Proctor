-- ===================================================================
-- Neon PostgreSQL Database Schema for Exam Proctor Studio
-- Project: ExamProctor (Region: AWS Singapore ap-southeast-1)
-- ===================================================================

-- 1. ตาราง users (จัดเก็บบัญชีผู้ใช้งานระบบ Role Admin / Teacher)
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'TEACHER', -- 'ADMIN' | 'TEACHER'
    passcode VARCHAR(255) NOT NULL, -- Hashed with scrypt (scrypt$<salt>$<hash>)
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'INACTIVE'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- 2. ตาราง system_config (จัดเก็บการตั้งค่าระบบกลางแถวเดียว)
CREATE TABLE IF NOT EXISTS system_config (
    id INT PRIMARY KEY DEFAULT 1,
    master_admin_passcode VARCHAR(64) NOT NULL DEFAULT '999888',
    system_name TEXT NOT NULL DEFAULT 'Exam Proctor Studio',
    portal_announcement TEXT DEFAULT 'ยินดีต้อนรับสู่นักเรียนทุกคน ขอให้ทำข้อสอบด้วยความตั้งใจและความซื่อสัตย์',
    teacher_passcode VARCHAR(64) NOT NULL DEFAULT '111222',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT single_row_check CHECK (id = 1)
);

-- 3. ตาราง exam_rooms (จัดเก็บข้อมูลห้องสอบทั้งหมด)
CREATE TABLE IF NOT EXISTS exam_rooms (
    room_id VARCHAR(64) PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'แบบทดสอบออนไลน์',
    category VARCHAR(100) DEFAULT 'ทั่วไป (General)',
    grade_level VARCHAR(100) DEFAULT 'ไม่ระบุ (All / Not Specified)',
    form_url TEXT NOT NULL,
    exam_url TEXT,
    entry_code VARCHAR(32) NOT NULL,
    admin_passcode VARCHAR(32) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- 'OPEN' | 'CLOSED'
    created_by TEXT,
    creator_username VARCHAR(64),
    creator_id VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ตาราง exam_logs (บันทึกเหตุการณ์การสอบและการแจ้งเตือนเหตุการณ์ผิดปกติ)
CREATE TABLE IF NOT EXISTS exam_logs (
    log_id VARCHAR(64) PRIMARY KEY,
    room_id VARCHAR(64) REFERENCES exam_rooms(room_id) ON DELETE SET NULL,
    room_title TEXT,
    student_id TEXT NOT NULL,
    event_type VARCHAR(32) NOT NULL DEFAULT 'VIOLATION', -- 'START' | 'FINISH' | 'VIOLATION'
    violation_detail TEXT,
    violation_count INT DEFAULT 0,
    severity VARCHAR(32) DEFAULT '⚠️ ทั่วไป',
    formatted_time VARCHAR(32),
    iso_timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes เพื่อเพิ่มความเร็วในการ Query แบบ Real-time
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_exam_rooms_status ON exam_rooms(status);
CREATE INDEX IF NOT EXISTS idx_exam_rooms_creator ON exam_rooms(creator_username);
CREATE INDEX IF NOT EXISTS idx_exam_logs_room_id ON exam_logs(room_id);
CREATE INDEX IF NOT EXISTS idx_exam_logs_timestamp ON exam_logs(iso_timestamp DESC);

-- ===================================================================
-- Initial Seed Data (ข้อมูลเริ่มต้นของระบบ)
-- ===================================================================

-- บัญชีเริ่มต้นสำหรับ Admin และ Teacher
INSERT INTO users (user_id, username, display_name, role, passcode, status)
VALUES 
    ('USR-ADMIN', 'admin', 'ผู้ดูแลระบบหลัก (Super Admin)', 'ADMIN', 'admin1234', 'ACTIVE'),
    ('USR-TEACHER', 'teacher', 'ครูผู้สอน / ผู้คุมสอบ', 'TEACHER', 'teacher1234', 'ACTIVE')
ON CONFLICT (username) DO UPDATE 
SET passcode = EXCLUDED.passcode WHERE users.username IN ('admin', 'teacher');

-- การตั้งค่าระบบกลางเริ่มต้น
INSERT INTO system_config (id, master_admin_passcode, system_name, portal_announcement, teacher_passcode)
VALUES (1, '999888', 'Exam Proctor Studio', 'ยินดีต้อนรับสู่นักเรียนทุกคน ขอให้ทำข้อสอบด้วยความตั้งใจและความซื่อสัตย์', '111222')
ON CONFLICT (id) DO NOTHING;
