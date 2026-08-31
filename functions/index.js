import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import express from "express";
import cors from "cors";
import { Resend } from "resend";
import admin from "firebase-admin";
import crypto from "crypto";

admin.initializeApp();

const app = express();
const db = admin.firestore();

app.use(express.json());
app.use(cors());

const resend = new Resend(process.env.RESEND_KEY);

const LUNAGS_ADMIN_EMAILS = defineSecret("LUNAGS_ADMIN_EMAILS");
const ADMIN_APPROVAL_EXPIRE_MS = 5 * 60 * 1000;
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
        const error = new Error("管理者モード時間は1〜2880分の整数で指定してください");
        error.status = 400;
        throw error;
    }

    return duration;
}

function getSecretAdminEmails() {
    let secretEmails = [];
    try {
        const val = LUNAGS_ADMIN_EMAILS.value();
        if (val) {
            secretEmails = val.split(",").map(normalizeEmail).filter(Boolean);
        }
    } catch {
        secretEmails = [];
    }

    const defaultAdmins = ["nagisa.ito121001m@gmail.com"];
    return Array.from(new Set([...defaultAdmins, ...secretEmails]));
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
        createdAt: timestampMillis(account.createdAt) || account.createdAt || null,
        updatedAt: timestampMillis(account.updatedAt) || account.updatedAt || null,
        adminModeDurationMinutes:
            account.adminModeDurationMinutes || DEFAULT_ADMIN_MODE_MINUTES
    };
}

function publicSession(session) {
    if (!session) return null;

    return {
        uid: session.uid || session.userUid || "",
        email: session.email || "",
        userName: session.userName || "",
        active: session.active === true,
        createdAt: timestampMillis(session.createdAt) || session.createdAt || null,
        expiresAt: timestampMillis(session.expiresAt) || session.expiresAt || null,
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
        createdAt: timestampMillis(data.createdAt) || data.createdAt || null
    };
}

function sendError(res, error, fallback = "処理に失敗しました") {
    console.error(error);

    return res.status(error.status || 500).json({
        ok: false,
        error: error.message || fallback
    });
}

async function verifyFirebaseUser(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        const error = new Error("認証トークンがありません");
        error.status = 401;
        throw error;
    }

    return await admin.auth().verifyIdToken(authHeader.substring(7));
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

    const uidMapSnap = await db.collection("uidMap").doc(uid).get();

    if (uidMapSnap.exists) {
        userId = uidMapSnap.data().userId || "";

        if (userId) {
            const userSnap = await db.collection("users").doc(userId).get();
            if (userSnap.exists) {
                userDoc = userSnap.data();
            }
        }
    }

    return {
        uid,
        userId,
        email: normalizeEmail(userDoc?.email || authUser?.email || ""),
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
        const error = new Error("メールアドレスが指定されていません");
        error.status = 400;
        throw error;
    }

    let authUser = null;

    try {
        authUser = await admin.auth().getUserByEmail(normalized);
    } catch {
        authUser = null;
    }

    const usersSnap = await db
        .collection("users")
        .where("email", "==", normalized)
        .limit(1)
        .get();
    const userDoc = usersSnap.empty ? null : usersSnap.docs[0].data();

    if (!authUser && !userDoc?.uid) {
        const error = new Error("対象アカウントが見つかりません");
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

    if (accountSnap.exists && accountSnap.data().active === true) {
        return publicAccount(accountSnap.data());
    }

    if (getSecretAdminEmails().includes(normalized)) {
        return {
            email: normalized,
            uid: "",
            name: "",
            active: true,
            createdBy: "LUNAGS_ADMIN_EMAILS",
            createdByEmail: "LUNAGS_ADMIN_EMAILS",
            createdByName: "初期管理者",
            createdAt: null,
            updatedAt: null,
            adminModeDurationMinutes: DEFAULT_ADMIN_MODE_MINUTES
        };
    }

    return null;
}

