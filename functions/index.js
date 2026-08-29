import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import express from "express";
import cors from "cors";
import { Resend } from "resend";
import admin from "firebase-admin";

admin.initializeApp();
const app = express();
app.use(express.json());
app.use(cors());

const resend = new Resend(process.env.RESEND_KEY);

// ========================================
// 設定
// ========================================

const VERIFICATION_COLLECTION = "emailVerifications";
const LUNAGS_ADMIN_CODE = defineSecret("LUNAGS_ADMIN_CODE");

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
                <div>
                    <h2>${name || "ユーザー"}さん</h2>
                    <p>認証コード:</p>
                    <h1>${code}</h1>
                </div>
            `
        });
        console.log("Resend result:", result);
        if (result.error) {
            console.error(result.error);
            return res.status(500).json(result);
        }
        res.json(result);
    } catch (err) {
        console.error("Resend error:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ========================================
// 管理者認証
// ========================================

app.post("/admin-auth", async (req, res) => {
    const { adminCode, email } = req.body;
    try {
        if (!adminCode) return res.status(401).json({ ok: false });
        if (!email) {
            return res.status(400).json({
                ok: false,
                error: "メールアドレスが指定されていません"
            });
        }

        const correctAdminCode = LUNAGS_ADMIN_CODE.value();

        if (adminCode !== correctAdminCode) {
            console.warn("LUNAGS 管理者認証: NG");
            return res.status(401).json({ ok: false });
        }

        console.log(`LUNAGS 管理者認証: OK (${email})`);
        return res.json({
            ok: true,
            message: "管理者認証が完了しました"
        });
    } catch (err) {
        console.error("Admin auth error:", err);
        return res.status(500).json({
            ok: false,
            error: "管理者認証に失敗しました"
        });
    }
});

// ========================================
// Firebase Functions
// ========================================

export const send = onRequest({
    invoker: "public",
    secrets: [LUNAGS_ADMIN_CODE],
    cors: [
        "https://lunags-development.web.app",
        "https://lunags-production.web.app",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ]
}, app);