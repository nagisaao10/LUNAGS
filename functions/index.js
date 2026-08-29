import { onRequest } from "firebase-functions/v2/https";
import express from "express";
import cors from "cors";
import { Resend } from "resend";

const app = express();

app.use(express.json());

const resend = new Resend(process.env.RESEND_KEY);

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

export const send = onRequest(
    {
        invoker: "public",
        cors: [
            "https://lunags-development.web.app",
            "http://localhost:8000",
            "http://127.0.0.1:8000"
        ]
    },
    app
);