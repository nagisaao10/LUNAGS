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

admin.initializeApp();

const app = express();
const signupSkipApp = express();

const db = admin.firestore();

const allowedOrigins = [
    "https://lunags-development.web.app",
    "https://lunags-development.firebaseapp.com",
    "https://lunags-production.web.app",
    "https://lunags-production.firebaseapp.com",
];

app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
signupSkipApp.use(express.json());

const DEFAULT_ADMIN_MODE_MINUTES = 30;
const MIN_ADMIN_MODE_MINUTES = 1;
const MAX_ADMIN_MODE_MINUTES = 2880;
const HISTORY_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function timestampMillis(value) {
    if (!value) return null;
    if (typeof value === "number") return value;
    if (typeof value.toMillis === "function") return value.toMillis();
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

function sendError(res, error, fallback = "処理に失敗しました") {
    console.error(error);

    return res.status(error.status || 500).json({
        ok: false,
        error: error.message || fallback
    });
}

/* ============================
   新規登録スキップモード
   ============================ */

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
        .createHmac("sha256", SIGNUP_SKIP_PASSWORD.value())
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
            .createHmac("sha256", SIGNUP_SKIP_PASSWORD.value())
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
            const password = String(req.body.password || "");
            const expectedPassword =
                SIGNUP_SKIP_PASSWORD.value();

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
    const authHeader = req.headers.authorization;

    if (
        !authHeader ||
        !authHeader.startsWith("Bearer ")
    ) {
        const error = new Error(
            "認証トークンがありません"
        );
        error.status = 401;
        throw error;
    }

    return await admin
        .auth()
        .verifyIdToken(authHeader.substring(7));
}

