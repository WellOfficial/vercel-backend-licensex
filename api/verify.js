/**
 * VERCEL SERVERLESS FUNCTION: License Verification API
 * * วิธีการติดตั้งบน Vercel:
 * 1. สร้างโฟลเดอร์ชื่อ `api` และสร้างไฟล์ชื่อ `verify.js` แล้ววางโค้ดนี้ลงไป
 * 2. สร้างไฟล์ `package.json` ด้านนอกสุด (ระดับเดียวกับโฟลเดอร์ api) และใส่ dependencies: "firebase-admin" และ "cors"
 * 3. ไปตั้งค่า Environment Variables ใน Vercel โดยตั้งชื่อ Key ว่า FIREBASE_SERVICE_ACCOUNT
 * 4. นำข้อมูลในไฟล์ Service Account (.json) จาก Firebase มาวางในช่อง Value
 */

const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });

export default async function handler(req, res) {
  // เปิดใช้งาน CORS เพื่อให้ดึงข้อมูลข้ามโดเมนได้
  await new Promise((resolve, reject) => {
    cors(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });

  // อนุญาตเฉพาะ POST Request เท่านั้น
  if (req.method !== 'POST') {
    return res.status(405).json({ valid: false, message: 'Method Not Allowed' });
  }

  // ---------------------------------------------------------
  // 1. ตรวจสอบการตั้งค่า Firebase Admin (เช็คว่าเชื่อมต่อได้ไหม)
  // ---------------------------------------------------------
  if (!admin.apps.length) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } catch (error) {
      console.error("Firebase Init Error:", error);
      return res.status(500).json({ 
        valid: false, 
        message: 'การเชื่อมต่อ Firebase ผิดพลาด: โปรดตรวจสอบ FIREBASE_SERVICE_ACCOUNT ใน Vercel (' + error.message + ')' 
      });
    }
  }

  const db = admin.firestore();
  const { key, hwid } = req.body;

  if (!key) {
    return res.status(400).json({ valid: false, message: 'License key is required.' });
  }

  // ---------------------------------------------------------
  // 2. ค้นหาข้อมูล License Key (พร้อมส่ง Error กลับไปแสดงผล)
  // ---------------------------------------------------------
  try {
    const querySnapshot = await db.collectionGroup('licenses').where('key', '==', key).get();

    if (querySnapshot.empty) {
      return res.status(404).json({ valid: false, message: 'Invalid License Key.' });
    }

    const licenseDoc = querySnapshot.docs[0];
    const licenseData = licenseDoc.data();

    // ตรวจสอบสถานะ (Active, Suspended, Revoked)
    if (licenseData.status !== 'active') {
      return res.status(403).json({ 
        valid: false, 
        message: `License is ${licenseData.status}. Contact support.` 
      });
    }

    // ตรวจสอบวันหมดอายุ
    if (Date.now() > licenseData.expiresAt) {
      await licenseDoc.ref.update({ status: 'expired' });
      return res.status(403).json({ valid: false, message: 'License has expired.' });
    }

    // ตรวจสอบและผูก Hardware ID (HWID)
    if (hwid) {
      if (!licenseData.hardwareId) {
        await licenseDoc.ref.update({ 
          hardwareId: hwid,
          currentActivations: admin.firestore.FieldValue.increment(1)
        });
      } else if (licenseData.hardwareId !== hwid) {
        return res.status(403).json({ 
          valid: false, 
          message: 'Hardware ID mismatch. License already bound to another machine.' 
        });
      }
    }

    return res.status(200).json({ 
      valid: true, 
      message: 'Authentication successful',
      expiresAt: licenseData.expiresAt
    });

  } catch (error) {
    console.error('License Verification Error:', error);
    
    // ส่ง Error แบบดิบๆ (Raw Error) กลับไปที่หน้าจอเพื่อให้เห็นลิงก์โดยตรง
    return res.status(500).json({ 
      valid: false, 
      message: 'Database Error: ' + error.message 
    });
  }
}
