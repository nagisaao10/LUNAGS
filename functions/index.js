import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import express from "express";
import { Resend } from "resend";
import admin from "firebase-admin";
import crypto from "crypto";
import { defineSecret } from "firebase-functions/params";
import cors from "cors";

const SIGNUP_SKIP_PASSWORD = defineSecret("SIGNUP_SKIP_PASSWORD");

const SIGNUP_SKIP_TOKEN_TTL_MS = 10 * 60 * 1000;

const FUNCTIONS_ENDPOINT = "https://us-central1-lunags.cloudfunctions.net/api";

admin.initializeApp();

const app = express();
const signupSkipApp = express();

const db = admin.firestore();

const allowedOrigins = [
    "https://lunags-development.web.app",
    "https://lunags-development.firebaseapp.com",
    "https://lunags.jp",
    "https://dev.lunags.jp"
];

const corsOptions = {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
app.use(express.json());

signupSkipApp.use(cors(corsOptions));
signupSkipApp.use(express.json());

const DEFAULT_ADMIN_MODE_MINUTES = 30;
const MIN_ADMIN_MODE_MINUTES = 1;
const MAX_ADMIN_MODE_MINUTES = 2880;
const HISTORY_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

const SIGNUP_CODE_TTL_MS = 10 * 60 * 1000;
const SIGNUP_MAX_ATTEMPTS = 5;

const SIGNUP_ID_LETTERS =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const SIGNUP_ID_DIGITS =
    "0123456789";

const SIGNUP_ID_CHARS =
    SIGNUP_ID_LETTERS + SIGNUP_ID_DIGITS;


function generateSignupUserId() {

    while (true) {

        let userId = "U";

        const bytes =
            crypto.getRandomValues(
                new Uint8Array(7)
            );

        for (let i = 0; i < 7; i++) {

            userId +=
                SIGNUP_ID_CHARS[
                bytes[i] % SIGNUP_ID_CHARS.length
                ];
        }

        const body = userId.slice(1);

        const digitCount =
            [...body].filter((char) =>
                SIGNUP_ID_DIGITS.includes(char)
            ).length;

        const letterCount =
            [...body].filter((char) =>
                SIGNUP_ID_LETTERS.includes(char)
            ).length;

        let hasTriple = false;

        for (let i = 2; i < userId.length; i++) {

            if (
                userId[i] === userId[i - 1] &&
                userId[i] === userId[i - 2]
            ) {
                hasTriple = true;
                break;
            }
        }

        if (
            digitCount >= 2 &&
            digitCount <= 4 &&
            letterCount >= 3 &&
            !hasTriple
        ) {
            return userId;
        }
    }
}


async function generateUniqueSignupUserId() {

    for (let attempt = 0; attempt < 100; attempt++) {

        const userId =
            generateSignupUserId();

        const snap =
            await db
                .collection("users")
                .doc(userId)
                .get();

        if (!snap.exists) {
            return userId;
        }
    }

    const error = new Error(
        "ユーザーIDの生成に失敗しました"
    );

    error.status = 500;

    throw error;
}


function generateVerificationCode() {

    return crypto
        .randomInt(100000, 1000000)
        .toString();
}


function hashVerificationCode(code) {

    return crypto
        .createHash("sha256")
        .update(String(code))
        .digest("hex");
}


function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function timestampMillis(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value.toMillis === "function") {
        try {
            return value.toMillis();
        } catch {
            return null;
        }
    }
    if (typeof value.toDate === "function") {
        try {
            return value.toDate().getTime();
        } catch {
            return null;
        }
    }
    if (typeof value === "object" && value._seconds !== undefined) {
        return (
            value._seconds * 1000 +
            Math.floor((value._nanoseconds || 0) / 1e6)
        );
    }
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const num = Number(trimmed);
        if (Number.isFinite(num) && /^\d+$/.test(trimmed)) {
            return num;
        }
        const parsed = Date.parse(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function validateAdminModeDuration(value) {
    const duration = Number(value);

    if (
        !Number.isInteger(duration) ||
        duration < MIN_ADMIN_MODE_MINUTES ||
        duration > MAX_ADMIN_MODE_MINUTES
    ) {
        const error = new Error(
            "管理者モード時間は1〜2880分の整数で指定してください"
        );
        error.status = 400;
        throw error;
    }

    return duration;
}

function publicAccount(account) {
    return {
        email: account.email || "",
        uid: account.uid || "",
        name: account.name || account.userName || "",
        active: account.active === true,
        createdBy: account.createdBy || "",
        createdByEmail: account.createdByEmail || "",
        createdByName: account.createdByName || "",
        createdAt:
            timestampMillis(account.createdAt) ||
            account.createdAt ||
            null,
        updatedAt:
            timestampMillis(account.updatedAt) ||
            account.updatedAt ||
            null,
        adminModeDurationMinutes:
            account.adminModeDurationMinutes ||
            DEFAULT_ADMIN_MODE_MINUTES
    };
}

function publicSession(session) {
    if (!session) return null;

    return {
        uid: session.uid || session.userUid || "",
        email: session.email || "",
        userName: session.userName || "",
        active: session.active === true,
        createdAt:
            timestampMillis(session.createdAt) ||
            session.createdAt ||
            null,
        expiresAt:
            timestampMillis(session.expiresAt) ||
            session.expiresAt ||
            null,
        approvedByUid: session.approvedByUid || "",
        approvedByEmail: session.approvedByEmail || "",
        approvedByName: session.approvedByName || ""
    };
}

function publicHistory(doc) {
    const data = doc.data();

    return {
        id: doc.id,
        ...data,
        createdAt:
            timestampMillis(data.createdAt) ||
            data.createdAt ||
            null
    };
}

function getErrorStatus(error) {
    if (Number.isInteger(error?.status)) {
        return error.status;
    }

    switch (error?.code) {
        case "auth/id-token-expired":
        case "auth/id-token-revoked":
        case "auth/invalid-id-token":
        case "auth/missing-token":
        case "auth/empty-token":
        case "auth/invalid-token":
        case "auth/argument-error":
        case "auth/email-missing":
            return 401;

        case "auth/user-disabled":
        case "FORBIDDEN_NOT_ADMIN":
        case "FORBIDDEN_NOT_ADMIN_ACCOUNT":
            return 403;

        case "auth/user-not-found":
        case "not-found":
            return 404;

        case "auth/email-already-exists":
        case "already-exists":
            return 409;

        default:
            return 500;
    }
}

function getErrorCode(status) {
    switch (status) {
        case 400:
            return "BAD_REQUEST";

        case 401:
            return "UNAUTHORIZED";

        case 403:
            return "FORBIDDEN";

        case 404:
            return "NOT_FOUND";

        case 409:
            return "CONFLICT";

        case 500:
        default:
            return "INTERNAL_SERVER_ERROR";
    }
}

function sendError(
    res,
    error,
    fallback = "処理に失敗しました"
) {
    console.error(error);

    const status = getErrorStatus(error);
    const errorCode = getErrorCode(status);

    const isKnownError =
        Number.isInteger(error?.status) ||
        status !== 500;

    return res.status(status).json({
        ok: false,
        error: isKnownError
            ? error?.message || fallback
            : fallback,
        errorCode,
        status
    });
}

/* ============================
   新規登録スキップモード
   ============================ */

function getSignupSkipPassword() {
    return String(SIGNUP_SKIP_PASSWORD.value() || "").trim();
}

function createSignupSkipToken() {
    const payload = {
        type: "signupSkip",
        createdAt: Date.now(),
        expiresAt: Date.now() + SIGNUP_SKIP_TOKEN_TTL_MS,
        nonce: crypto.randomBytes(32).toString("hex")
    };

    const payloadText = JSON.stringify(payload);
    const encodedPayload = Buffer.from(payloadText).toString("base64url");

    const signature = crypto
        .createHmac("sha256", getSignupSkipPassword())
        .update(encodedPayload)
        .digest("base64url");

    return `${encodedPayload}.${signature}`;
}

function verifySignupSkipToken(token) {
    if (!token || typeof token !== "string") {
        return false;
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
        return false;
    }

    const [encodedPayload, signature] = parts;

    try {
        const expectedSignature = crypto
            .createHmac("sha256", getSignupSkipPassword())
            .update(encodedPayload)
            .digest("base64url");

        const signatureBuffer = Buffer.from(signature, "utf8");
        const expectedBuffer = Buffer.from(expectedSignature, "utf8");

        if (
            signatureBuffer.length !== expectedBuffer.length ||
            !crypto.timingSafeEqual(
                signatureBuffer,
                expectedBuffer
            )
        ) {
            return false;
        }

        const payload = JSON.parse(
            Buffer.from(encodedPayload, "base64url").toString("utf8")
        );

        if (payload.type !== "signupSkip") {
            return false;
        }

        if (
            !payload.expiresAt ||
            Number(payload.expiresAt) <= Date.now()
        ) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

signupSkipApp.post("/", async (req, res) => {
    try {
        const { action } = req.body || {};

        if (action === "enable") {
            const password = String(req.body.password || "").trim();
            const expectedPassword = getSignupSkipPassword();

            if (!password) {
                const error = new Error(
                    "スキップモード認証情報が入力されていません"
                );
                error.status = 400;
                throw error;
            }

            const passwordBuffer = Buffer.from(
                password,
                "utf8"
            );

            const expectedBuffer = Buffer.from(
                expectedPassword,
                "utf8"
            );

            if (
                passwordBuffer.length !== expectedBuffer.length ||
                !crypto.timingSafeEqual(
                    passwordBuffer,
                    expectedBuffer
                )
            ) {
                const error = new Error(
                    "スキップモード認証に失敗しました"
                );
                error.status = 403;
                throw error;
            }

            const token = createSignupSkipToken();

            return res.json({
                ok: true,
                token,
                expiresIn: SIGNUP_SKIP_TOKEN_TTL_MS
            });
        }

        if (action === "prepare") {
            const token = req.body.token;

            if (!verifySignupSkipToken(token)) {
                const error = new Error(
                    "新規登録スキップモードの認証が無効です"
                );
                error.status = 403;
                throw error;
            }

            const name = String(req.body.name || "").trim();
            const email = normalizeEmail(req.body.email);

            if (!name) {
                const error = new Error(
                    "ユーザー名を入力してください"
                );
                error.status = 400;
                throw error;
            }

            if (!email) {
                const error = new Error(
                    "メールアドレスを入力してください"
                );
                error.status = 400;
                throw error;
            }

            try {
                await admin.auth().getUserByEmail(email);

                const error = new Error(
                    "このメールアドレスはすでに登録されています"
                );
                error.status = 409;
                throw error;
            } catch (error) {
                if (error.status) {
                    throw error;
                }
            }

            await db
                .collection("emailVerifications")
                .doc(email)
                .set({
                    name,
                    email,
                    codeHash: "",
                    verified: true,
                    skipMode: true,
                    attemptCount: 0,
                    maxAttempts: 0,
                    expiresAt:
                        Date.now() +
                        SIGNUP_SKIP_TOKEN_TTL_MS,
                    createdAt:
                        admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt:
                        admin.firestore.FieldValue.serverTimestamp()
                });

            return res.json({
                ok: true,
                verified: true,
                skipMode: true
            });
        }

        const error = new Error(
            "不正なスキップモード処理です"
        );
        error.status = 400;
        throw error;
    } catch (error) {
        return sendError(
            res,
            error,
            "新規登録スキップ処理に失敗しました"
        );
    }
});

/* ============================
   管理者認証
   ============================ */

async function verifyFirebaseUser(req) {
    const authHeader = req.headers?.authorization;

    if (
        !authHeader ||
        typeof authHeader !== "string" ||
        !authHeader.startsWith("Bearer ")
    ) {
        const error = new Error("認証トークンがありません");
        error.status = 401;
        error.code = "auth/missing-token";
        throw error;
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
        const error = new Error("認証トークンが空です");
        error.status = 401;
        error.code = "auth/empty-token";
        throw error;
    }

    try {
        return await admin.auth().verifyIdToken(token);
    } catch (authError) {
        console.warn("verifyIdToken failed:", authError?.code, authError?.message);
        const error = new Error("認証トークンが無効または期限切れです");
        error.status = 401;
        error.code = authError?.code || "auth/invalid-token";
        throw error;
    }
}

async function getUserProfileByUid(uid) {
    let authUser = null;
    let userDoc = null;
    let userId = "";

    try {
        authUser = await admin.auth().getUser(uid);
    } catch (err) {
        if (err?.code === "auth/user-not-found") {
            const error = new Error("対象の認証ユーザーが見つかりません");
            error.status = 404;
            error.code = "auth/user-not-found";
            throw error;
        }
        console.warn("admin.auth().getUser warning:", err?.message);
    }

    if (authUser && authUser.disabled === true) {
        const error = new Error("このユーザーアカウントは無効化されています");
        error.status = 403;
        error.code = "auth/user-disabled";
        throw error;
    }

    try {
        const uidMapSnap = await db
            .collection("uidMap")
            .doc(uid)
            .get();

        if (uidMapSnap.exists) {
            userId = uidMapSnap.data()?.userId || "";

            if (userId) {
                const userSnap = await db
                    .collection("users")
                    .doc(userId)
                    .get();

                if (userSnap.exists) {
                    userDoc = userSnap.data();
                }
            }
        }
    } catch (dbErr) {
        console.warn("getUserProfileByUid Firestore read warning:", dbErr?.message);
    }

    const email = normalizeEmail(
        userDoc?.email ||
        authUser?.email ||
        ""
    );

    return {
        uid,
        userId,
        email,
        name:
            userDoc?.displayName ||
            userDoc?.name ||
            authUser?.displayName ||
            authUser?.email ||
            email ||
            "",
        authUser,
        userDoc
    };
}

async function findUserByEmail(email) {
    const normalized = normalizeEmail(email);

    if (!normalized) {
        const error = new Error(
            "メールアドレスが指定されていません"
        );
        error.status = 400;
        throw error;
    }

    let authUser = null;

    try {
        authUser = await admin
            .auth()
            .getUserByEmail(normalized);
    } catch {
        authUser = null;
    }

    let userDoc = null;
    try {
        const usersSnap = await db
            .collection("users")
            .where("email", "==", normalized)
            .limit(1)
            .get();

        userDoc = usersSnap.empty
            ? null
            : usersSnap.docs[0].data();
    } catch (err) {
        console.warn("findUserByEmail Firestore read warning:", err?.message);
    }

    if (!authUser && !userDoc?.uid) {
        const error = new Error(
            "対象アカウントが見つかりません"
        );
        error.status = 404;
        throw error;
    }

    return {
        uid: authUser?.uid || userDoc.uid,
        email: normalized,
        name:
            userDoc?.displayName ||
            userDoc?.name ||
            authUser?.displayName ||
            normalized
    };
}

async function getadminAccountByEmail(email) {
    const normalized = normalizeEmail(email);

    if (!normalized) return null;

    try {
        const accountSnap = await db
            .collection("adminAccount")
            .doc(normalized)
            .get();

        if (
            accountSnap.exists &&
            accountSnap.data()?.active === true
        ) {
            return publicAccount(accountSnap.data());
        }
    } catch (err) {
        console.warn("getadminAccountByEmail warning:", err?.message);
    }

    return null;
}

async function finishAdminSession(
    uid,
    endReason,
    actor = {}
) {
    try {
        const sessionRef = db
            .collection("adminSessions")
            .doc(uid);

        const sessionSnap = await sessionRef.get();

        if (
            !sessionSnap.exists ||
            sessionSnap.data()?.active !== true
        ) {
            return false;
        }

        const session = {
            uid,
            ...sessionSnap.data()
        };

        const endedAt = Date.now();

        await db.collection("adminModeHistory").add({
            userUid: uid,
            userEmail: session.email || "",
            userName: session.userName || "",
            approvedByUid:
                session.approvedByUid || "",
            approvedByEmail:
                session.approvedByEmail || "",
            approvedByName:
                session.approvedByName || "",
            startedAt: session.createdAt || null,
            expiresAt: session.expiresAt || null,
            endedAt,
            endReason,
            endedByUid: actor.uid || "",
            endedByEmail: actor.email || "",
            endedByName: actor.name || "",
            createdAt:
                admin.firestore.FieldValue.serverTimestamp()
        });

        await sessionRef.set(
            {
                active: false,
                endedAt,
                endReason,
                endedByUid: actor.uid || "",
                endedByEmail: actor.email || "",
                endedByName: actor.name || "",
                updatedAt:
                    admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
        );

        return true;
    } catch (err) {
        console.warn("finishAdminSession warning:", err?.message);
        return false;
    }
}

async function getActiveSession(uid) {
    if (!uid) return null;

    try {
        const sessionSnap = await db
            .collection("adminSessions")
            .doc(uid)
            .get();

        if (
            !sessionSnap.exists ||
            sessionSnap.data()?.active !== true
        ) {
            return null;
        }

        const session = {
            uid,
            ...sessionSnap.data()
        };

        const expiresAt =
            timestampMillis(session.expiresAt) ||
            Number(session.expiresAt);

        if (
            !expiresAt ||
            expiresAt <= Date.now()
        ) {
            await finishAdminSession(
                uid,
                "期限切れ"
            );
            return null;
        }

        return session;
    } catch (err) {
        console.warn("getActiveSession warning:", err?.message);
        return null;
    }
}

async function getCurrentContext(req) {
    // 1. Firebase ID Token の検証 (欠損/無効/期限切れ時は 401)
    const decoded = await verifyFirebaseUser(req);

    // 2. Firebase Auth ユーザーおよびプロファイルの取得 (未存在時は 404, 無効時は 403)
    const profile = await getUserProfileByUid(decoded.uid);

    const email = normalizeEmail(
        decoded.email || profile.email
    );

    // メールアドレスが取得できない場合は認証コンテキストを確立できない (401)
    if (!email) {
        const error = new Error("アカウントのメールアドレスが確認できません");
        error.status = 401;
        error.code = "auth/email-missing";
        throw error;
    }

    // 3. adminAccount の確認 (未登録または active!=true の場合は null)
    const adminAccount = await getadminAccountByEmail(email);

    // 4. adminSessions の確認 (未存在または期限切れの場合は null)
    const session = await getActiveSession(decoded.uid);

    return {
        decoded,
        uid: decoded.uid,
        userId: profile.userId || "",
        email,
        name:
            profile.name ||
            decoded.name ||
            email,
        adminAccount: !!adminAccount,
        adminAccountDetail: adminAccount,
        adminMode: !!session,
        session,
        // データチェーン診断情報 (Step 4 で活用)
        diagnostics: {
            hasAuthUser: !!profile.authUser,
            hasUidMap: !!profile.userId,
            hasUserDoc: !!profile.userDoc,
            hasAdminAccountDoc: !!adminAccount,
            isAdminAccountActive: adminAccount?.active === true,
            chainComplete: !!(profile.authUser && profile.userId && profile.userDoc && adminAccount?.active === true)
        }
    };
}

async function requireadminAccount(req) {
    const context = await getCurrentContext(req);

    if (!context.adminAccount) {
        const error = new Error(
            "管理者アカウント権限がありません"
        );
        error.status = 403;
        error.code = "FORBIDDEN_NOT_ADMIN_ACCOUNT";
        throw error;
    }

    return context;
}

async function requireadminAccountOrMode(req) {
    const context = await getCurrentContext(req);

    if (
        !context.adminAccount &&
        !context.adminMode
    ) {
        const error = new Error(
            "管理者権限がありません"
        );
        error.status = 403;
        error.code = "FORBIDDEN_NOT_ADMIN";
        throw error;
    }

    return context;
}

async function getActiveadminAccount() {
    try {
        const snap = await db
            .collection("adminAccount")
            .where("active", "==", true)
            .get();

        return snap.docs.map((doc) =>
            publicAccount(doc.data())
        );
    } catch (err) {
        console.warn("getActiveadminAccount warning:", err?.message);
        return [];
    }
}

async function getAdminAccountsMaps() {
    const byUid = new Map();
    const byEmail = new Map();

    try {
        const snap = await db
            .collection("adminAccount")
            .where("active", "==", true)
            .get();

        snap.docs.forEach((doc) => {
            try {
                const data = doc.data() || {};
                const account = publicAccount(data);
                const email = normalizeEmail(doc.id || data.email || "");

                if (email) {
                    byEmail.set(email, account);
                }
                if (account.uid) {
                    byUid.set(account.uid, account);
                }
            } catch (docErr) {
                console.warn("adminAccount doc parse warning:", docErr?.message);
            }
        });
    } catch (err) {
        console.warn("getAdminAccountsMaps query warning:", err?.message);
    }

    return { byUid, byEmail };
}

async function assertMinimumAdminCountAfterOneRemoval() {
    const accounts =
        await getActiveadminAccount();

    if (accounts.length - 1 < 2) {
        const error = new Error(
            "有効な管理者アカウントは2人以上必要です"
        );
        error.status = 409;
        throw error;
    }
}

function publicUserRecord(user, profile = {}, adminAccount = null) {
    const providerIds = (user?.providerData || [])
        .map((provider) => provider?.providerId)
        .filter(Boolean);

    const email = normalizeEmail(
        user?.email ||
        profile?.email ||
        ""
    );

    const name =
        profile?.displayName ||
        profile?.name ||
        user?.displayName ||
        email ||
        "";

    const createdAt =
        timestampMillis(profile?.createdAt) ||
        timestampMillis(user?.metadata?.creationTime) ||
        null;

    const lastLoginAt =
        timestampMillis(profile?.lastLoginAt) ||
        timestampMillis(user?.metadata?.lastSignInTime) ||
        null;

    return {
        uid: user?.uid || "",
        userId: profile?.userId || "",
        email,
        name,
        disabled: user?.disabled === true,
        emailVerified: user?.emailVerified === true,
        createdAt,
        lastLoginAt,
        role: profile?.role || "-",
        adminAccount: !!adminAccount,
        adminAccountDetail: adminAccount,
        providers: providerIds,
        phoneNumber: user?.phoneNumber || profile?.phoneNumber || "",
        photoURL: user?.photoURL || profile?.photoURL || ""
    };
}

async function getUserProfilesByUid() {
    let usersDocs = [];
    let uidMapDocs = [];

    try {
        const [usersSnap, uidMapSnap] = await Promise.all([
            db.collection("users").get().catch(() => ({ docs: [] })),
            db.collection("uidMap").get().catch(() => ({ docs: [] }))
        ]);
        usersDocs = usersSnap.docs || [];
        uidMapDocs = uidMapSnap.docs || [];
    } catch (dbErr) {
        console.warn("getUserProfilesByUid collections read warning:", dbErr?.message);
    }

    const userIdsByUid = new Map();
    uidMapDocs.forEach((doc) => {
        try {
            const data = doc.data() || {};
            if (data.userId) {
                userIdsByUid.set(doc.id, data.userId);
            }
        } catch {}
    });

    const profiles = new Map();

    usersDocs.forEach((doc) => {
        try {
            const data = doc.data() || {};
            const uid = data.uid || data.authUid || "";
            const uidFromMap = [...userIdsByUid.entries()]
                .find(([, userId]) => userId === doc.id)?.[0] || "";
            const resolvedUid = uid || uidFromMap;

            if (!resolvedUid) return;

            profiles.set(resolvedUid, {
                ...data,
                userId: doc.id
            });
        } catch {}
    });

    return profiles;
}

async function listAllAuthUsers() {
    const users = [];
    let pageToken = undefined;

    try {
        do {
            const result = await admin.auth().listUsers(1000, pageToken);
            users.push(...result.users);
            pageToken = result.pageToken;
        } while (pageToken);
    } catch (err) {
        console.error("listAllAuthUsers error:", err?.message);
        throw err;
    }

    return users;
}

async function getadminAccountByUid() {
    const maps = await getAdminAccountsMaps();
    return maps.byUid;
}

function eventTime(data) {
    if (!data) return null;
    return (
        timestampMillis(data.createdAt) ||
        timestampMillis(data.endedAt) ||
        timestampMillis(data.updatedAt) ||
        timestampMillis(data.adminStartedAt) ||
        timestampMillis(data.adminEndedAt) ||
        timestampMillis(data.timestamp) ||
        null
    );
}

function publicLogEvent(doc, source, type, actorFields = {}) {
    const data = doc?.data() || {};

    return {
        id: doc.id,
        source,
        type,
        actorUid: data[actorFields.uid] || data.userUid || "",
        actorEmail: data[actorFields.email] || data.userEmail || "",
        actorName: data[actorFields.name] || data.userName || "",
        target:
            data.targetEmail ||
            data.userEmail ||
            data.email ||
            data.targetUid ||
            "",
        result: data.status || data.endReason || "記録",
        occurredAt: eventTime(data),
        details: data
    };
}

function sortByOccurredAtDesc(a, b) {
    return Number(b.occurredAt || 0) - Number(a.occurredAt || 0);
}

async function safeCountCollection(collectionName) {
    try {
        const snap = await db.collection(collectionName).count().get();
        return snap.data().count || 0;
    } catch (err) {
        console.warn(`safeCountCollection failed for ${collectionName}:`, err?.message);
        return 0;
    }
}

async function countCollection(collectionName) {
    return await safeCountCollection(collectionName);
}

/**
 * Analytics集計処理（独立）
 * 各種Firestoreクエリの失敗や欠損フィールド、データ型混在に対しても
 * API全体を500にせず安全に0やデフォルト値を返す
 */
async function aggregateAdminAnalytics(requestedDays = 30) {
    const days = Math.max(1, parseInt(requestedDays || "30", 10) || 30);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // 1. 各集計データを安全に取得（個別エラーでも全体を落とさない）
    const [
        authUsers,
        activeAdmins,
        activeSessionsDocs,
        modeHistoryCount,
        accountHistoryCount,
        demotionRequestCount
    ] = await Promise.all([
        listAllAuthUsers().catch((err) => {
            console.warn("Analytics listAllAuthUsers warning:", err?.message);
            return [];
        }),
        getActiveadminAccount().catch((err) => {
            console.warn("Analytics getActiveadminAccount warning:", err?.message);
            return [];
        }),
        db
            .collection("adminSessions")
            .where("active", "==", true)
            .get()
            .then((s) => s.docs)
            .catch((err) => {
                console.warn("Analytics adminSessions query warning:", err?.message);
                return [];
            }),
        safeCountCollection("adminModeHistory"),
        safeCountCollection("adminAccountHistory"),
        safeCountCollection("adminDemotionRequests")
    ]);

    // 2. 日別新規登録バケットの初期化
    const createdBuckets = Array.from(
        { length: days },
        (_, index) => {
            const date = new Date(
                now - (days - 1 - index) * dayMs
            );
            return {
                key: date.toISOString().slice(0, 10),
                count: 0
            };
        }
    );
    const bucketByKey = new Map(
        createdBuckets.map((bucket) => [
            bucket.key,
            bucket
        ])
    );

    let disabledUsers = 0;
    let verifiedUsers = 0;
    let activeLast30Days = 0;

    // 3. ユーザー情報の安全な走査（データ型の混在に対応）
    for (const user of authUsers) {
        if (!user) continue;

        if (user.disabled === true) disabledUsers += 1;
        if (user.emailVerified === true) verifiedUsers += 1;

        const createdAt = timestampMillis(user.metadata?.creationTime);
        const lastLoginAt = timestampMillis(user.metadata?.lastSignInTime);

        if (
            lastLoginAt &&
            now - lastLoginAt <= 30 * dayMs
        ) {
            activeLast30Days += 1;
        }

        if (
            createdAt &&
            now - createdAt <= days * dayMs
        ) {
            try {
                const key = new Date(createdAt)
                    .toISOString()
                    .slice(0, 10);
                const bucket = bucketByKey.get(key);
                if (bucket) bucket.count += 1;
            } catch {}
        }
    }

    // 4. 有効セッションの確認・期限切れの整理
    const activeSessions = [];
    for (const doc of activeSessionsDocs) {
        try {
            const data = doc.data() || {};
            const session = {
                uid: doc.id,
                ...data
            };
            const expiresAt = timestampMillis(session.expiresAt);

            if (expiresAt && expiresAt <= now) {
                finishAdminSession(
                    doc.id,
                    "期限切れ"
                ).catch(() => {});
            } else {
                activeSessions.push(session);
            }
        } catch {}
    }

    return {
        summary: {
            totalUsers: authUsers.length,
            disabledUsers,
            enabledUsers: Math.max(0, authUsers.length - disabledUsers),
            verifiedUsers,
            activeLast30Days,
            activeadminAccount: activeAdmins.length,
            activeAdminSessions: activeSessions.length,
            adminModeHistory: modeHistoryCount,
            adminAccountHistory: accountHistoryCount,
            demotionRequests: demotionRequestCount,
            totalUsersCumulative: authUsers.length
        },
        userGrowth: createdBuckets,
        generatedAt: now
    };
}

/* ============================
   管理者API
   ============================ */

app.get("/admin-status", async (req, res) => {
    try {
        const context =
            await getCurrentContext(req);

        return res.json({
            ok: true,
            user: {
                uid: context.uid,
                userId: context.userId || "",
                email: context.email,
                name: context.name
            },
            adminAccount:
                context.adminAccount,
            adminAccountDetail:
                context.adminAccountDetail,
            adminMode:
                context.adminMode,
            session:
                publicSession(context.session),
            diagnostics:
                context.diagnostics
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "管理者状態の取得に失敗しました"
        );
    }
});

app.post("/admin-auth", async (req, res) => {
    try {
        const context =
            await requireadminAccount(req);

        const targetUser =
            await findUserByEmail(
                req.body.email
            );

        const targetadminAccount =
            await getadminAccountByEmail(
                targetUser.email
            );

        if (targetadminAccount) {
            const error = new Error(
                "管理者モードは普通アカウントにのみ付与できます"
            );
            error.status = 400;
            throw error;
        }

        const duration =
            validateAdminModeDuration(
                context.adminAccount
                    .adminModeDurationMinutes ||
                DEFAULT_ADMIN_MODE_MINUTES
            );

        const now = Date.now();
        const expiresAt =
            now + duration * 60 * 1000;

        await db
            .collection("adminSessions")
            .doc(targetUser.uid)
            .set(
                {
                    uid: targetUser.uid,
                    email: targetUser.email,
                    userName: targetUser.name,
                    active: true,
                    createdAt: now,
                    expiresAt,
                    approvedByUid:
                        context.uid,
                    approvedByEmail:
                        context.email,
                    approvedByName:
                        context.name,
                    updatedAt:
                        admin.firestore.FieldValue.serverTimestamp()
                },
                { merge: true }
            );

        return res.json({
            ok: true,
            adminMode: true,
            session: {
                uid: targetUser.uid,
                email: targetUser.email,
                userName: targetUser.name,
                createdAt: now,
                expiresAt,
                approvedByUid:
                    context.uid,
                approvedByEmail:
                    context.email,
                approvedByName:
                    context.name
            }
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "管理者モードの承認に失敗しました"
        );
    }
});

app.post("/admin-logout", async (req, res) => {
    try {
        const context =
            await getCurrentContext(req);

        await finishAdminSession(
            context.uid,
            "本人による終了",
            context
        );

        return res.json({
            ok: true,
            adminMode: false,
            message:
                "管理者モードを終了しました"
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "管理者モードの終了に失敗しました"
        );
    }
});

app.get("/admin-accounts", async (req, res) => {
    try {
        await requireadminAccount(req);

        const accounts =
            await getActiveadminAccount();

        return res.json({
            ok: true,
            accounts: accounts.sort(
                (a, b) =>
                    a.email.localeCompare(b.email)
            )
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "管理者アカウント一覧の取得に失敗しました"
        );
    }
});

app.post("/admin-accounts", async (req, res) => {
    try {
        const context =
            await requireadminAccount(req);

        const targetUser =
            await findUserByEmail(
                req.body.email
            );

        const duration =
            req.body.adminModeDurationMinutes ===
                undefined
                ? DEFAULT_ADMIN_MODE_MINUTES
                : validateAdminModeDuration(
                    req.body.adminModeDurationMinutes
                );

        const accountRef = db
            .collection("adminAccount")
            .doc(targetUser.email);

        const existingSnap =
            await accountRef.get();

        const isExistingActive =
            existingSnap.exists &&
            existingSnap.data().active === true;

        let historyId =
            existingSnap.exists
                ? existingSnap.data().historyId || ""
                : "";

        if (!isExistingActive) {
            const historyRef =
                await db
                    .collection("adminAccountHistory")
                    .add({
                        userUid:
                            targetUser.uid,
                        userEmail:
                            targetUser.email,
                        userName:
                            targetUser.name,
                        approvedByUid:
                            context.uid,
                        approvedByEmail:
                            context.email,
                        approvedByName:
                            context.name,
                        adminStartedAt:
                            Date.now(),
                        adminEndedAt: null,
                        endedApprovedByUid:
                            "",
                        endedApprovedByEmail:
                            "",
                        endedApprovedByName:
                            "",
                        createdAt:
                            admin.firestore.FieldValue.serverTimestamp()
                    });

            historyId = historyRef.id;
        }

        await accountRef.set(
            {
                email:
                    targetUser.email,
                uid:
                    targetUser.uid,
                name:
                    targetUser.name,
                active: true,
                createdBy:
                    context.uid,
                createdByEmail:
                    context.email,
                createdByName:
                    context.name,
                createdAt:
                    isExistingActive
                        ? existingSnap.data()
                            .createdAt ||
                        admin.firestore.FieldValue.serverTimestamp()
                        : admin.firestore.FieldValue.serverTimestamp(),
                updatedAt:
                    admin.firestore.FieldValue.serverTimestamp(),
                adminModeDurationMinutes:
                    duration,
                historyId
            },
            { merge: true }
        );

        return res.json({
            ok: true,
            account: publicAccount(
                (await accountRef.get()).data()
            )
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "管理者アカウント追加に失敗しました"
        );
    }
});

app.patch(
    "/admin-accounts/me/duration",
    async (req, res) => {
        try {
            const context =
                await requireadminAccount(req);

            const duration =
                validateAdminModeDuration(
                    req.body
                        .adminModeDurationMinutes
                );

            const ref = db
                .collection("adminAccount")
                .doc(context.email);

            const snap =
                await ref.get();

            if (!snap.exists) {
                const error = new Error(
                    "Firestoreの管理者アカウントが見つかりません"
                );
                error.status = 404;
                throw error;
            }

            await ref.set(
                {
                    adminModeDurationMinutes:
                        duration,
                    updatedAt:
                        admin.firestore.FieldValue.serverTimestamp()
                },
                { merge: true }
            );

            return res.json({
                ok: true,
                adminModeDurationMinutes:
                    duration
            });
        } catch (err) {
            return sendError(
                res,
                err,
                "管理者モード時間の更新に失敗しました"
            );
        }
    }
);

app.get("/admin-sessions", async (req, res) => {
    try {
        await requireadminAccount(req);

        const snap = await db
            .collection("adminSessions")
            .where("active", "==", true)
            .get();

        const sessions = [];

        for (const doc of snap.docs) {
            const session = {
                uid: doc.id,
                ...doc.data()
            };

            const expiresAt =
                timestampMillis(
                    session.expiresAt
                ) ||
                Number(session.expiresAt);

            if (
                expiresAt &&
                expiresAt <= Date.now()
            ) {
                await finishAdminSession(
                    doc.id,
                    "期限切れ"
                );
            } else {
                sessions.push(
                    publicSession(session)
                );
            }
        }

        return res.json({
            ok: true,
            sessions
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "管理者モード一覧の取得に失敗しました"
        );
    }
});

app.post(
    "/admin-sessions/:uid/terminate",
    async (req, res) => {
        try {
            const context =
                await requireadminAccount(req);

            await finishAdminSession(
                req.params.uid,
                "管理者による削除",
                context
            );

            return res.json({
                ok: true
            });
        } catch (err) {
            return sendError(
                res,
                err,
                "管理者モード終了に失敗しました"
            );
        }
    }
);

app.post(
    "/admin-sessions/terminate-all",
    async (req, res) => {
        try {
            const context =
                await requireadminAccount(req);

            const snap = await db
                .collection("adminSessions")
                .where("active", "==", true)
                .get();

            let terminated = 0;

            for (const doc of snap.docs) {
                const didTerminate =
                    await finishAdminSession(
                        doc.id,
                        "一斉終了",
                        context
                    );

                if (didTerminate) {
                    terminated += 1;
                }
            }

            return res.json({
                ok: true,
                terminated
            });
        } catch (err) {
            return sendError(
                res,
                err,
                "管理者モード一斉終了に失敗しました"
            );
        }
    }
);

app.get(
    "/admin-mode-history",
    async (req, res) => {
        try {
            await requireadminAccount(req);

            const snap = await db
                .collection("adminModeHistory")
                .orderBy("endedAt", "desc")
                .limit(100)
                .get();

            return res.json({
                ok: true,
                history:
                    snap.docs.map(publicHistory)
            });
        } catch (err) {
            return sendError(
                res,
                err,
                "管理者モード履歴の取得に失敗しました"
            );
        }
    }
);

app.get(
    "/admin-account-history",
    async (req, res) => {
        try {
            await requireadminAccount(req);

            const snap = await db
                .collection("adminAccountHistory")
                .orderBy("createdAt", "desc")
                .limit(100)
                .get();

            return res.json({
                ok: true,
                history:
                    snap.docs.map(publicHistory)
            });
        } catch (err) {
            return sendError(
                res,
                err,
                "管理者アカウント履歴の取得に失敗しました"
            );
        }
    }
);

app.get(
    "/admin-demotion-requests",
    async (req, res) => {
        try {
            await requireadminAccount(req);

            const snap = await db
                .collection("adminDemotionRequests")
                .where("status", "in", [
                    "waiting_target_approval",
                    "waiting_other_admin_approval",
                    "waiting_requester_confirm"
                ])
                .get();

            return res.json({
                ok: true,
                requests:
                    snap.docs.map(publicHistory)
            });
        } catch (err) {
            return sendError(
                res,
                err,
                "降格申請一覧の取得に失敗しました"
            );
        }
    }
);

app.post(
    "/admin-demotion-requests",
    async (req, res) => {
        try {
            const context =
                await requireadminAccount(req);

            const target =
                await findUserByEmail(
                    req.body.targetEmail ||
                    req.body.email
                );

            const targetAccount =
                await getadminAccountByEmail(
                    target.email
                );

            if (!targetAccount) {
                const error = new Error(
                    "対象は管理者アカウントではありません"
                );
                error.status = 400;
                throw error;
            }

            await assertMinimumAdminCountAfterOneRemoval();

            const isSelf =
                target.email === context.email;

            const requestRef =
                await db
                    .collection(
                        "adminDemotionRequests"
                    )
                    .add({
                        targetUid:
                            target.uid,
                        targetEmail:
                            target.email,
                        targetName:
                            target.name,
                        requestedBy:
                            context.uid,
                        requestedByEmail:
                            context.email,
                        requestedByName:
                            context.name,
                        targetApproved:
                            false,
                        requesterConfirmed:
                            false,
                        status: isSelf
                            ? "waiting_other_admin_approval"
                            : "waiting_target_approval",
                        createdAt:
                            admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt:
                            admin.firestore.FieldValue.serverTimestamp()
                    });

            return res.json({
                ok: true,
                requestId:
                    requestRef.id
            });
        } catch (err) {
            return sendError(
                res,
                err,
                "降格申請の作成に失敗しました"
            );
        }
    }
);

app.post(
    "/admin-demotion-requests/:id/approve",
    async (req, res) => {
        try {
            const context =
                await requireadminAccount(req);

            const ref = db
                .collection(
                    "adminDemotionRequests"
                )
                .doc(req.params.id);

            const snap =
                await ref.get();

            if (!snap.exists) {
                const error = new Error(
                    "降格申請が見つかりません"
                );
                error.status = 404;
                throw error;
            }

            const request = snap.data();

            const isSelfRequest =
                request.targetEmail ===
                request.requestedByEmail;

            const canApproveOtherRequest =
                request.targetEmail ===
                context.email;

            const canApproveSelfRequest =
                isSelfRequest &&
                request.targetEmail !==
                context.email &&
                request.requestedByEmail !==
                context.email;

            if (
                !canApproveOtherRequest &&
                !canApproveSelfRequest
            ) {
                const error = new Error(
                    "この降格申請を承認できません"
                );
                error.status = 403;
                throw error;
            }

            await assertMinimumAdminCountAfterOneRemoval();

            await ref.set(
                {
                    targetApproved: true,
                    approvedByUid:
                        context.uid,
                    approvedByEmail:
                        context.email,
                    approvedByName:
                        context.name,
                    status:
                        "waiting_requester_confirm",
                    updatedAt:
                        admin.firestore.FieldValue.serverTimestamp()
                },
                { merge: true }
            );

            return res.json({
                ok: true
            });
        } catch (err) {
            return sendError(
                res,
                err,
                "降格申請の承認に失敗しました"
            );
        }
    }
);

app.post(
    "/admin-demotion-requests/:id/confirm",
    async (req, res) => {
        try {
            const context =
                await requireadminAccount(req);

            const ref = db
                .collection(
                    "adminDemotionRequests"
                )
                .doc(req.params.id);

            let completedRequest = null;
            let removedAccount = null;
            let historyId = "";

            await db.runTransaction(
                async (transaction) => {
                    const snap =
                        await transaction.get(ref);

                    if (!snap.exists) {
                        const error = new Error(
                            "降格申請が見つかりません"
                        );
                        error.status = 404;
                        throw error;
                    }

                    const request =
                        snap.data();

                    if (
                        request.requestedByEmail !==
                        context.email
                    ) {
                        const error = new Error(
                            "申請者だけが最終確定できます"
                        );
                        error.status = 403;
                        throw error;
                    }

                    if (!request.targetApproved) {
                        const error = new Error(
                            "対象管理者の承認が完了していません"
                        );
                        error.status = 409;
                        throw error;
                    }

                    const accountsSnap =
                        await transaction.get(
                            db
                                .collection(
                                    "adminAccount"
                                )
                                .where(
                                    "active",
                                    "==",
                                    true
                                )
                        );

                    if (
                        accountsSnap.size - 1 <
                        2
                    ) {
                        const error = new Error(
                            "有効な管理者アカウントは2人以上必要です"
                        );
                        error.status = 409;
                        throw error;
                    }

                    const targetRef =
                        db
                            .collection(
                                "adminAccount"
                            )
                            .doc(
                                request.targetEmail
                            );

                    const targetSnap =
                        await transaction.get(
                            targetRef
                        );

                    if (
                        !targetSnap.exists ||
                        targetSnap.data()
                            .active !== true
                    ) {
                        const error = new Error(
                            "対象の管理者アカウントが見つかりません"
                        );
                        error.status = 404;
                        throw error;
                    }

                    completedRequest =
                        request;

                    removedAccount =
                        targetSnap.data();

                    historyId =
                        removedAccount.historyId ||
                        "";

                    transaction.set(
                        targetRef,
                        {
                            active: false,
                            updatedAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                            endedApprovedByUid:
                                context.uid,
                            endedApprovedByEmail:
                                context.email,
                            endedApprovedByName:
                                context.name
                        },
                        { merge: true }
                    );

                    transaction.set(
                        ref,
                        {
                            requesterConfirmed:
                                true,
                            status:
                                "completed",
                            updatedAt:
                                admin.firestore.FieldValue.serverTimestamp()
                        },
                        { merge: true }
                    );
                }
            );

            const historyPatch = {
                adminEndedAt:
                    Date.now(),
                endedApprovedByUid:
                    context.uid,
                endedApprovedByEmail:
                    context.email,
                endedApprovedByName:
                    context.name,
                updatedAt:
                    admin.firestore.FieldValue.serverTimestamp()
            };

            if (historyId) {
                await db
                    .collection(
                        "adminAccountHistory"
                    )
                    .doc(historyId)
                    .set(
                        historyPatch,
                        { merge: true }
                    );
            } else {
                await db
                    .collection(
                        "adminAccountHistory"
                    )
                    .add({
                        userUid:
                            completedRequest.targetUid ||
                            removedAccount.uid ||
                            "",
                        userEmail:
                            completedRequest.targetEmail,
                        userName:
                            completedRequest.targetName ||
                            removedAccount.name ||
                            "",
                        approvedByUid:
                            removedAccount.createdBy ||
                            "",
                        approvedByEmail:
                            removedAccount.createdByEmail ||
                            "",
                        approvedByName:
                            removedAccount.createdByName ||
                            "",
                        adminStartedAt:
                            timestampMillis(
                                removedAccount.createdAt
                            ) || null,
                        ...historyPatch,
                        createdAt:
                            admin.firestore.FieldValue.serverTimestamp()
                    });
            }

            return res.json({
                ok: true
            });
        } catch (err) {
            return sendError(
                res,
                err,
                "降格申請の確定に失敗しました"
            );
        }
    }
);

app.get("/admin-users", async (req, res) => {
    try {
        await requireadminAccount(req);

        // 1. Firebase Auth ユーザー一覧取得
        let authUsers = [];
        try {
            authUsers = await listAllAuthUsers();
        } catch (authErr) {
            console.error("listAllAuthUsers error:", authErr?.message);
            throw authErr;
        }

        // 2. プロファイル、管理者アカウントマップ、有効な管理者セッションを並行取得
        const [profilesByUid, adminAccounts, activeSessionsSnap] = await Promise.all([
            getUserProfilesByUid().catch((e) => {
                console.warn("getUserProfilesByUid warning in /admin-users:", e?.message);
                return new Map();
            }),
            getAdminAccountsMaps().catch((e) => {
                console.warn("getAdminAccountsMaps warning in /admin-users:", e?.message);
                return { byUid: new Map(), byEmail: new Map() };
            }),
            db.collection("adminSessions").where("active", "==", true).get().catch(() => ({ docs: [] }))
        ]);

        const now = Date.now();
        const activeAdminUids = new Set();
        (activeSessionsSnap.docs || []).forEach((doc) => {
            const data = doc.data() || {};
            const exp = timestampMillis(data.expiresAt);
            if (!exp || exp > now) {
                activeAdminUids.add(doc.id);
            }
        });

        // 3. 各ユーザーを個別に安全に統合（1ユーザーのデータ欠損で全体を500にしない）
        const users = [];
        for (const user of authUsers) {
            try {
                const uid = user?.uid || "";
                const email = normalizeEmail(user?.email || "");
                const profile = profilesByUid.get(uid) || {};
                const adminAccount =
                    adminAccounts.byUid.get(uid) ||
                    adminAccounts.byEmail.get(email) ||
                    null;

                const baseRecord = publicUserRecord(user, profile, adminAccount);
                users.push({
                    ...baseRecord,
                    adminMode: activeAdminUids.has(uid)
                });
            } catch (userErr) {
                console.warn(`User conversion skipped for uid=${user?.uid}:`, userErr?.message);
                // 個別ユーザーのデータ破損があっても安全なフォールバックで一覧に含める
                try {
                    users.push({
                        uid: user?.uid || "",
                        userId: "",
                        email: normalizeEmail(user?.email || ""),
                        name: user?.displayName || user?.email || "",
                        disabled: Boolean(user?.disabled),
                        emailVerified: Boolean(user?.emailVerified),
                        createdAt: timestampMillis(user?.metadata?.creationTime) || null,
                        lastLoginAt: timestampMillis(user?.metadata?.lastSignInTime) || null,
                        role: "-",
                        adminAccount: false,
                        adminAccountDetail: null,
                        adminMode: false,
                        providers: []
                    });
                } catch {
                    // 最悪でもスキップして一覧全体をクラッシュさせない
                }
            }
        }

        // 管理者アカウントを優先、次にメールアドレス順にソート
        users.sort((a, b) => {
            if (a.adminAccount !== b.adminAccount) {
                return a.adminAccount ? -1 : 1;
            }
            return (a.email || "").localeCompare(b.email || "");
        });

        return res.json({
            ok: true,
            total: users.length,
            users
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "ユーザー一覧の取得に失敗しました"
        );
    }
});

app.get("/admin-users/:uid", async (req, res) => {
    try {
        await requireadminAccount(req);

        const uid = String(req.params.uid || "").trim();

        if (!uid) {
            const error = new Error(
                "UIDが指定されていません"
            );
            error.status = 400;
            throw error;
        }

        let authUser = null;
        try {
            authUser = await admin.auth().getUser(uid);
        } catch {
            const error = new Error("対象のユーザーが見つかりません");
            error.status = 404;
            throw error;
        }

        const [
            profile,
            adminAccounts
        ] = await Promise.all([
            getUserProfileByUid(uid).catch(() => ({})),
            getAdminAccountsMaps().catch(() => ({ byUid: new Map(), byEmail: new Map() }))
        ]);

        const userEmail = normalizeEmail(authUser.email || profile.email || "");
        const adminAccount =
            adminAccounts.byUid.get(uid) ||
            adminAccounts.byEmail.get(userEmail) ||
            null;

        const session = await getActiveSession(uid).catch(() => null);

        let modeHistory = [];
        let accountHistory = [];

        try {
            const [modeSnap, accountHistorySnap] = await Promise.all([
                db
                    .collection("adminModeHistory")
                    .where("userUid", "==", uid)
                    .limit(30)
                    .get()
                    .catch(() => ({ docs: [] })),
                db
                    .collection("adminAccountHistory")
                    .where("userUid", "==", uid)
                    .limit(30)
                    .get()
                    .catch(() => ({ docs: [] }))
            ]);

            modeHistory = modeSnap.docs.map((doc) =>
                publicLogEvent(
                    doc,
                    "adminModeHistory",
                    "管理者モード履歴"
                )
            );
            accountHistory = accountHistorySnap.docs.map((doc) =>
                publicLogEvent(
                    doc,
                    "adminAccountHistory",
                    "管理者アカウント履歴"
                )
            );
        } catch (histErr) {
            console.warn("User history query warning:", histErr?.message);
        }

        const history = [
            ...modeHistory,
            ...accountHistory
        ].sort(sortByOccurredAtDesc);

        const userRecord = publicUserRecord(
            authUser,
            profile,
            adminAccount
        );

        return res.json({
            ok: true,
            user: {
                ...userRecord,
                adminMode: !!session,
                session
            },
            history
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "ユーザー詳細の取得に失敗しました"
        );
    }
});

app.get("/admin-logs", async (req, res) => {
    try {
        await requireadminAccount(req);

        const [
            modeSnap,
            accountSnap,
            demotionSnap,
            auditSnap
        ] = await Promise.all([
            db
                .collection("adminModeHistory")
                .limit(100)
                .get()
                .catch(() => ({ docs: [] })),
            db
                .collection("adminAccountHistory")
                .limit(100)
                .get()
                .catch(() => ({ docs: [] })),
            db
                .collection("adminDemotionRequests")
                .limit(100)
                .get()
                .catch(() => ({ docs: [] })),
            db
                .collection("auditLogs")
                .limit(100)
                .get()
                .catch(() => ({ docs: [] }))
        ]);

        const logs = [
            ...modeSnap.docs.map((doc) => {
                const data = doc.data() || {};
                return {
                    id: doc.id,
                    source: "adminModeHistory",
                    type: "管理者モード",
                    actorUid: data.approvedByUid || data.userUid || "",
                    actorEmail: data.approvedByEmail || data.userEmail || "",
                    actorName: data.approvedByName || data.userName || "",
                    target: data.targetEmail || data.userEmail || "",
                    result: data.status || (data.active ? "in_progress" : "completed"),
                    occurredAt: eventTime(data),
                    details: data
                };
            }),
            ...accountSnap.docs.map((doc) => {
                const data = doc.data() || {};
                const isInitial =
                    data.isInitialSetup === true ||
                    data.approvedByEmail === "初期設定" ||
                    data.approvedByName === "初期設定" ||
                    data.createdByEmail === "初期設定" ||
                    data.createdBy === "initial_setup" ||
                    (!data.approvedByEmail && data.userEmail === data.createdByEmail);

                const actorEmail = isInitial ? "初期設定" : "admin";
                const target = data.userEmail || data.targetEmail || data.email || "";

                return {
                    id: doc.id,
                    source: "adminAccountHistory",
                    type: "管理者アカウント",
                    actorUid: isInitial ? "initial_setup" : (data.approvedByUid || "admin"),
                    actorEmail,
                    actorName: isInitial ? "初期設定" : "admin",
                    target,
                    result: data.status || (data.adminEndedAt ? "terminated" : "completed"),
                    occurredAt: eventTime(data),
                    details: data
                };
            }),
            ...demotionSnap.docs.map((doc) => {
                const data = doc.data() || {};
                return {
                    id: doc.id,
                    source: "adminDemotionRequests",
                    type: "降格申請",
                    actorUid: data.approvedByUid || data.requestedByUid || "admin",
                    actorEmail: "admin",
                    actorName: "admin",
                    target: data.targetEmail || data.userEmail || "",
                    result: data.status || "completed",
                    occurredAt: eventTime(data),
                    details: data
                };
            }),
            ...auditSnap.docs.map((doc) =>
                publicLogEvent(
                    doc,
                    "auditLogs",
                    "監査ログ",
                    {
                        uid: "actorUid",
                        email: "userEmail",
                        name: "userName"
                    }
                )
            )
        ]
            .sort(sortByOccurredAtDesc)
            .slice(0, 200);

        return res.json({
            ok: true,
            logs
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "管理ログの取得に失敗しました"
        );
    }
});

app.get("/admin-analytics", async (req, res) => {
    try {
        await requireadminAccount(req);

        // 独立した集計処理を呼び出し
        const data = await aggregateAdminAnalytics(req.query.days);

        return res.json({
            ok: true,
            ...data
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "分析データの取得に失敗しました"
        );
    }
});

/* ============================
   管理者履歴削除
   ============================ */

async function deleteExpiredHistory() {
    const cutoff =
        Date.now() - HISTORY_RETENTION_MS;

    const collections = [
        {
            name: "adminModeHistory",
            field: "endedAt"
        },
        {
            name: "adminAccountHistory",
            field: "adminEndedAt"
        }
    ];

    let deleted = 0;

    for (const collection of collections) {
        const snap = await db
            .collection(collection.name)
            .where(
                collection.field,
                "<",
                cutoff
            )
            .limit(500)
            .get();

        if (snap.empty) continue;

        const batch = db.batch();

        snap.docs.forEach((doc) => {
            batch.delete(doc.ref);
            deleted += 1;
        });

        await batch.commit();
    }

    return deleted;
}

export const cleanupAdminHistory =
    onSchedule(
        {
            schedule: "0 11 * * *",
            timeZone: "Asia/Tokyo"
        },
        async () => {
            const deleted =
                await deleteExpiredHistory();

            console.log(
                `Deleted admin history documents: ${deleted}`
            );
        }
    );



/* ============================
   メール送信
   ============================ */

async function sendSignupVerificationEmail({
    email,
    code,
    name
}) {
    const apiKey =
        process.env.RESEND_KEY;

    const from =
        process.env.RESEND_FROM;

    if (!apiKey) {
        const error = new Error(
            "RESEND_KEYが設定されていません"
        );

        error.status = 500;
        error.errorCode = "RESEND_KEY_MISSING";

        throw error;
    }

    if (!from) {
        const error = new Error(
            "RESEND_FROMが設定されていません"
        );

        error.status = 500;
        error.errorCode = "RESEND_FROM_MISSING";

        throw error;
    }

    const displayName =
        typeof name === "string" && name.trim()
            ? name.trim()
            : "ユーザー";

    const safeName =
        escapeHtml(displayName);

    const safeCode =
        escapeHtml(code);

    const text = `${displayName} さん

LUNAGSへの登録ありがとうございます。

新規登録を続行するには、
以下の確認コードを入力してください。

確認コード：${code}

このコードを新規登録画面に入力してください。

このメールに心当たりがない場合は、
このメールを無視してください。

LUNAGS
`;

    const html = `
<!DOCTYPE html>
<html lang="ja">

<head>
    <meta charset="UTF-8">
    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >
    <title>LUNAGS メールアドレス確認</title>
</head>

<body style="
    margin: 0;
    padding: 0;
    background: #DFEFFD;
    font-family:
        -apple-system,
        BlinkMacSystemFont,
        'Segoe UI',
        'Hiragino Kaku Gothic ProN',
        'Yu Gothic',
        Meiryo,
        sans-serif;
">

    <div style="
        width: 100%;
        padding: 40px 16px;
        box-sizing: border-box;
    ">

        <div style="
            max-width: 560px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 18px;
            overflow: hidden;
            box-shadow:
                0 8px 30px rgba(40, 100, 160, 0.12);
        ">

            <!-- Header -->

            <div style="
                padding: 28px 32px;
                background: #73B8FD;
                text-align: center;
            ">

                <div style="
                    color: #ffffff;
                    font-size: 26px;
                    font-weight: 700;
                    letter-spacing: 1px;
                ">
                    LUNAGS
                </div>

            </div>

            <!-- Content -->

            <div style="
                padding: 36px 32px 32px;
            ">

                <h1 style="
                    margin: 0 0 24px;
                    color: #1f2937;
                    font-size: 24px;
                    line-height: 1.4;
                    text-align: center;
                ">
                    メールアドレス確認
                </h1>

                <p style="
                    margin: 0 0 18px;
                    color: #333333;
                    font-size: 15px;
                    line-height: 1.8;
                ">
                    ${safeName} さん
                </p>

                <p style="
                    margin: 0 0 18px;
                    color: #555555;
                    font-size: 14px;
                    line-height: 1.8;
                ">
                    LUNAGSへの登録ありがとうございます。
                    <br>
                    新規登録を続行するには、
                    以下の確認コードを入力してください。
                </p>

                <!-- Verification Code -->

                <div style="
                    margin: 28px 0;
                    padding: 24px 16px;
                    background: #DFEFFD;
                    border: 1px solid #9ED4FC;
                    border-radius: 14px;
                    text-align: center;
                ">

                    <div style="
                        margin-bottom: 10px;
                        color: #4b5563;
                        font-size: 12px;
                        font-weight: 600;
                        letter-spacing: 1px;
                    ">
                        確認コード
                    </div>

                    <div style="
                        color: #2563a6;
                        font-size: 34px;
                        font-weight: 700;
                        letter-spacing: 8px;
                        line-height: 1.3;
                    ">
                        ${safeCode}
                    </div>

                </div>

                <p style="
                    margin: 0;
                    color: #666666;
                    font-size: 13px;
                    line-height: 1.8;
                    text-align: center;
                ">
                    このコードを新規登録画面に入力してください。
                </p>

                <!-- Notice -->

                <div style="
                    margin-top: 28px;
                    padding: 16px;
                    background: #f7f9fb;
                    border-radius: 10px;
                ">

                    <p style="
                        margin: 0;
                        color: #777777;
                        font-size: 12px;
                        line-height: 1.8;
                    ">
                        このメールに心当たりがない場合は、
                        このメールを無視してください。
                    </p>

                </div>

            </div>

            <!-- Footer -->

            <div style="
                padding: 20px 32px;
                background: #f8fafc;
                border-top: 1px solid #eef2f6;
                text-align: center;
            ">

                <div style="
                    color: #73B8FD;
                    font-size: 14px;
                    font-weight: 700;
                    letter-spacing: 1px;
                ">
                    LUNAGS
                </div>

                <div style="
                    margin-top: 6px;
                    color: #9aa3ad;
                    font-size: 11px;
                ">
                    This is an automated email.
                </div>

            </div>

        </div>

    </div>

</body>

</html>
`;

    const resend =
        new Resend(apiKey);

    console.log(
        "========================================"
    );

    console.log(
        " RESEND EMAIL REQUEST"
    );

    console.log(
        "========================================"
    );

    console.log(
        "To:",
        email
    );

    console.log(
        "From:",
        from
    );

    const result =
        await resend.emails.send({
            from,
            to: email,
            subject: "LUNAGS メールアドレス確認",
            text,
            html
        });

    console.log(
        "Resend result:",
        JSON.stringify(result)
    );

    if (result?.error) {
        const error = new Error(
            result.error.message ||
            "メール送信に失敗しました"
        );

        error.status =
            result.error.statusCode === 400 ||
                result.error.statusCode === 422
                ? 400
                : 500;

        error.errorCode =
            "RESEND_EMAIL_ERROR";

        throw error;
    }

    return result;
}

app.post("/", async (req, res) => {
    try {
        console.log("========================================");
        console.log(" RESEND EMAIL REQUEST");
        console.log("========================================");

        const body = req.body || {};

        console.log("Request body:", JSON.stringify(body));

        /*
         * ========================================
         * 環境変数確認
         * ========================================
         */

        const apiKey = process.env.RESEND_KEY;
        const from = process.env.RESEND_FROM;

        if (!apiKey) {
            const error = new Error(
                "RESEND_KEYが設定されていません"
            );

            error.status = 500;
            error.errorCode = "RESEND_KEY_MISSING";

            throw error;
        }

        if (!from) {
            const error = new Error(
                "RESEND_FROMが設定されていません"
            );

            error.status = 500;
            error.errorCode = "RESEND_FROM_MISSING";

            throw error;
        }

        /*
         * ========================================
         * リクエスト取得
         * ========================================
         */

        const {
            to,
            code,
            name
        } = body;

        /*
         * ========================================
         * 入力チェック
         * ========================================
         */

        if (
            typeof to !== "string" ||
            !to.trim()
        ) {
            const error = new Error(
                "送信先メールアドレスがありません"
            );

            error.status = 400;
            error.errorCode = "EMAIL_TO_MISSING";

            throw error;
        }

        if (
            typeof code !== "string" ||
            !code.trim()
        ) {
            const error = new Error(
                "確認コードがありません"
            );

            error.status = 400;
            error.errorCode = "VERIFICATION_CODE_MISSING";

            throw error;
        }

        /*
         * ========================================
         * メールアドレス簡易チェック
         * ========================================
         */

        const email = to.trim();

        const emailPattern =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(email)) {
            const error = new Error(
                "メールアドレスの形式が正しくありません"
            );

            error.status = 400;
            error.errorCode = "INVALID_EMAIL";

            throw error;
        }

        /*
         * ========================================
         * 確認コードチェック
         * ========================================
         */

        const verificationCode = code.trim();

        if (
            !/^\d{6}$/.test(verificationCode)
        ) {
            const error = new Error(
                "確認コードは6桁の数字である必要があります"
            );

            error.status = 400;
            error.errorCode = "INVALID_VERIFICATION_CODE";

            throw error;
        }

        /*
         * ========================================
         * 名前の安全化
         * ========================================
         */

        const displayName =
            typeof name === "string" && name.trim()
                ? name.trim()
                : "ユーザー";

        /*
         * HTMLエスケープ
         *
         * ユーザー入力をそのままHTMLに入れない
         */

        const escapeHtml = (value) => {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        };

        const safeName =
            escapeHtml(displayName);

        const safeCode =
            escapeHtml(verificationCode);

        /*
         * ========================================
         * Resendに送信
         * ========================================
         */

        const result =
            await sendSignupVerificationEmail({
                email,
                code: verificationCode,
                name: displayName
            });

        console.log(
            "Resend result:",
            JSON.stringify(result)
        );

        /*
         * ========================================
         * 成功
         * ========================================
         */

        return res.json({
            ok: true,
            message: "確認メールを送信しました",
            id: result?.data?.id || null
        });

    } catch (err) {
        console.error(
            "RESEND EMAIL ERROR:",
            err
        );

        return sendError(
            res,
            err,
            "メール送信に失敗しました"
        );
    }
});

// 未定義API用の404ハンドラー
app.use((req, res) => {
    const error = new Error("指定されたAPIが見つかりません");
    error.status = 404;

    return sendError(res, error);
});

signupSkipApp.use((req, res) => {
    const error = new Error("指定されたAPIが見つかりません");
    error.status = 404;

    return sendError(res, error);
});

/* ============================
   Functions公開
   ============================ */

export const send = onRequest(
    {
        invoker: "public"
    },
    (req, res) => {
        return app(req, res);
    }
);

/* ============================
   新規登録スキップモード関数
   ============================ */

export const signupSkip = onRequest(
    {
        invoker: "public",
        cors: [
            "https://lunags-development.web.app",
            "https://lunags-development.firebaseapp.com",
            "https://lunags.jp",
            "https://dev.lunags.jp"
        ],
        secrets: [SIGNUP_SKIP_PASSWORD]
    },
    async (req, res) => {
        return signupSkipApp(req, res);
    }
);

/**
 * ============================
 * Express API
 * ============================
 */
export const api = onRequest(
    {
        invoker: "public"
    },
    app
);
