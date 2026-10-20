/**
 * Password Encryption Migration Script for Exam Proctor Studio
 * Migrates plain text passcodes in Neon Postgres to secure scrypt hashes.
 * Format: scrypt$<salt_hex>$<derived_key_hex>
 */

const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_QuZ29yXvSkdo@ep-floral-lake-ao7gz400-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const sql = neon(DATABASE_URL);

function hashPassword(password) {
  if (!password || typeof password !== "string") return "";
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

async function run() {
  console.log("=== Starting Password Encryption Migration ===");

  // 1. Expand column width to VARCHAR(255) if necessary
  console.log("Expanding column width: ALTER TABLE users ALTER COLUMN passcode TYPE VARCHAR(255)...");
  await sql`ALTER TABLE users ALTER COLUMN passcode TYPE VARCHAR(255);`;
  console.log("Column width expanded successfully.");

  // 2. Fetch all users
  const users = await sql`SELECT user_id, username, passcode FROM users ORDER BY created_at;`;
  console.log(`Found ${users.length} users in database.`);

  let migratedCount = 0;
  for (const user of users) {
    if (user.passcode && user.passcode.startsWith("scrypt$")) {
      console.log(`- User '${user.username}' is already encrypted. Skipping.`);
    } else {
      const plaintext = user.passcode;
      const hashed = hashPassword(plaintext);
      await sql`
        UPDATE users
        SET passcode = ${hashed}, updated_at = NOW()
        WHERE user_id = ${user.user_id};
      `;
      console.log(`- User '${user.username}' encrypted: '${plaintext}' -> '${hashed.substring(0, 20)}...'`);
      migratedCount++;
    }
  }

  console.log(`\nMigration completed: ${migratedCount} passwords encrypted.`);

  // Verify resulting table state
  const updatedUsers = await sql`SELECT user_id, username, role, passcode, status FROM users ORDER BY created_at;`;
  console.log("\n=== Updated users in Neon database ===");
  for (const u of updatedUsers) {
    console.log(`- [${u.role}] ${u.username}: ${u.passcode.substring(0, 30)}... (length: ${u.passcode.length})`);
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