async function finishAdminSession(uid, endReason, actor = {}) {
    const sessionRef = db.collection("adminSessions").doc(uid);
    const sessionSnap = await sessionRef.get();

    if (!sessionSnap.exists || sessionSnap.data().active !== true) {
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
        approvedByUid: session.approvedByUid || "",
        approvedByEmail: session.approvedByEmail || "",
        approvedByName: session.approvedByName || "",
        startedAt: session.createdAt || null,
        expiresAt: session.expiresAt || null,
        endedAt,
        endReason,
        endedByUid: actor.uid || "",
        endedByEmail: actor.email || "",
        endedByName: actor.name || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await sessionRef.set(
        {
            active: false,
            endedAt,
            endReason,
            endedByUid: actor.uid || "",
            endedByEmail: actor.email || "",
            endedByName: actor.name || "",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
    );

    return true;
}

async function getActiveSession(uid) {
    const sessionSnap = await db.collection("adminSessions").doc(uid).get();

    if (!sessionSnap.exists || sessionSnap.data().active !== true) {
        return null;
    }

    const session = {
        uid,
        ...sessionSnap.data()
    };
    const expiresAt = timestampMillis(session.expiresAt) || Number(session.expiresAt);

    if (!expiresAt || expiresAt <= Date.now()) {
        await finishAdminSession(uid, "期限切れ");
        return null;
    }

    return session;
}

async function getCurrentContext(req) {
    const decoded = await verifyFirebaseUser(req);
    const profile = await getUserProfileByUid(decoded.uid);
    const email = normalizeEmail(decoded.email || profile.email);
    const adminAccount = await getAdminAccountByEmail(email);
    const session = await getActiveSession(decoded.uid);

    return {
        decoded,
        uid: decoded.uid,
        email,
        name: profile.name || decoded.name || email,
        isAdminAccount: !!adminAccount,
        adminAccount,
        adminMode: !!session,
        session
    };
}

async function requireAdminAccount(req) {
    const context = await getCurrentContext(req);

    if (!context.isAdminAccount) {
        const error = new Error("管理者アカウント権限がありません");
        error.status = 403;
        throw error;
    }

    return context;
}

async function requireAdminAccountOrMode(req) {
    const context = await getCurrentContext(req);

    if (!context.isAdminAccount && !context.adminMode) {
        const error = new Error("管理者権限がありません");
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
    const accounts = snap.docs.map((doc) => publicAccount(doc.data()));
    const knownEmails = new Set(accounts.map((account) => account.email));

    for (const email of getSecretAdminEmails()) {
        if (!knownEmails.has(email)) {
            accounts.push({
                email,
                uid: "",
                name: "",
                active: true,
                createdBy: "LUNAGS_ADMIN_EMAILS",
                createdByEmail: "LUNAGS_ADMIN_EMAILS",
                createdByName: "初期管理者",
                createdAt: null,
                updatedAt: null,
                adminModeDurationMinutes: DEFAULT_ADMIN_MODE_MINUTES
            });
        }
    }

    return accounts;
}

async function assertMinimumAdminCountAfterOneRemoval() {
    const accounts = await getActiveAdminAccounts();

    if (accounts.length - 1 < 2) {
        const error = new Error("有効な管理者アカウントは2人以上必要です");
        error.status = 409;
        throw error;
    }
}

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

        if (result.error) {
            return res.status(500).json(result);
        }

        return res.json(result);
    } catch (err) {
        return sendError(res, err, "メール送信に失敗しました");
    }
});

app.get("/admin-status", async (req, res) => {
    try {
        const context = await getCurrentContext(req);

        return res.json({
            ok: true,
            user: {
                uid: context.uid,
                email: context.email,
                name: context.name
            },
            isAdminAccount: context.isAdminAccount,
            adminAccount: context.adminAccount,
            adminMode: context.adminMode,
            session: publicSession(context.session)
        });
    } catch (err) {
        return sendError(res, err, "管理者状態の取得に失敗しました");
    }
});

