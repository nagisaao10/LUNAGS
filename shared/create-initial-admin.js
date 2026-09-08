const {
    initializeApp,
    applicationDefault
} = require("firebase-admin/app");

const {
    getAuth
} = require("firebase-admin/auth");

const {
    getFirestore,
    Timestamp
} = require("firebase-admin/firestore");

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DEFAULT_ADMIN_MODE_MINUTES = 30;

const ROLES = [
    "代表",
    "マネージャー",
    "メンバー",
    "ゲスト",
    "スタッフ"
];

/*
 * ========================================
 * Firebase Project ID
 * ========================================
 */

function getFirebaseProjectId() {
    try {
        const firebasercPath = path.join(
            __dirname,
            "..",
            ".firebaserc"
        );

        if (!fs.existsSync(firebasercPath)) {
            throw new Error(
                ".firebaserc が見つかりません。"
            );
        }

        const config = JSON.parse(
            fs.readFileSync(
                firebasercPath,
                "utf8"
            )
        );

        const projectId =
            config?.projects?.default;

        if (!projectId) {
            throw new Error(
                ".firebaserc にdefaultプロジェクトが設定されていません。"
            );
        }

        return projectId.trim();
    } catch (error) {
        console.error("");
        console.error(
            "Firebaseプロジェクトの取得に失敗しました。"
        );
        console.error(error);
        process.exit(1);
    }
}

/*
 * ========================================
 * readline
 * ========================================
 */

function createReadline() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

function question(rl, text) {
    return new Promise((resolve) => {
        rl.question(text, (answer) => {
            resolve(answer.trim());
        });
    });
}

/*
 * ========================================
 * Yes / No
 * ========================================
 *
 * 空入力 = Yes
 */

function isYes(answer) {
    return (
        !answer ||
        ["y", "yes"].includes(
            answer.toLowerCase()
        )
    );
}

/*
 * ========================================
 * Email
 * ========================================
 */

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
    );
}

/*
 * ========================================
 * Birthday
 * ========================================
 *
 * YYYY/MM/DD
 */

