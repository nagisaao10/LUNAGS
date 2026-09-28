/**
 * 管理者データ構造チェーン診断スクリプト
 * 
 * 以下のチェーンが成立しているかを検証します:
 * Firebase Authentication
 *         ↓
 *        uid
 *         ↓
 *    uidMap/{uid}
 *         ↓
 *       userId
 *         ↓
 *   users/{userId}
 *         ↓
 *       email
 *         ↓
 *  adminAccount/{email}
 *         ↓
 *     active: true
 * 
 * 使い方:
 *   node check-admin-chain.js <emailまたはuid>
 */

import admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

async function checkChain(identifier) {
    console.log(`\n========================================`);
    console.log(`管理者データ構造チェーン診断: "${identifier}"`);
    console.log(`========================================\n`);

    let uid = "";
    let authUser = null;

    // 1. Firebase Authentication
    process.stdout.write("[Step 1] Firebase Authentication: ");
    try {
        if (identifier.includes("@")) {
            authUser = await admin.auth().getUserByEmail(normalizeEmail(identifier));
        } else {
            authUser = await admin.auth().getUser(identifier);
        }
        uid = authUser.uid;
        console.log(`OK (uid: ${uid}, email: ${authUser.email}, disabled: ${authUser.disabled})`);
    } catch (err) {
        console.log(`NG (${err.message})`);
        console.log("\n❌ Firebase Auth にユーザーが存在しません。");
        return;
    }

    if (authUser.disabled) {
        console.log("⚠️ 警告: このAuthユーザーは無効化(disabled)されています。");
    }

    // 2. uidMap/{uid}
    process.stdout.write(`[Step 2] Firestore uidMap/${uid}: `);
    let userId = "";
    try {
        const uidMapSnap = await db.collection("uidMap").doc(uid).get();
        if (uidMapSnap.exists) {
            userId = uidMapSnap.data()?.userId || "";
            if (userId) {
                console.log(`OK (userId: ${userId})`);
            } else {
                console.log(`NG (ドキュメントは存在しますが userId フィールドが空です)`);
            }
        } else {
            console.log(`NG (ドキュメントが存在しません)`);
        }
    } catch (err) {
        console.log(`NG (読み取りエラー: ${err.message})`);
    }

    // 3. users/{userId}
    let userEmail = "";
    if (userId) {
        process.stdout.write(`[Step 3] Firestore users/${userId}: `);
        try {
            const userSnap = await db.collection("users").doc(userId).get();
            if (userSnap.exists) {
                const userData = userSnap.data();
                userEmail = normalizeEmail(userData?.email || "");
                console.log(`OK (email: ${userEmail || "(未設定)"}, name: ${userData?.displayName || userData?.name || "(未設定)"})`);
            } else {
                console.log(`NG (ドキュメントが存在しません)`);
            }
        } catch (err) {
            console.log(`NG (読み取りエラー: ${err.message})`);
        }
    } else {
        console.log(`[Step 3] Firestore users/{userId}: SKIP (userId が取得できなかったためスキップ)`);
    }

    // メールアドレスの決定
    const targetEmail = normalizeEmail(userEmail || authUser.email || "");
    if (!targetEmail) {
        console.log("\n❌ メールアドレスが特定できないため、adminAccount の照会ができません。");
        return;
    }

    // 4. adminAccount/{email}
    process.stdout.write(`[Step 4] Firestore adminAccount/${targetEmail}: `);
    let adminAccountDoc = null;
    try {
        const adminSnap = await db.collection("adminAccount").doc(targetEmail).get();
        if (adminSnap.exists) {
            adminAccountDoc = adminSnap.data();
            console.log(`OK (ドキュメント存在: name=${adminAccountDoc?.name || "-"})`);
        } else {
            console.log(`NG (ドキュメントが存在しません)`);
        }
    } catch (err) {
        console.log(`NG (読み取りエラー: ${err.message})`);
    }

    // 5. active: true
    process.stdout.write(`[Step 5] active === true: `);
    const isActive = adminAccountDoc?.active === true;
    if (isActive) {
        console.log(`OK (active: true)`);
    } else {
        console.log(`NG (active: ${adminAccountDoc?.active})`);
    }

    // 総合判定
    console.log(`\n----------------------------------------`);
    const isComplete = !!(authUser && userId && userEmail && adminAccountDoc && isActive);
    if (isComplete) {
        console.log(`✅ データチェーン判定: 完全整合 (管理API共通認証が正常に動作します)`);
    } else {
        console.log(`⚠️ データチェーン判定: 不完全 (一部データが欠損しています)`);
        if (!userId) console.log(`   - uidMap/${uid} に userId がありません`);
        if (!userEmail) console.log(`   - users/${userId} に email がありません`);
        if (!adminAccountDoc) console.log(`   - adminAccount/${targetEmail} がありません`);
        else if (!isActive) console.log(`   - adminAccount/${targetEmail} の active が true ではありません`);
    }
    console.log(`----------------------------------------\n`);
}

const target = process.argv[2];
if (!target) {
    console.log("使用方法: node check-admin-chain.js <emailまたはuid>");
    process.exit(1);
}

checkChain(target).catch(console.error);
