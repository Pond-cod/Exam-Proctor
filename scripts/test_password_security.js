/**
 * Test Suite: Password Encryption & Authentication Security
 */

const { neon } = require("@neondatabase/serverless");
const handler = require("../api/index.js");

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_QuZ29yXvSkdo@ep-floral-lake-ao7gz400-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
process.env.DATABASE_URL = DATABASE_URL;
const sql = neon(DATABASE_URL);

function mockReqRes(method, body = {}, query = {}, headers = {}) {
  const req = {
    method,
    body,
    query,
    headers: { ...headers }
  };
  let responseData = null;
  let statusCode = 200;
  const res = {
    setHeader: () => {},
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      responseData = data;
      return res;
    },
    end: () => res
  };
  return {
    req,
    res,
    getResult: () => ({ status: statusCode, data: responseData })
  };
}

async function runTests() {
  console.log("=== Running Password Security & Hashing Tests ===\n");
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  let adminToken = "";

  // Test 1: Admin login with scrypt hash in DB
  await test("1. Admin login with correct password ('admin123')", async () => {
    const { req, res, getResult } = mockReqRes("POST", {
      action: "verifyLogin",
      username: "admin",
      passcode: "admin123"
    });
    await handler(req, res);
    const result = getResult();
    if (result.data.status !== "success" || !result.data.token) {
      throw new Error("Admin login failed: " + JSON.stringify(result.data));
    }
    adminToken = result.data.token;
  });

  // Test 2: Teacher login with scrypt hash in DB
  await test("2. Teacher login with correct password ('teacher123')", async () => {
    const { req, res, getResult } = mockReqRes("POST", {
      action: "verifyLogin",
      username: "teacher",
      passcode: "teacher123"
    });
    await handler(req, res);
    const result = getResult();
    if (result.data.status !== "success" || !result.data.token) {
      throw new Error("Teacher login failed: " + JSON.stringify(result.data));
    }
  });

  // Test 3: Teacher2 login with scrypt hash in DB
  await test("3. Teacher2 login with correct password ('teacher2')", async () => {
    const { req, res, getResult } = mockReqRes("POST", {
      action: "verifyLogin",
      username: "teacher2",
      passcode: "teacher2"
    });
    await handler(req, res);
    const result = getResult();
    if (result.data.status !== "success" || !result.data.token) {
      throw new Error("Teacher2 login failed: " + JSON.stringify(result.data));
    }
  });

  // Test 4: Rejection of wrong password
  await test("4. Rejection of incorrect password", async () => {
    const { req, res, getResult } = mockReqRes("POST", {
      action: "verifyLogin",
      username: "admin",
      passcode: "wrongpassword123"
    });
    await handler(req, res);
    const result = getResult();
    if (result.data.status !== "error") {
      throw new Error("Expected failure but got success: " + JSON.stringify(result.data));
    }
  });

  // Test 5: Create user and verify password is saved as scrypt hash
  const testUsername = "sec_test_user";
  const testPassword = "MyStrongPassword2026!";
  let testUserId = "";

  await test("5. Create new user and verify passcode is hashed in DB", async () => {
    // Delete if already exists
    await sql`DELETE FROM users WHERE username = ${testUsername};`;

    const { req, res, getResult } = mockReqRes("POST", {
      action: "createUser",
      username: testUsername,
      displayName: "Security Test User",
      role: "TEACHER",
      passcode: testPassword,
      status: "ACTIVE"
    }, {}, { Authorization: `Bearer ${adminToken}` });

    await handler(req, res);
    const result = getResult();
    if (result.data.status !== "success") {
      throw new Error("createUser failed: " + JSON.stringify(result.data));
    }
    testUserId = result.data.data.userId;

    // Check DB row directly
    const rows = await sql`SELECT passcode FROM users WHERE username = ${testUsername};`;
    if (rows.length === 0) throw new Error("User was not found in DB");
    const storedPass = rows[0].passcode;
    if (!storedPass.startsWith("scrypt$")) {
      throw new Error(`Passcode is not scrypt hashed! Stored value: '${storedPass}'`);
    }
  });

  // Test 6: Login with newly created user
  await test("6. Login with newly created hashed user", async () => {
    const { req, res, getResult } = mockReqRes("POST", {
      action: "verifyLogin",
      username: testUsername,
      passcode: testPassword
    });
    await handler(req, res);
    const result = getResult();
    if (result.data.status !== "success" || !result.data.token) {
      throw new Error("Login with new user failed: " + JSON.stringify(result.data));
    }
  });

  // Test 7: Update user's password and verify new hash
  const updatedPassword = "UpdatedPassword2026!";
  await test("7. Update user password and verify new scrypt hash", async () => {
    const { req, res, getResult } = mockReqRes("POST", {
      action: "updateUser",
      userId: testUserId,
      passcode: updatedPassword
    }, {}, { Authorization: `Bearer ${adminToken}` });

    await handler(req, res);
    const result = getResult();
    if (result.data.status !== "success") {
      throw new Error("updateUser failed: " + JSON.stringify(result.data));
    }

    const rows = await sql`SELECT passcode FROM users WHERE user_id = ${testUserId};`;
    const storedPass = rows[0].passcode;
    if (!storedPass.startsWith("scrypt$")) {
      throw new Error(`Updated passcode is not scrypt hashed! Stored value: '${storedPass}'`);
    }
  });

  // Test 8: Login with updated password succeeds, old password fails
  await test("8. Login with updated password (old password rejected)", async () => {
    // Old password should fail
    const { req: reqOld, res: resOld, getResult: getOld } = mockReqRes("POST", {
      action: "verifyLogin",
      username: testUsername,
      passcode: testPassword
    });
    await handler(reqOld, resOld);
    if (getOld().data.status !== "error") {
      throw new Error("Old password should have been rejected!");
    }

    // New password should succeed
    const { req: reqNew, res: resNew, getResult: getNew } = mockReqRes("POST", {
      action: "verifyLogin",
      username: testUsername,
      passcode: updatedPassword
    });
    await handler(reqNew, resNew);
    if (getNew().data.status !== "success" || !getNew().data.token) {
      throw new Error("Login with updated password failed: " + JSON.stringify(getNew().data));
    }
  });

  // Test 9: Clean up test user
  await test("9. Clean up test user", async () => {
    const { req, res, getResult } = mockReqRes("POST", {
      action: "deleteUser",
      userId: testUserId
    }, {}, { Authorization: `Bearer ${adminToken}` });
    await handler(req, res);
    const result = getResult();
    if (result.data.status !== "success") {
      throw new Error("deleteUser failed: " + JSON.stringify(result.data));
    }
  });

  // Test 10: Verify 0 plaintext passwords in users table
  await test("10. Verify NO plaintext passcodes remain in users table", async () => {
    const unhashed = await sql`SELECT user_id, username, passcode FROM users WHERE passcode NOT LIKE 'scrypt$%' AND passcode NOT LIKE '$%';`;
    if (unhashed.length > 0) {
      throw new Error(`Found ${unhashed.length} unhashed users: ` + JSON.stringify(unhashed));
    }
  });

  console.log(`\n=== Test Results: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