app.post("/admin-auth", async (req, res) => {
    try {
        const context = await requireAdminAccount(req);
        const targetUser = await findUserByEmail(req.body.email);
        const targetAdminAccount = await getAdminAccountByEmail(targetUser.email);

        if (targetAdminAccount) {
            const error = new Error("管理者モードは普通アカウントにのみ付与できます");
            error.status = 400;
            throw error;
        }

        const duration = validateAdminModeDuration(
            context.adminAccount.adminModeDurationMinutes ||
            DEFAULT_ADMIN_MODE_MINUTES
        );
        const now = Date.now();
        const expiresAt = now + duration * 60 * 1000;

        await db.collection("adminSessions").doc(targetUser.uid).set(
            {
                uid: targetUser.uid,
                email: targetUser.email,
                userName: targetUser.name,
                active: true,
                createdAt: now,
                expiresAt,
                approvedByUid: context.uid,
                approvedByEmail: context.email,
                approvedByName: context.name,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
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
                approvedByUid: context.uid,
                approvedByEmail: context.email,
                approvedByName: context.name
            }
        });
    } catch (err) {
        return sendError(res, err, "管理者モードの承認に失敗しました");
    }
});

app.post("/admin-logout", async (req, res) => {
    try {
        const context = await getCurrentContext(req);
        await finishAdminSession(context.uid, "本人による終了", context);

        return res.json({
            ok: true,
            adminMode: false,
            message: "管理者モードを終了しました"
        });
    } catch (err) {
        return sendError(res, err, "管理者モードの終了に失敗しました");
    }
});

app.get("/admin-accounts", async (req, res) => {
    try {
        await requireAdminAccount(req);
        const accounts = await getActiveAdminAccounts();

        return res.json({
            ok: true,
            accounts: accounts.sort((a, b) => a.email.localeCompare(b.email))
        });
    } catch (err) {
        return sendError(res, err, "管理者アカウント一覧の取得に失敗しました");
    }
});

