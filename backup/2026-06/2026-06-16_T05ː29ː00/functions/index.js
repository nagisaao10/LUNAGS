import { onRequest } from "firebase-functions/v2/https";
import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Resend } from "resend";

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
        await resend.emails.send({
            from: "onboarding@resend.dev",
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

        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

export const send = onRequest(app);