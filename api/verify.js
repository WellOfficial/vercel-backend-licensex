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

// ตรวจสอบและตั้งค่า Firebase Admin
if (!admin.apps.length) {
  try {
    // ดึงค่า Service Account จากตัวแปร Environment ของ Vercel
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Error initializing Firebase Admin. Please check FIREBASE_SERVICE_ACCOUNT environment variable.");
  }
}

const db = admin.firestore();

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

  const { key, hwid } = req.body;

  if (!key) {
    return res.status(400).json({ valid: false, message: 'License key is required.' });
  }

  try {
    // ค้นหา License Key จาก Firestore
    const querySnapshot = await db.collectionGroup('licenses').where('key', '==', key).get();

    if (querySnapshot.empty) {
      return res.status(404).json({ valid: false, message: 'Invalid License Key.' });
    }

    const licenseDoc = querySnapshot.docs[0];
    const licenseData = licenseDoc.data();

    // 1. ตรวจสอบสถานะ (Active, Suspended, Revoked)
    if (licenseData.status !== 'active') {
      return res.status(403).json({ 
        valid: false, 
        message: `License is ${licenseData.status}. Contact support.` 
      });
    }

    // 2. ตรวจสอบวันหมดอายุ
    if (Date.now() > licenseData.expiresAt) {
      await licenseDoc.ref.update({ status: 'expired' });
      return res.status(403).json({ valid: false, message: 'License has expired.' });
    }

    // 3. ตรวจสอบและผูก Hardware ID (HWID)
    if (hwid) {
      if (!licenseData.hardwareId) {
        // หากยังไม่มีการผูก HWID ให้บันทึกในครั้งแรก
        await licenseDoc.ref.update({ 
          hardwareId: hwid,
          currentActivations: admin.firestore.FieldValue.increment(1)
        });
      } else if (licenseData.hardwareId !== hwid) {
        // หาก HWID ไม่ตรงกับที่บันทึกไว้
        return res.status(403).json({ 
          valid: false, 
          message: 'Hardware ID mismatch. License already bound to another machine.' 
        });
      }
    }

    // ผ่านการตรวจสอบทั้งหมด
    return res.status(200).json({ 
      valid: true, 
      message: 'Authentication successful',
      expiresAt: licenseData.expiresAt
    });

  } catch (error) {
    console.error('License Verification Error:', error);
    return res.status(500).json({ valid: false, message: 'Internal Server Error' });
  }
}