app.post("/admin-accounts", async (req, res) => {
    try {
        const context = await requireAdminAccount(req);
        const targetUser = await findUserByEmail(req.body.email);
        const duration = req.body.adminModeDurationMinutes === undefined
            ? DEFAULT_ADMIN_MODE_MINUTES
            : validateAdminModeDuration(req.body.adminModeDurationMinutes);
        const accountRef = db.collection("adminAccounts").doc(targetUser.email);
        const existingSnap = await accountRef.get();
        const isExistingActive =
            existingSnap.exists &&
            existingSnap.data().active === true;
        let historyId = existingSnap.exists
            ? existingSnap.data().historyId || ""
            : "";

        if (!isExistingActive) {
            const historyRef = await db.collection("adminAccountHistory").add({
                userUid: targetUser.uid,
                userEmail: targetUser.email,
                userName: targetUser.name,
                approvedByUid: context.uid,
                approvedByEmail: context.email,
                approvedByName: context.name,
                adminStartedAt: Date.now(),
                adminEndedAt: null,
                endedApprovedByUid: "",
                endedApprovedByEmail: "",
                endedApprovedByName: "",
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            historyId = historyRef.id;
        }

        await accountRef.set(
            {
                email: targetUser.email,
                uid: targetUser.uid,
                name: targetUser.name,
                active: true,
                createdBy: context.uid,
                createdByEmail: context.email,
                createdByName: context.name,
                createdAt: isExistingActive
                    ? existingSnap.data().createdAt || admin.firestore.FieldValue.serverTimestamp()
                    : admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                adminModeDurationMinutes: duration,
                historyId
            },
            { merge: true }
        );

        return res.json({
            ok: true,
            account: publicAccount((await accountRef.get()).data())
        });
    } catch (err) {
        return sendError(res, err, "管理者アカウント追加に失敗しました");
    }
});

app.patch("/admin-accounts/me/duration", async (req, res) => {
    try {
        const context = await requireAdminAccount(req);
        const duration = validateAdminModeDuration(req.body.adminModeDurationMinutes);
        const ref = db.collection("adminAccounts").doc(context.email);
        const snap = await ref.get();

        if (!snap.exists && context.adminAccount?.createdBy === "LUNAGS_ADMIN_EMAILS") {
            await ref.set({
                email: context.email,
                uid: context.uid,
                name: context.name,
                active: true,
                createdBy: "LUNAGS_ADMIN_EMAILS",
                createdByEmail: "LUNAGS_ADMIN_EMAILS",
                createdByName: "初期管理者",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                adminModeDurationMinutes: duration
            });

            return res.json({
                ok: true,
                adminModeDurationMinutes: duration
            });
        }

        if (!snap.exists) {
            const error = new Error("Firestoreの管理者アカウントが見つかりません");
            error.status = 404;
            throw error;
        }

        await ref.set(
            {
                adminModeDurationMinutes: duration,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
        );

        return res.json({
            ok: true,
            adminModeDurationMinutes: duration
        });
    } catch (err) {
        return sendError(res, err, "管理者モード時間の更新に失敗しました");
    }
});

app.post("/admin-approve-email", async (req, res) => {
    try {
        const context = await requireAdminAccountOrMode(req);
        const targetEmail = normalizeEmail(req.body.email);

        if (!targetEmail) {
            const error = new Error("メールアドレスが指定されていません");
            error.status = 400;
            throw error;
        }

        const approvalId = crypto.randomBytes(32).toString("hex");
        const now = Date.now();
        const expiresAt = now + ADMIN_APPROVAL_EXPIRE_MS;

        await db.collection("adminApprovals").doc(approvalId).set({
            email: targetEmail,
            approvedByUid: context.uid,
            approvedBy: context.email,
            approvedByEmail: context.email,
            approvedByName: context.name,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt,
            used: false
        });

        return res.json({
            ok: true,
            approvalId,
            expiresAt
        });
    } catch (err) {
        return sendError(res, err, "メールアドレスの承認に失敗しました");
    }
});

app.post("/admin-approvals/consume", async (req, res) => {
    try {
        const targetEmail = normalizeEmail(req.body.email);
        const name = String(req.body.name || "").trim();

        if (!targetEmail) {
            const error = new Error("メールアドレスが指定されていません");
            error.status = 400;
            throw error;
        }

        const approvalsSnap = await db
            .collection("adminApprovals")
            .where("email", "==", targetEmail)
            .where("used", "==", false)
            .limit(20)
            .get();

        if (approvalsSnap.empty) {
            return res.json({
                ok: true,
                approved: false
            });
        }

        const approvalDoc = approvalsSnap.docs
            .map((doc) => ({
                doc,
                expiresAt: Number(doc.data().expiresAt) || 0
            }))
            .filter((entry) => entry.expiresAt > Date.now())
            .sort((a, b) => b.expiresAt - a.expiresAt)[0]?.doc;

        if (!approvalDoc) {
            return res.json({
                ok: true,
                approved: false
            });
        }

        const approval = approvalDoc.data();

        if (Number(approval.expiresAt) <= Date.now()) {
            return res.json({
                ok: true,
                approved: false
            });
        }

        await db.runTransaction(async (transaction) => {
            const freshApprovalSnap = await transaction.get(approvalDoc.ref);

            if (
                !freshApprovalSnap.exists ||
                freshApprovalSnap.data().used === true ||
                Number(freshApprovalSnap.data().expiresAt) <= Date.now()
            ) {
                const error = new Error("承認が無効です");
                error.status = 409;
                throw error;
            }

            transaction.set(
                db.collection("emailVerifications").doc(targetEmail),
                {
                    name,
                    email: targetEmail,
                    verified: true,
                    verifiedAt: Date.now(),
                    expiresAt: Date.now() + ADMIN_APPROVAL_EXPIRE_MS,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    approvedByAdmin: true,
                    approvedByUid: freshApprovalSnap.data().approvedByUid || "",
                    approvedByEmail: freshApprovalSnap.data().approvedByEmail || "",
                    approvedByName: freshApprovalSnap.data().approvedByName || ""
                },
                { merge: true }
            );

            transaction.set(
                approvalDoc.ref,
                {
                    used: true,
                    usedAt: admin.firestore.FieldValue.serverTimestamp()
                },
                { merge: true }
            );
        });

        return res.json({
            ok: true,
            approved: true
        });
    } catch (err) {
        return sendError(res, err, "管理者メール承認の確認に失敗しました");
    }
});

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
            const expiresAt = timestampMillis(session.expiresAt) || Number(session.expiresAt);

            if (expiresAt && expiresAt <= Date.now()) {
                await finishAdminSession(doc.id, "期限切れ");
            } else {
                sessions.push(publicSession(session));
            }
        }

        return res.json({
            ok: true,
            sessions
        });
    } catch (err) {
        return sendError(res, err, "管理者モード一覧の取得に失敗しました");
    }
});

