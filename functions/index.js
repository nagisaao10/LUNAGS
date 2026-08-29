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

// 管理者コードはFirebase Secret Managerで管理
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

        res.status(500).json({
            ok: false,
            error: err.message
        });
    }
});

// ========================================
// 管理者認証
// ========================================

app.post("/admin-auth", async (req, res) => {
    const { adminCode, email } = req.body;

    try {
        // 管理者コードが入力されていない場合
        if (!adminCode) {
            return res.status(401).json({
                ok: false
            });
        }

        // メールアドレスがない場合
        if (!email) {
            return res.status(400).json({
                ok: false,
                error: "メールアドレスが指定されていません"
            });
        }

        // ========================================
        // 管理者コード確認
        // ========================================

        const correctAdminCode = LUNAGS_ADMIN_CODE.value();

        if (adminCode !== correctAdminCode) {
            // 間違った場合は管理者モードの存在を知らせない
            return res.status(401).json({
                ok: false
            });
        }

        // ========================================
        // 管理者認証成功
        // ========================================

        const db = admin.firestore();

        const verificationRef = db
            .collection(VERIFICATION_COLLECTION)
            .doc(email);

        const now = Date.now();

        await db.runTransaction(async (transaction) => {
            const snap = await transaction.get(verificationRef);

            // 確認コード情報が存在する場合
            if (snap.exists) {
                const data = snap.data() || {};

                transaction.set(
                    verificationRef,
                    {
                        ...data,
                        verified: true,
                        verifiedAt: now,
                        updatedAt: now,

                        // 管理者認証では期限切れを回避
                        expiresAt: now + (5 * 60 * 1000)
                    }
                );
            }

            // 確認コード情報が存在しない場合
            else {
                transaction.set(
                    verificationRef,
                    {
                        email: email,
                        codeHash: "",
                        attemptCount: 0,
                        maxAttempts: 5,
                        verified: true,
                        verifiedAt: now,
                        createdAt: now,
                        updatedAt: now,
                        expiresAt: now + (5 * 60 * 1000)
                    }
                );
            }
        });

        console.log("LUNAGS 管理者認証: OK");

        res.json({
            ok: true,
            message: "管理者認証が完了しました"
        });

    } catch (err) {
        console.error("Admin auth error:", err);

        res.status(500).json({
            ok: false,
            error: "管理者認証に失敗しました"
        });
    }
});


// ========================================
// Firebase Functions
// ========================================

export const send = onRequest(
    {
        invoker: "public",

        secrets: [
            LUNAGS_ADMIN_CODE
        ],

        cors: [
            "https://lunags-development.web.app",
            "https://lunags-production.web.app",
            "http://localhost:8000",
            "http://127.0.0.1:8000"
        ]
    },
    app
);