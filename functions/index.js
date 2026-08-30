import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import express from "express";
import cors from "cors";
import { Resend } from "resend";
import admin from "firebase-admin";
import crypto from "crypto";

admin.initializeApp();

const app = express();

app.use(express.json());
app.use(cors());

const resend = new Resend(process.env.RESEND_KEY);

// ========================================
// 設定
// ========================================

const VERIFICATION_COLLECTION = "emailVerifications";

// 管理者用ADMINコード
const LUNAGS_ADMIN_CODE = defineSecret("LUNAGS_ADMIN_CODE");

// 管理者アカウントのメールアドレス
const LUNAGS_ADMIN_EMAILS = defineSecret("LUNAGS_ADMIN_EMAILS");

// 一時管理者認証の有効時間
const ADMIN_APPROVAL_EXPIRE_MS = 5 * 60 * 1000;

// ========================================
// 確認コードメール送信
// ========================================

app.post("/", async (req, res) => {
    const { email, code, name } = req.body;


    try {
        const result = await resend.emails.send({
            from: "LUNAGS <onboarding@resend.dev>",
            to: email,
            subject: "確認コード",
            html: `
        < div >
                <h2>${name || "ユーザー"}さん</h2>
                <p>認証コード:</p>
                <h1>${code}</h1>
            </div >
        `
        });

        console.log("Resend result:", result);

        if (result.error) {
            console.error(result.error);
            return res.status(500).json(result);
        }

        return res.json(result);

    } catch (err) {
        console.error("Resend error:", err);

        return res.status(500).json({
            ok: false,
            error: err.message
        });
    }


});

// ========================================
// 管理者アカウント確認
// ========================================

function isAdminEmail(email) {
    if (!email) return false;


    const adminEmails = LUNAGS_ADMIN_EMAILS
        .value()
        .split(",")
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);

    return adminEmails.includes(
        email.trim().toLowerCase()
    );


}

// ========================================
// Firebase IDトークン確認
// ========================================

async function verifyFirebaseUser(req) {
    const authHeader = req.headers.authorization;


    if (
        !authHeader ||
        !authHeader.startsWith("Bearer ")
    ) {
        throw new Error("認証トークンがありません");
    }

    const idToken = authHeader.substring(7);

    return await admin.auth().verifyIdToken(idToken);


}

// ========================================
// 管理者によるメールアドレス承認
// ========================================

app.post("/admin-approve-email", async (req, res) => {
    try {
        const decodedToken =
            await verifyFirebaseUser(req);


        // 管理者アカウントか確認
        if (!isAdminEmail(decodedToken.email)) {
            console.warn(
                `管理者メール承認拒否: ${decodedToken.email} `
            );

            return res.status(403).json({
                ok: false,
                error: "管理者権限がありません"
            });
        }

        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                ok: false,
                error: "メールアドレスが指定されていません"
            });
        }

        const targetEmail =
            email.trim().toLowerCase();

        // ランダムな一回限りの承認ID
        const approvalId =
            crypto.randomBytes(32).toString("hex");

        const now = Date.now();
        const expiresAt =
            now + ADMIN_APPROVAL_EXPIRE_MS;

        await admin.firestore()
            .collection("adminApprovals")
            .doc(approvalId)
            .set({
                email: targetEmail,
                approvedBy: decodedToken.email,
                createdAt:
                    admin.firestore.FieldValue.serverTimestamp(),
                expiresAt,
                used: false
            });

        console.log(
            `管理者メール承認: ${targetEmail} by ${decodedToken.email} `
        );

        return res.json({
            ok: true,
            approvalId,
            expiresAt
        });

    } catch (err) {
        console.error(
            "Admin email approval error:",
            err
        );

        return res.status(401).json({
            ok: false,
            error: "メールアドレスの承認に失敗しました"
        });
    }


});

// ========================================
// 管理者モード認証
// ========================================

// ログイン画面から呼ばれる。
// Firebase Authで通常パスワードの認証が
// 成功した後に呼び出す。

app.post("/admin-auth", async (req, res) => {
    const { adminCode, email } = req.body;


    try {
        // ----------------------------------------
        // 入力チェック
        // ----------------------------------------

        if (!adminCode) {
            return res.status(401).json({
                ok: false,
                error: "ADMINコードが入力されていません"
            });
        }

        if (!email) {
            return res.status(400).json({
                ok: false,
                error: "メールアドレスが指定されていません"
            });
        }

        const targetEmail =
            email.trim().toLowerCase();

        // ----------------------------------------
        // Firebase IDトークン確認
        // ----------------------------------------

        const decodedToken =
            await verifyFirebaseUser(req);

        const authenticatedEmail =
            decodedToken.email?.trim().toLowerCase();

        if (!authenticatedEmail) {
            return res.status(401).json({
                ok: false,
                error: "メールアドレスを確認できません"
            });
        }

        // ログイン中のFirebaseユーザーと
        // 入力されたメールアドレスが一致するか確認
        if (authenticatedEmail !== targetEmail) {
            return res.status(401).json({
                ok: false,
                error: "認証されたメールアドレスと一致しません"
            });
        }

        // ----------------------------------------
        // 管理者メールアドレス確認
        // ----------------------------------------

        if (!isAdminEmail(authenticatedEmail)) {
            console.warn(
                `LUNAGS 管理者認証拒否: ${authenticatedEmail} `
            );

            return res.status(403).json({
                ok: false,
                error: "管理者権限がありません"
            });
        }

        // ----------------------------------------
        // ADMINコード確認
        // ----------------------------------------

        const correctAdminCode =
            LUNAGS_ADMIN_CODE.value();

        if (adminCode !== correctAdminCode) {
            console.warn(
                `LUNAGS 管理者認証: ADMINコードNG(${targetEmail})`
            );

            return res.status(401).json({
                ok: false,
                error: "管理者認証に失敗しました"
            });
        }

        // ----------------------------------------
        // 一時管理者モード開始
        // ----------------------------------------

        console.log(
            `LUNAGS 一時管理者モード開始: ${authenticatedEmail} `
        );

        return res.json({
            ok: true,
            adminMode: true,
            message: "一時管理者モードが有効になりました",
            expiresAt:
                Date.now() + ADMIN_APPROVAL_EXPIRE_MS
        });

    } catch (err) {
        console.error(
            "Admin auth error:",
            err
        );

        return res.status(401).json({
            ok: false,
            error: "管理者認証に失敗しました"
        });
    }


});

// ========================================
// 管理者モード終了
// ========================================

app.post("/admin-logout", async (req, res) => {
    try {
        const decodedToken =
            await verifyFirebaseUser(req);


        console.log(
            `LUNAGS 管理者モード終了: ${decodedToken.email} `
        );

        return res.json({
            ok: true,
            adminMode: false,
            message: "管理者モードを終了しました"
        });

    } catch (err) {
        console.error(
            "Admin logout error:",
            err
        );

        return res.status(401).json({
            ok: false,
            error: "管理者モードの終了に失敗しました"
        });
    }


});

// ========================================
// Firebase Functions
// ========================================

export const send = onRequest({
    invoker: "public",


    secrets: [
        LUNAGS_ADMIN_CODE,
        LUNAGS_ADMIN_EMAILS
    ],

    cors: [
        "https://lunags-development.web.app",
        "https://lunags-production.web.app",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ]


}, app);
