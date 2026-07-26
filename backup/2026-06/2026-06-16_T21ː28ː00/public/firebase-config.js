import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
    getFirestore,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAQLjSjCS-94924MCKEZ5dUa2GBhryM4y8",
    authDomain: "lunags-management-system.firebaseapp.com",
    projectId: "lunags-management-system",
    storageBucket: "lunags-management-system.firebasestorage.app",
    messagingSenderId: "1039501095200",
    appId: "1:1039501095200:web:e13d27026441d9ccf5a745",
    measurementId: "G-QXMSKHVP0Q"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export { serverTimestamp };

export const VERIFICATION_COLLECTION = "emailVerifications";
export const CODE_TTL_MS = 5 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;

export const MAILER_ENDPOINT = "https://send-poqx4aslqa-uc.a.run.app/send";
export const FIREBASE_TIMEOUT_MS = 30000;
export const LOCAL_VERIFICATION_KEY_PREFIX = "verify_";

export function normalizeEmail(email) {
    return email.trim().toLowerCase();
}

export function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sha256(value) {
    if (!globalThis.crypto?.subtle) {
        return sha256Fallback(value);
    }

    const bytes = new TextEncoder().encode(value);
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function sha256Fallback(value) {
    const bytes = new TextEncoder().encode(value);
    const words = [];
    const bitLength = bytes.length * 8;
    const hash = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const constants = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    for (let i = 0; i < bytes.length; i++) {
        words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    }

    words[bitLength >> 5] |= 0x80 << (24 - bitLength % 32);
    words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;

    for (let i = 0; i < words.length; i += 16) {
        const messageSchedule = words.slice(i, i + 16);
        for (let j = 0; j < 16; j++) {
            messageSchedule[j] = messageSchedule[j] || 0;
        }

        let [a, b, c, d, e, f, g, h] = hash;

        for (let j = 0; j < 64; j++) {
            if (j >= 16) {
                const s0 = rightRotate(messageSchedule[j - 15], 7)
                    ^ rightRotate(messageSchedule[j - 15], 18)
                    ^ (messageSchedule[j - 15] >>> 3);
                const s1 = rightRotate(messageSchedule[j - 2], 17)
                    ^ rightRotate(messageSchedule[j - 2], 19)
                    ^ (messageSchedule[j - 2] >>> 10);
                messageSchedule[j] = add32(messageSchedule[j - 16], s0, messageSchedule[j - 7], s1);
            }

            const sum1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temp1 = add32(h, sum1, choice, constants[j], messageSchedule[j]);
            const sum0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = add32(sum0, majority);

            h = g;
            g = f;
            f = e;
            e = add32(d, temp1);
            d = c;
            c = b;
            b = a;
            a = add32(temp1, temp2);
        }

        hash[0] = add32(hash[0], a);
        hash[1] = add32(hash[1], b);
        hash[2] = add32(hash[2], c);
        hash[3] = add32(hash[3], d);
        hash[4] = add32(hash[4], e);
        hash[5] = add32(hash[5], f);
        hash[6] = add32(hash[6], g);
        hash[7] = add32(hash[7], h);
    }

    return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rightRotate(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
}

function add32(...values) {
    return values.reduce((sum, value) => (sum + value) >>> 0, 0);
}

export async function sendVerificationEmail({ email, code, name }) {
    const response = await fetch(MAILER_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            email,
            code,
            name
        })
    });

    console.log("status =", response.status);

    const text = await response.text();
    console.log("response =", text);

    if (!response.ok) {
        throw new Error("メール送信に失敗しました");
    }
}

export function savePendingSignup(signup) {
    localStorage.setItem("pendingSignup", JSON.stringify(signup));
}

export function loadPendingSignup() {
    const raw = localStorage.getItem("pendingSignup");
    return raw ? JSON.parse(raw) : null;
}

export function clearPendingSignup() {
    localStorage.removeItem("pendingSignup");
}

export function saveLocalVerification(email, verification) {
    localStorage.setItem(LOCAL_VERIFICATION_KEY_PREFIX + email, JSON.stringify(verification));
}

export function loadLocalVerification(email) {
    const raw = localStorage.getItem(LOCAL_VERIFICATION_KEY_PREFIX + email);
    return raw ? JSON.parse(raw) : null;
}

export function clearLocalVerification(email) {
    localStorage.removeItem(LOCAL_VERIFICATION_KEY_PREFIX + email);
}

export function withTimeout(
    promise,
    timeoutMessage = "Firebase通信がタイムアウトしました"
) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(timeoutMessage));
            }, FIREBASE_TIMEOUT_MS);
        })
    ]);
}

export function isOfflineDocumentError(error) {
    return error?.message === "Failed to get document because the client is offline."
        || error?.message?.includes("client is offline")
        || error?.message?.includes("Firebase通信がタイムアウトしました")
        || error?.message?.includes("The database (default) does not exist")
        || error?.message?.includes("datastore/setup")
        || error?.code === "failed-precondition"
        || error?.code === "unavailable";
}

export function getFriendlyErrorMessage(
    error,
    fallbackMessage = "エラーが発生しました"
) {

    // Firebase Auth エラー
    switch (error?.code) {

        case "auth/invalid-email":
            return "メールアドレスの形式が正しくありません";

        case "auth/email-already-in-use":
            return "このメールアドレスは既に登録されています";

        case "auth/weak-password":
            return "パスワードは6文字以上にしてください";

        case "auth/user-not-found":
            return "アカウントが見つかりません";

        case "auth/wrong-password":
            return "パスワードが違います";

        case "auth/too-many-requests":
            return "アクセス回数が多すぎます\nしばらく待ってからお試しください";

        case "auth/network-request-failed":
            return "ネットワーク接続を確認してください";

    }

    // Firestore系
    if (isOfflineDocumentError(error)) {

        if (
            error?.message?.includes(
                "The database (default) does not exist"
            )
        ) {
            return "Firestore データベースが未作成です";
        }
        return "Firebaseに接続できませんでした";
    }

    // fetch失敗
    if (error?.message?.includes("Failed to fetch")) {

        return `
メールサーバーに接続できませんでした\n時間をおいてからもう一度お試しください
        `;
    }

    return error?.message || fallbackMessage;
}