async function getUserProfileByUid(uid) {
    let authUser = null;
    let userDoc = null;
    let userId = "";

    try {
        authUser = await admin.auth().getUser(uid);
    } catch {
        authUser = null;
    }

    const uidMapSnap = await db
        .collection("uidMap")
        .doc(uid)
        .get();

    if (uidMapSnap.exists) {
        userId = uidMapSnap.data().userId || "";

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

    return {
        uid,
        userId,
        email: normalizeEmail(
            userDoc?.email ||
            authUser?.email ||
            ""
        ),
        name:
            userDoc?.displayName ||
            userDoc?.name ||
            authUser?.displayName ||
            authUser?.email ||
            ""
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

    const usersSnap = await db
        .collection("users")
        .where("email", "==", normalized)
        .limit(1)
        .get();

    const userDoc = usersSnap.empty
        ? null
        : usersSnap.docs[0].data();

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

async function getAdminAccountByEmail(email) {
    const normalized = normalizeEmail(email);

    if (!normalized) return null;

    const accountSnap = await db
        .collection("adminAccounts")
        .doc(normalized)
        .get();

    if (
        accountSnap.exists &&
        accountSnap.data().active === true
    ) {
        return publicAccount(accountSnap.data());
    }

    return null;
}

async function finishAdminSession(
    uid,
    endReason,
    actor = {}
) {
    const sessionRef = db
        .collection("adminSessions")
        .doc(uid);

    const sessionSnap = await sessionRef.get();

    if (
        !sessionSnap.exists ||
        sessionSnap.data().active !== true
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
}

async function getActiveSession(uid) {
    const sessionSnap = await db
        .collection("adminSessions")
        .doc(uid)
        .get();

    if (
        !sessionSnap.exists ||
        sessionSnap.data().active !== true
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
}

async function getCurrentContext(req) {
    const decoded = await verifyFirebaseUser(req);
    const profile =
        await getUserProfileByUid(decoded.uid);

    const email = normalizeEmail(
        decoded.email || profile.email
    );

    const adminAccount =
        await getAdminAccountByEmail(email);

    const session =
        await getActiveSession(decoded.uid);

    return {
        decoded,
        uid: decoded.uid,
        email,
        name:
            profile.name ||
            decoded.name ||
            email,
        isAdminAccount: !!adminAccount,
        adminAccount,
        adminMode: !!session,
        session
    };
}

async function requireAdminAccount(req) {
    const context =
        await getCurrentContext(req);

    if (!context.isAdminAccount) {
        const error = new Error(
            "管理者アカウント権限がありません"
        );
        error.status = 403;
        throw error;
    }

    return context;
}

async function requireAdminAccountOrMode(req) {
    const context =
        await getCurrentContext(req);

    if (
        !context.isAdminAccount &&
        !context.adminMode
    ) {
        const error = new Error(
            "管理者権限がありません"
        );
        error.status = 403;
        throw error;
    }

    return context;
}

async function getActiveAdminAccounts() {
    const snap = await db
        .collection("adminAccounts")
        .where("active", "==", true)
        .get();

    return snap.docs.map((doc) =>
        publicAccount(doc.data())
    );
}

async function assertMinimumAdminCountAfterOneRemoval() {
    const accounts =
        await getActiveAdminAccounts();

    if (accounts.length - 1 < 2) {
        const error = new Error(
            "有効な管理者アカウントは2人以上必要です"
        );
        error.status = 409;
        throw error;
    }
}

function publicUserRecord(user, profile = {}, adminAccount = null) {
    const providerIds = (user.providerData || [])
        .map((provider) => provider.providerId)
        .filter(Boolean);

    return {
        uid: user.uid,
        userId: profile.userId || "",
        email: normalizeEmail(user.email || profile.email || ""),
        name:
            profile.displayName ||
            profile.name ||
            user.displayName ||
            "",
        disabled: user.disabled === true,
        emailVerified: user.emailVerified === true,
        createdAt:
            timestampMillis(profile.createdAt) ||
            profile.createdAt ||
            user.metadata?.creationTime ||
            null,
        lastLoginAt:
            timestampMillis(profile.lastLoginAt) ||
            profile.lastLoginAt ||
            user.metadata?.lastSignInTime ||
            null,
        isAdminAccount: !!adminAccount,
        adminAccount,
        providers: providerIds,
        phoneNumber: user.phoneNumber || profile.phoneNumber || "",
        photoURL: user.photoURL || profile.photoURL || ""
    };
}

async function getUserProfilesByUid() {
    const [usersSnap, uidMapSnap] = await Promise.all([
        db.collection("users").get(),
        db.collection("uidMap").get()
    ]);

    const userIdsByUid = new Map();
    uidMapSnap.docs.forEach((doc) => {
        const data = doc.data();
        if (data.userId) {
            userIdsByUid.set(doc.id, data.userId);
        }
    });

    const profiles = new Map();

    usersSnap.docs.forEach((doc) => {
        const data = doc.data();
        const uid = data.uid || data.authUid || "";
        const uidFromMap = [...userIdsByUid.entries()]
            .find(([, userId]) => userId === doc.id)?.[0] || "";
        const resolvedUid = uid || uidFromMap;

        if (!resolvedUid) return;

        profiles.set(resolvedUid, {
            ...data,
            userId: doc.id
        });
    });

    return profiles;
}

async function listAllAuthUsers() {
    const users = [];
    let pageToken = undefined;

    do {
        const result = await admin.auth().listUsers(1000, pageToken);
        users.push(...result.users);
        pageToken = result.pageToken;
    } while (pageToken);

    return users;
}

async function getAdminAccountsByUid() {
    const accounts = await getActiveAdminAccounts();
    const map = new Map();

    accounts.forEach((account) => {
        if (account.uid) {
            map.set(account.uid, account);
        }
    });

    return map;
}

function eventTime(data) {
    return (
        timestampMillis(data.createdAt) ||
        timestampMillis(data.endedAt) ||
        timestampMillis(data.updatedAt) ||
        timestampMillis(data.adminStartedAt) ||
        timestampMillis(data.adminEndedAt) ||
        data.createdAt ||
        data.endedAt ||
        data.updatedAt ||
        data.adminStartedAt ||
        data.adminEndedAt ||
        null
    );
}

function publicLogEvent(doc, source, type, actorFields = {}) {
    const data = doc.data();

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

async function countCollection(collectionName) {
    const snap = await db.collection(collectionName).count().get();
    return snap.data().count || 0;
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
                email: context.email,
                name: context.name
            },
            isAdminAccount:
                context.isAdminAccount,
            adminAccount:
                context.adminAccount,
            adminMode:
                context.adminMode,
            session:
                publicSession(context.session)
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
            await requireAdminAccount(req);

        const targetUser =
            await findUserByEmail(
                req.body.email
            );

        const targetAdminAccount =
            await getAdminAccountByEmail(
                targetUser.email
            );

        if (targetAdminAccount) {
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
        await requireAdminAccount(req);

        const accounts =
            await getActiveAdminAccounts();

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
            await requireAdminAccount(req);

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
            .collection("adminAccounts")
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
                await requireAdminAccount(req);

            const duration =
                validateAdminModeDuration(
                    req.body
                        .adminModeDurationMinutes
                );

            const ref = db
                .collection("adminAccounts")
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
        await requireAdminAccount(req);

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
                await requireAdminAccount(req);

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
                await requireAdminAccount(req);

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
            await requireAdminAccount(req);

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
            await requireAdminAccount(req);

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
            await requireAdminAccount(req);

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
                await requireAdminAccount(req);

            const target =
                await findUserByEmail(
                    req.body.targetEmail ||
                    req.body.email
                );

            const targetAccount =
                await getAdminAccountByEmail(
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
                await requireAdminAccount(req);

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
                await requireAdminAccount(req);

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
                                    "adminAccounts"
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
                                "adminAccounts"
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
        await requireAdminAccount(req);

        const [
            authUsers,
            profilesByUid,
            adminAccountsByUid
        ] = await Promise.all([
            listAllAuthUsers(),
            getUserProfilesByUid(),
            getAdminAccountsByUid()
        ]);

        const users = authUsers
            .map((user) =>
                publicUserRecord(
                    user,
                    profilesByUid.get(user.uid) || {},
                    adminAccountsByUid.get(user.uid) || null
                )
            )
            .sort((a, b) =>
                a.email.localeCompare(b.email)
            );

        return res.json({
            ok: true,
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
        await requireAdminAccount(req);

        const uid = String(req.params.uid || "").trim();

        if (!uid) {
            const error = new Error(
                "UIDが指定されていません"
            );
            error.status = 400;
            throw error;
        }

        const [
            authUser,
            profile,
            adminAccountsByUid
        ] = await Promise.all([
            admin.auth().getUser(uid),
            getUserProfileByUid(uid),
            getAdminAccountsByUid()
        ]);

        const [modeSnap, accountHistorySnap] =
            await Promise.all([
                db
                    .collection("adminModeHistory")
                    .where("userUid", "==", uid)
                    .limit(30)
                    .get(),
                db
                    .collection("adminAccountHistory")
                    .where("userUid", "==", uid)
                    .limit(30)
                    .get()
            ]);

        const history = [
            ...modeSnap.docs.map((doc) =>
                publicLogEvent(
                    doc,
                    "adminModeHistory",
                    "管理者モード履歴"
                )
            ),
            ...accountHistorySnap.docs.map((doc) =>
                publicLogEvent(
                    doc,
                    "adminAccountHistory",
                    "管理者アカウント履歴"
                )
            )
        ].sort(sortByOccurredAtDesc);

        return res.json({
            ok: true,
            user: publicUserRecord(
                authUser,
                profile,
                adminAccountsByUid.get(uid) || null
            ),
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
        await requireAdminAccount(req);

        const [
            modeSnap,
            accountSnap,
            demotionSnap
        ] = await Promise.all([
            db
                .collection("adminModeHistory")
                .limit(100)
                .get(),
            db
                .collection("adminAccountHistory")
                .limit(100)
                .get(),
            db
                .collection("adminDemotionRequests")
                .limit(100)
                .get()
        ]);

        const logs = [
            ...modeSnap.docs.map((doc) =>
                publicLogEvent(
                    doc,
                    "adminModeHistory",
                    "管理者モード"
                )
            ),
            ...accountSnap.docs.map((doc) =>
                publicLogEvent(
                    doc,
                    "adminAccountHistory",
                    "管理者アカウント"
                )
            ),
            ...demotionSnap.docs.map((doc) =>
                publicLogEvent(
                    doc,
                    "adminDemotionRequests",
                    "降格申請",
                    {
                        uid: "requestedBy",
                        email: "requestedByEmail",
                        name: "requestedByName"
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
        await requireAdminAccount(req);

        const [
            authUsers,
            activeAdmins,
            activeSessionsSnap,
            modeHistoryCount,
            accountHistoryCount,
            demotionRequestCount
        ] = await Promise.all([
            listAllAuthUsers(),
            getActiveAdminAccounts(),
            db
                .collection("adminSessions")
                .where("active", "==", true)
                .get(),
            countCollection("adminModeHistory"),
            countCollection("adminAccountHistory"),
            countCollection("adminDemotionRequests")
        ]);

        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const createdBuckets = Array.from(
            { length: 30 },
            (_, index) => {
                const date = new Date(
                    now - (29 - index) * dayMs
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

        authUsers.forEach((user) => {
            if (user.disabled) disabledUsers += 1;
            if (user.emailVerified) verifiedUsers += 1;

            const createdAt = Date.parse(
                user.metadata?.creationTime || ""
            );
            const lastLoginAt = Date.parse(
                user.metadata?.lastSignInTime || ""
            );

            if (
                Number.isFinite(lastLoginAt) &&
                now - lastLoginAt <= 30 * dayMs
            ) {
                activeLast30Days += 1;
            }

            if (
                Number.isFinite(createdAt) &&
                now - createdAt <= 30 * dayMs
            ) {
                const key = new Date(createdAt)
                    .toISOString()
                    .slice(0, 10);
                const bucket = bucketByKey.get(key);
                if (bucket) bucket.count += 1;
            }
        });

        const activeSessions = [];

        for (const doc of activeSessionsSnap.docs) {
            const session = {
                uid: doc.id,
                ...doc.data()
            };
            const expiresAt =
                timestampMillis(session.expiresAt) ||
                Number(session.expiresAt);

            if (expiresAt && expiresAt <= now) {
                await finishAdminSession(
                    doc.id,
                    "期限切れ"
                );
            } else {
                activeSessions.push(session);
            }
        }

        return res.json({
            ok: true,
            summary: {
                totalUsers: authUsers.length,
                disabledUsers,
                enabledUsers:
                    authUsers.length - disabledUsers,
                verifiedUsers,
                activeLast30Days,
                activeAdminAccounts:
                    activeAdmins.length,
                activeAdminSessions:
                    activeSessions.length,
                adminModeHistory:
                    modeHistoryCount,
                adminAccountHistory:
                    accountHistoryCount,
                demotionRequests:
                    demotionRequestCount
            },
            userGrowth: createdBuckets,
            generatedAt: now
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

app.post("/", async (req, res) => {
    try {
        const apiKey = process.env.RESEND_KEY;

        if (!apiKey) {
            const error = new Error(
                "RESEND_KEYが設定されていません"
            );
            error.status = 500;
            throw error;
        }

        const resend = new Resend(apiKey);

        const result = await resend.emails.send(
            req.body
        );

        return res.json({
            ok: true,
            result
        });
    } catch (err) {
        return sendError(
            res,
            err,
            "メール送信に失敗しました"
        );
    }
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
            "https://lunags-production.web.app",
            "https://lunags-production.firebaseapp.com",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://localhost:5174",
            "http://127.0.0.1:5174"
        ],
        secrets: [SIGNUP_SKIP_PASSWORD]
    },
    async (req, res) => {
        return signupSkipApp(req, res);
    }
);
