import { onRequest } from "firebase-functions/v2/https";
import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Resend } from 'resend';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const __dirname = path.resolve();

// ⭐ここ重要（2段上）
app.use(express.static("D:/Programming/frontend"));

app.get("/", (req, res) => {
    res.sendFile("D:/Programming/frontend/public/Login_page/login.html");
});

const resend = new Resend(process.env.RESEND_KEY);

app.post("/send", async (req, res) => {
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

export const send = onRequest(app);