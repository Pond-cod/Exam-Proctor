/**
 * Test Suite: System Improvements & Security Enhancements Verification
 */

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_QuZ29yXvSkdo@ep-floral-lake-ao7gz400-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
process.env.DATABASE_URL = DATABASE_URL;
const handler = require("../api/index.js");

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
  console.log("=== Running System Improvements Verification Tests ===\n");
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
  let teacherToken = "";

  // 1. Login Admin to obtain Bearer token
  await test("1. Obtain Admin Bearer token", async () => {
    const { req, res, getResult } = mockReqRes("POST", {
      action: "verifyLogin",
      username: "admin",
      passcode: "admin123"
    });
    await handler(req, res);
    const r = getResult();
    if (r.data.status !== "success" || !r.data.token) throw new Error("Failed to login admin");
    adminToken = r.data.token;
  });

  // 2. Login Teacher to obtain Bearer token
  await test("2. Obtain Teacher Bearer token", async () => {
    const { req, res, getResult } = mockReqRes("POST", {
      action: "verifyLogin",
      username: "teacher",
      passcode: "teacher123"
    });
    await handler(req, res);
    const r = getResult();
    if (r.data.status !== "success" || !r.data.token) throw new Error("Failed to login teacher");
    teacherToken = r.data.token;
  });

  // 3. getAllRooms without Auth should be 401 (C-04)
  await test("3. getAllRooms without Auth returns 401 Unauthorized", async () => {
    const { req, res, getResult } = mockReqRes("GET", {}, { action: "getAllRooms" });
    await handler(req, res);
    const r = getResult();
    if (r.status !== 401) throw new Error(`Expected 401 but got ${r.status}`);
  });

  // 4. getAllRooms with Admin Auth should return rooms and unmasked passcodes
  await test("4. getAllRooms with Admin Auth returns rooms", async () => {
    const { req, res, getResult } = mockReqRes("GET", {}, { action: "getAllRooms" }, {
      Authorization: `Bearer ${adminToken}`
    });
    await handler(req, res);
    const r = getResult();
    if (r.data.status !== "success" || !Array.isArray(r.data.data)) {
      throw new Error("Failed to fetch rooms as admin");
    }
  });

  // 5. getLogs without Auth should be 401 (H-06)
  await test("5. getLogs without Auth returns 401 Unauthorized", async () => {
    const { req, res, getResult } = mockReqRes("GET", {}, { action: "getLogs" });
    await handler(req, res);
    const r = getResult();
    if (r.status !== 401) throw new Error(`Expected 401 but got ${r.status}`);
  });

  // 6. getLogs with Teacher Auth succeeds
  await test("6. getLogs with Teacher Auth succeeds", async () => {
    const { req, res, getResult } = mockReqRes("GET", {}, { action: "getLogs" }, {
      Authorization: `Bearer ${teacherToken}`
    });
    await handler(req, res);
    const r = getResult();
    if (r.data.status !== "success" || !Array.isArray(r.data.data)) {
      throw new Error("Failed to fetch logs with teacher token");
    }
  });

  // 7. Reject token in queryParams (M-05)
  await test("7. Token in URL queryParams is rejected", async () => {
    const { req, res, getResult } = mockReqRes("GET", {}, {
      action: "getAllRooms",
      authToken: adminToken // passed via URL queryParam
    });
    await handler(req, res);
    const r = getResult();
    if (r.status !== 401) throw new Error(`Expected 401 because queryParams.authToken is rejected, got ${r.status}`);
  });

  // 8. logEvent spam protection (H-07)
  await test("8. logEvent rapid calls are throttled by Spam Guard", async () => {
    const { req: req1, res: res1, getResult: getResult1 } = mockReqRes("POST", {
      action: "logEvent",
      studentId: "999999",
      violation: "ทดสอบ Spam Guard ครั้งที่ 1"
    }, {}, {}, { "x-forwarded-for": "10.0.0.99" });
    await handler(req1, res1);

    const { req: req2, res: res2, getResult: getResult2 } = mockReqRes("POST", {
      action: "logEvent",
      studentId: "999999",
      violation: "ทดสอบ Spam Guard ครั้งที่ 2 ทันที"
    }, {}, {}, { "x-forwarded-for": "10.0.0.99" });
    await handler(req2, res2);

    const r2 = getResult2();
    if (!r2.data.message || !r2.data.message.includes("throttled")) {
      throw new Error("Spam Guard did not throttle rapid request: " + JSON.stringify(r2.data));
    }
  });

  console.log(`\n=== Verification Results: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