function isValidBirthday(value) {
    const match =
        /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(
            value
        );

    if (!match) {
        return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (
        year < 1900 ||
        year > 2100
    ) {
        return false;
    }

    if (
        month < 1 ||
        month > 12
    ) {
        return false;
    }

    const date = new Date(
        year,
        month - 1,
        day
    );

    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
}

/*
 * ========================================
 * LUNAGS User ID
 *
 * U + 英数字7文字
 * ========================================
 */

function generateUserId() {
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    const bytes =
        crypto.randomBytes(7);

    let userId = "U";

    for (let i = 0; i < 7; i++) {
        userId +=
            chars[bytes[i] % chars.length];
    }

    return userId;
}

async function generateUniqueUserId(db) {
    while (true) {
        const userId =
            generateUserId();

        const userSnap =
            await db
                .collection("users")
                .doc(userId)
                .get();

        if (!userSnap.exists) {
            return userId;
        }
    }
}

/*
 * ========================================
 * 既存LUNAGSユーザー取得
 *
 * Firebase UID
 *      ↓
 * uidMap
 *      ↓
 * LUNAGS User ID
 * ========================================
 */

async function getExistingLunagsUser(
    db,
    uid
) {
    const uidMapRef =
        db
            .collection("uidMap")
            .doc(uid);

    const uidMapSnap =
        await uidMapRef.get();

    if (!uidMapSnap.exists) {
        return null;
    }

    const data =
        uidMapSnap.data();

    const userId =
        data?.userId;

    if (
        typeof userId !== "string" ||
        !userId.trim()
    ) {
        throw new Error(
            "既存のuidMapに有効なuserIdが設定されていません。"
        );
    }

    const userRef =
        db
            .collection("users")
            .doc(userId);

    const userSnap =
        await userRef.get();

    if (!userSnap.exists) {
        throw new Error(
            `uidMapは存在しますが users/${userId} が存在しません。`
        );
    }

    return {
        userId,
        userRef,
        uidMapRef,
        userData: userSnap.data()
    };
}

/*
 * ========================================
 * LUNAGSユーザー作成準備
 * ========================================
 */

async function getOrCreateLunagsUser(
    db,
    uid
) {
    const existing =
        await getExistingLunagsUser(
            db,
            uid
        );

    if (existing) {
        return {
            ...existing,
            isNew: false
        };
    }

    const userId =
        await generateUniqueUserId(db);

    return {
        userId,

        userRef:
            db
                .collection("users")
                .doc(userId),

        uidMapRef:
            db
                .collection("uidMap")
                .doc(uid),

        userData: {},

        isNew: true
    };
}

/*
 * ========================================
 * 性別
 * ========================================
 */

function getGenderFromInput(input) {
    const genderMap = {
        "1": "男性",
        "2": "女性",
        "3": "その他",
        "4": "回答しない"
    };

    return genderMap[input] || null;
}

/*
 * ========================================
 * Role
 * ========================================
 */

function getRoleFromInput(input) {
    const index =
        Number(input) - 1;

    if (
        !Number.isInteger(index) ||
        !ROLES[index]
    ) {
        return null;
    }

    return ROLES[index];
}

/*
 * ========================================
 * 初期管理者登録
 * ========================================
 */

async function createInitialAdmin() {
    const projectId =
        getFirebaseProjectId();

    console.log("");
    console.log(
        "========================================"
    );
    console.log(
        "LUNAGS 初期管理者登録"
    );
    console.log(
        "========================================"
    );
    console.log(
        `Firebase Project: ${projectId}`
    );
    console.log("");

    const rl =
        createReadline();

    try {
        /*
         * ====================================
         * Firebase初期化
         * ====================================
         */

        initializeApp({
            credential:
                applicationDefault(),
            projectId
        });

        const auth =
            getAuth();

        const db =
            getFirestore();

        /*
         * ====================================
         * メールアドレス
         * ====================================
         */

        const emailInput =
            await question(
                rl,
                "管理者にするメールアドレスを入力してください: "
            );

        const email =
            emailInput
                .trim()
                .toLowerCase();

        if (!email) {
            throw new Error(
                "メールアドレスが入力されていません。"
            );
        }

        if (!isValidEmail(email)) {
            throw new Error(
                "メールアドレスの形式が正しくありません。"
            );
        }

        /*
         * ====================================
         * Firebase Authentication確認
         * ====================================
         */

        let user = null;
        let isExistingUser = false;

        try {
            user =
                await auth.getUserByEmail(
                    email
                );

            isExistingUser = true;
        } catch (error) {
            if (
                error.code !==
                "auth/user-not-found"
            ) {
                throw error;
            }
        }

        /*
         * ====================================
         * 名前
         * ====================================
         */

        const name =
            await question(
                rl,
                "名前を入力してください: "
            );

        if (!name) {
            throw new Error(
                "名前が入力されていません。"
            );
        }

        /*
         * ====================================
         * 表示名
         * ====================================
         */

        const displayName =
            await question(
                rl,
                "表示名を入力してください: "
            );

        if (!displayName) {
            throw new Error(
                "表示名が入力されていません。"
            );
        }

        /*
         * ====================================
         * 生年月日
         * ====================================
         */

        let birthday = "";

        while (!birthday) {
            const input =
                await question(
                    rl,
                    "生年月日を入力してください (YYYY/MM/DD): "
                );

            if (
                isValidBirthday(input)
            ) {
                birthday = input;
            } else {
                console.error("");
                console.error(
                    "生年月日の形式が正しくありません。"
                );
                console.error(
                    "例: 2000/01/01"
                );
                console.error("");
            }
        }

        /*
         * ====================================
         * 性別
         * ====================================
         */

        console.log("");
        console.log(
            "性別を選択してください。"
        );
        console.log(
            "1. 男性"
        );
        console.log(
            "2. 女性"
        );
        console.log(
            "3. その他"
        );
        console.log(
            "4. 回答しない"
        );

        const genderInput =
            await question(
                rl,
                "番号: "
            );

        const gender =
            getGenderFromInput(
                genderInput
            );

        if (!gender) {
            throw new Error(
                "正しい性別番号を選択してください。"
            );
        }

        /*
         * ====================================
         * 国と地域
         * ====================================
         */

        const country =
            await question(
                rl,
                "国と地域を入力してください: "
            );

        if (!country) {
            throw new Error(
                "国と地域が入力されていません。"
            );
        }

        /*
         * ====================================
         * 住所
         * ====================================
         */

        const address =
            await question(
                rl,
                "住所を入力してください: "
            );

        if (!address) {
            throw new Error(
                "住所が入力されていません。"
            );
        }

        /*
         * ====================================
         * 電話番号
         * ====================================
         */

        const phone =
            await question(
                rl,
                "電話番号を入力してください: "
            );

        if (!phone) {
            throw new Error(
                "電話番号が入力されていません。"
            );
        }

        /*
         * ====================================
         * Role
         * ====================================
         */

        console.log("");
        console.log(
            "役職を選択してください。"
        );

        ROLES.forEach(
            (role, index) => {
                console.log(
                    `${index + 1}. ${role}`
                );
            }
        );

        const roleInput =
            await question(
                rl,
                "番号: "
            );

        const role =
            getRoleFromInput(
                roleInput
            );

        if (!role) {
            throw new Error(
                "正しい役職番号を選択してください。"
            );
        }

        /*
         * ====================================
         * 既存ユーザー
         * ====================================
         */

        if (isExistingUser) {
            console.log("");
            console.log(
                "Firebase Authenticationに既存ユーザーが見つかりました。"
            );
            console.log("");
            console.log(
                `  UID: ${user.uid}`
            );
            console.log(
                `  Email: ${user.email}`
            );
            console.log(
                `  Name: ${user.displayName ||
                "(未設定)"
                }`
            );
            console.log("");

            const answer =
                await question(
                    rl,
                    "このユーザーを管理者アカウントに昇格しますか？ [Y/n]: "
                );

            if (!isYes(answer)) {
                console.log("");
                console.log(
                    "処理をキャンセルしました。"
                );
                return;
            }

            /*
             * 既存ユーザーも管理者登録時に
             * displayNameを同期
             */

            user =
                await auth.updateUser(
                    user.uid,
                    {
                        displayName
                    }
                );
        }

        /*
         * ====================================
         * 新規Authenticationユーザー
         * ====================================
         */

        if (!isExistingUser) {
            console.log("");
            console.log(
                "Firebase Authenticationに対象ユーザーが存在しません。"
            );
            console.log("");

            const answer =
                await question(
                    rl,
                    "このメールアドレスで新規ユーザーを作成しますか？ [Y/n]: "
                );

            if (!isYes(answer)) {
                console.log("");
                console.log(
                    "処理をキャンセルしました。"
                );
                return;
            }

            console.log("");
            console.log(
                "新規ユーザーのパスワードを入力してください。"
            );
            console.log(
                "※ Firebase Authenticationのパスワードとして使用されます。"
            );
            console.log("");

            const password =
                await question(
                    rl,
                    "パスワード: "
                );

            if (!password) {
                throw new Error(
                    "パスワードが入力されていません。"
                );
            }

            if (password.length < 6) {
                throw new Error(
                    "パスワードは6文字以上にしてください。"
                );
            }

            user =
                await auth.createUser({
                    email,
                    password,
                    displayName,
                    emailVerified: true
                });

            console.log("");
            console.log(
                "Firebase Authenticationユーザーを新規作成しました。"
            );
            console.log(
                `  UID: ${user.uid}`
            );
            console.log(
                `  Email: ${user.email}`
            );
            console.log("");
        }

        /*
         * ====================================
         * メール確認済みに統一
         * ====================================
         *
         * 初期管理者登録では
         * verify.htmlを通す必要がない。
         */

        if (!user.emailVerified) {
            user =
                await auth.updateUser(
                    user.uid,
                    {
                        emailVerified: true
                    }
                );
        }

        /*
         * ====================================
         * LUNAGS User ID
         * ====================================
         */

        console.log("");
        console.log(
            "LUNAGSユーザー情報を確認しています..."
        );

        const lunagsUser =
            await getOrCreateLunagsUser(
                db,
                user.uid
            );

        const userId =
            lunagsUser.userId;

        const userRef =
            lunagsUser.userRef;

        const uidMapRef =
            lunagsUser.uidMapRef;

        const existingUserData =
            lunagsUser.userData || {};

        console.log(
            `LUNAGS User ID: ${userId}`
        );

        /*
         * ====================================
         * Firestoreデータ
         * ====================================
         */

        const now =
            Timestamp.now();

        const userData = {
            uid: user.uid,

            userId,

            name,
            displayName,

            email,

            birthday,
            gender,

            country,
            address,
            phone,

            role,

            createdAt:
                existingUserData.createdAt ||
                now,

            updatedAt: now
        };

        /*
         * ====================================
         * Firestore Batch
         *
         * users
         * uidMap
         * を同時に更新
         * ====================================
         */

        const batch =
            db.batch();

        batch.set(
            userRef,
            userData,
            {
                merge: true
            }
        );

        batch.set(
            uidMapRef,
            {
                userId
            },
            {
                merge: true
            }
        );

        await batch.commit();

        console.log("");
        console.log(
            `users/${userId} を作成・更新しました。`
        );
        console.log(
            `uidMap/${user.uid} を作成・更新しました。`
        );

        /*
         * ====================================
         * adminAccounts
         * ====================================
         */

        const accountRef =
            db
                .collection("adminAccounts")
                .doc(email);

        const existingAdminSnap =
            await accountRef.get();

        const existingAdminData =
            existingAdminSnap.exists
                ? existingAdminSnap.data()
                : {};

        /*
         * UID不一致防止
         */

        if (
            existingAdminData.uid &&
            existingAdminData.uid !==
            user.uid
        ) {
            throw new Error(
                [
                    "既存の管理者アカウントとFirebase AuthenticationのUIDが一致しません。",
                    `Firestore UID: ${existingAdminData.uid}`,
                    `Auth UID:      ${user.uid}`
                ].join("\n")
            );
        }

        /*
         * 既存の管理者モード時間を維持
         */

        const duration =
            Number.isFinite(
                existingAdminData.adminModeDurationMinutes
            )
                ? existingAdminData.adminModeDurationMinutes
                : DEFAULT_ADMIN_MODE_MINUTES;

        /*
         * ====================================
         * 管理者アカウント登録
         * ====================================
         *
         * 管理者アカウントは恒久的。
         * 管理者モードとは別物。
         */

        await accountRef.set(
            {
                email,

                uid: user.uid,

                userId,

                name,
                displayName,

                active: true,

                createdBy:
                    existingAdminData.createdBy ||
                    user.uid,

                createdByEmail:
                    existingAdminData.createdByEmail ||
                    email,

                createdByName:
                    existingAdminData.createdByName ||
                    displayName,

                createdAt:
                    existingAdminData.createdAt ||
                    now,

                updatedAt: now,

                adminModeDurationMinutes:
                    duration,

                historyId:
                    existingAdminData.historyId ||
                    null
            },
            {
                merge: true
            }
        );

        /*
         * ====================================
         * 最終確認
         * ====================================
         */

        const finalUserSnap =
            await userRef.get();

        const finalUidMapSnap =
            await uidMapRef.get();

        const finalAdminSnap =
            await accountRef.get();

        if (!finalUserSnap.exists) {
            throw new Error(
                `users/${userId} の作成確認に失敗しました。`
            );
        }

        if (!finalUidMapSnap.exists) {
            throw new Error(
                `uidMap/${user.uid} の作成確認に失敗しました。`
            );
        }

        if (!finalAdminSnap.exists) {
            throw new Error(
                `adminAccounts/${email} の作成確認に失敗しました。`
            );
        }

        /*
         * ====================================
         * 完了
         * ====================================
         */

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "初期管理者の登録が完了しました"
        );
        console.log(
            "========================================"
        );
        console.log("");

        console.log(
            `Firebase Project: ${projectId}`
        );
        console.log("");

        console.log(
            "【Firebase Authentication】"
        );
        console.log(
            `Email:          ${email}`
        );
        console.log(
            `UID:            ${user.uid}`
        );
        console.log(
            "Email Verified: true"
        );
        console.log("");

        console.log(
            "【LUNAGS User】"
        );
        console.log(
            `User ID:        ${userId}`
        );
        console.log(
            `Name:           ${name}`
        );
        console.log(
            `Display Name:   ${displayName}`
        );
        console.log(
            `Birthday:       ${birthday}`
        );
        console.log(
            `Gender:         ${gender}`
        );
        console.log(
            `Country:        ${country}`
        );
        console.log(
            `Address:        ${address}`
        );
        console.log(
            `Phone:          ${phone}`
        );
        console.log(
            `Role:            ${role}`
        );
        console.log("");

        console.log(
            "【Firestore】"
        );
        console.log(
            `users/${userId}`
        );
        console.log(
            `uidMap/${user.uid}`
        );
        console.log(
            `adminAccounts/${email}`
        );
        console.log("");

        console.log(
            "管理者アカウント: active = true"
        );
        console.log("");

        console.log(
            "Auth UID → uidMap → LUNAGS User ID → users"
        );
        console.log(
            "の関連付けが完了しています。"
        );
        console.log("");

        if (isExistingUser) {
            console.log(
                "既存のFirebase AuthenticationユーザーをLUNAGS管理者アカウントへ登録しました。"
            );
        } else {
            console.log(
                "新規Firebase Authenticationユーザーを作成し、LUNAGSユーザーとして登録したうえで管理者アカウントに設定しました。"
            );
        }

        console.log("");

    } finally {
        rl.close();
    }
}

/*
 * ========================================
 * 実行
 * ========================================
 */

createInitialAdmin().catch(
    (error) => {
        console.error("");
        console.error(
            "========================================"
        );
        console.error(
            "初期管理者の登録に失敗しました"
        );
        console.error(
            "========================================"
        );
        console.error("");

        console.error(
            error?.message ||
            error
        );

        console.error("");

        process.exit(1);
    }
);