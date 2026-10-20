const { neon } = require('@neondatabase/serverless');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_QuZ29yXvSkdo@ep-floral-lake-ao7gz400-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const sql = neon(DATABASE_URL);

async function migrate() {
  console.log('Migrating users table for 2FA support...');
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64);`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE;`;
  console.log('Migration successful: totp_secret and totp_enabled added.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