app.post("/admin-sessions/:uid/terminate", async (req, res) => {
    try {
        const context = await requireAdminAccount(req);
        await finishAdminSession(req.params.uid, "管理者による削除", context);

        return res.json({ ok: true });
    } catch (err) {
        return sendError(res, err, "管理者モード終了に失敗しました");
    }
});

app.post("/admin-sessions/terminate-all", async (req, res) => {
    try {
        const context = await requireAdminAccount(req);
        const snap = await db
            .collection("adminSessions")
            .where("active", "==", true)
            .get();
        let terminated = 0;

        for (const doc of snap.docs) {
            const didTerminate = await finishAdminSession(
                doc.id,
                "一斉終了",
                context
            );
            if (didTerminate) terminated += 1;
        }

        return res.json({
            ok: true,
            terminated
        });
    } catch (err) {
        return sendError(res, err, "管理者モード一斉終了に失敗しました");
    }
});

app.get("/admin-mode-history", async (req, res) => {
    try {
        await requireAdminAccount(req);
        const snap = await db
            .collection("adminModeHistory")
            .orderBy("endedAt", "desc")
            .limit(100)
            .get();

        return res.json({
            ok: true,
            history: snap.docs.map(publicHistory)
        });
    } catch (err) {
        return sendError(res, err, "管理者モード履歴の取得に失敗しました");
    }
});

app.get("/admin-account-history", async (req, res) => {
    try {
        await requireAdminAccount(req);
        const snap = await db
            .collection("adminAccountHistory")
            .orderBy("createdAt", "desc")
            .limit(100)
            .get();

        return res.json({
            ok: true,
            history: snap.docs.map(publicHistory)
        });
    } catch (err) {
        return sendError(res, err, "管理者アカウント履歴の取得に失敗しました");
    }
});

app.get("/admin-demotion-requests", async (req, res) => {
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
            requests: snap.docs.map(publicHistory)
        });
    } catch (err) {
        return sendError(res, err, "降格申請一覧の取得に失敗しました");
    }
});

app.post("/admin-demotion-requests", async (req, res) => {
    try {
        const context = await requireAdminAccount(req);
        const target = await findUserByEmail(req.body.targetEmail || req.body.email);
        const targetAccount = await getAdminAccountByEmail(target.email);

        if (!targetAccount) {
            const error = new Error("対象は管理者アカウントではありません");
            error.status = 400;
            throw error;
        }

        await assertMinimumAdminCountAfterOneRemoval();

        const isSelf = target.email === context.email;
        const requestRef = await db.collection("adminDemotionRequests").add({
            targetUid: target.uid,
            targetEmail: target.email,
            targetName: target.name,
            requestedBy: context.uid,
            requestedByEmail: context.email,
            requestedByName: context.name,
            targetApproved: false,
            requesterConfirmed: false,
            status: isSelf ? "waiting_other_admin_approval" : "waiting_target_approval",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({
            ok: true,
            requestId: requestRef.id
        });
    } catch (err) {
        return sendError(res, err, "降格申請の作成に失敗しました");
    }
});

app.post("/admin-demotion-requests/:id/approve", async (req, res) => {
    try {
        const context = await requireAdminAccount(req);
        const ref = db.collection("adminDemotionRequests").doc(req.params.id);
        const snap = await ref.get();

        if (!snap.exists) {
            const error = new Error("降格申請が見つかりません");
            error.status = 404;
            throw error;
        }

        const request = snap.data();
        const isSelfRequest = request.targetEmail === request.requestedByEmail;
        const canApproveOtherRequest = request.targetEmail === context.email;
        const canApproveSelfRequest =
            isSelfRequest &&
            request.targetEmail !== context.email &&
            request.requestedByEmail !== context.email;

        if (!canApproveOtherRequest && !canApproveSelfRequest) {
            const error = new Error("この降格申請を承認できません");
            error.status = 403;
            throw error;
        }

        await assertMinimumAdminCountAfterOneRemoval();

        await ref.set(
            {
                targetApproved: true,
                approvedByUid: context.uid,
                approvedByEmail: context.email,
                approvedByName: context.name,
                status: "waiting_requester_confirm",
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
        );

        return res.json({ ok: true });
    } catch (err) {
        return sendError(res, err, "降格申請の承認に失敗しました");
    }
});

app.post("/admin-demotion-requests/:id/confirm", async (req, res) => {
    try {
        const context = await requireAdminAccount(req);
        const ref = db.collection("adminDemotionRequests").doc(req.params.id);
        let completedRequest = null;
        let removedAccount = null;
        let historyId = "";

        await db.runTransaction(async (transaction) => {
            const snap = await transaction.get(ref);

            if (!snap.exists) {
                const error = new Error("降格申請が見つかりません");
                error.status = 404;
                throw error;
            }

            const request = snap.data();

            if (request.requestedByEmail !== context.email) {
                const error = new Error("申請者だけが最終確定できます");
                error.status = 403;
                throw error;
            }

            if (!request.targetApproved) {
                const error = new Error("対象管理者の承認が完了していません");
                error.status = 409;
                throw error;
            }

            const accountsSnap = await transaction.get(
                db.collection("adminAccounts").where("active", "==", true)
            );

            if (accountsSnap.size - 1 < 2) {
                const error = new Error("有効な管理者アカウントは2人以上必要です");
                error.status = 409;
                throw error;
            }

            const targetRef = db.collection("adminAccounts").doc(request.targetEmail);
            const targetSnap = await transaction.get(targetRef);

            if (!targetSnap.exists || targetSnap.data().active !== true) {
                const error = new Error("対象の管理者アカウントが見つかりません");
                error.status = 404;
                throw error;
            }

            completedRequest = request;
            removedAccount = targetSnap.data();
            historyId = removedAccount.historyId || "";

            transaction.set(
                targetRef,
                {
                    active: false,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    endedApprovedByUid: context.uid,
                    endedApprovedByEmail: context.email,
                    endedApprovedByName: context.name
                },
                { merge: true }
            );

            transaction.set(
                ref,
                {
                    requesterConfirmed: true,
                    status: "completed",
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                },
                { merge: true }
            );
        });

        const historyPatch = {
            adminEndedAt: Date.now(),
            endedApprovedByUid: context.uid,
            endedApprovedByEmail: context.email,
            endedApprovedByName: context.name,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (historyId) {
            await db.collection("adminAccountHistory").doc(historyId).set(
                historyPatch,
                { merge: true }
            );
        } else {
            await db.collection("adminAccountHistory").add({
                userUid: completedRequest.targetUid || removedAccount.uid || "",
                userEmail: completedRequest.targetEmail,
                userName: completedRequest.targetName || removedAccount.name || "",
                approvedByUid: removedAccount.createdBy || "",
                approvedByEmail: removedAccount.createdByEmail || "",
                approvedByName: removedAccount.createdByName || "",
                adminStartedAt: timestampMillis(removedAccount.createdAt) || null,
                ...historyPatch,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        return res.json({ ok: true });
    } catch (err) {
        return sendError(res, err, "降格申請の確定に失敗しました");
    }
});

async function deleteExpiredHistory() {
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    const collections = [
        { name: "adminModeHistory", field: "endedAt" },
        { name: "adminAccountHistory", field: "adminEndedAt" }
    ];
    let deleted = 0;

    for (const collection of collections) {
        const snap = await db
            .collection(collection.name)
            .where(collection.field, "<", cutoff)
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

export const cleanupAdminHistory = onSchedule(
    {
        schedule: "0 11 * * *",
        timeZone: "Asia/Tokyo"
    },
    async () => {
        const deleted = await deleteExpiredHistory();
        console.log(`Deleted admin history documents: ${deleted}`);
    }
);

export const send = onRequest(
    {
        invoker: "public",
        secrets: [
            LUNAGS_ADMIN_EMAILS
        ],
        cors: [
            "https://lunags-development.web.app",
            "https://lunags-production.web.app",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://localhost:5174",
            "http://127.0.0.1:5174"
        ]
    },
    app
);
