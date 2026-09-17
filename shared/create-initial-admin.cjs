const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const readline = require("readline");
const { createRequire } = require("module");

const requireFromFunctions = createRequire(
    path.resolve(
        __dirname,
        "../functions/package.json"
    )
);

const {
    initializeApp,
    applicationDefault
} = requireFromFunctions(
    "firebase-admin/app"
);

const {
    getAuth
} = requireFromFunctions(
    "firebase-admin/auth"
);

const {
    getFirestore,
    Timestamp
} = requireFromFunctions(
    "firebase-admin/firestore"
);

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

        const snap =
            await db
                .collection("users")
                .doc(userId)
                .get();

        if (!snap.exists) {
            return userId;
        }
    }
}

/*
 * ========================================
 * Gender
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
 * 既存LUNAGSユーザー取得
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
 * LUNAGSユーザー取得または作成
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
        " LUNAGS 初期管理者登録"
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
                "管理者にするメールアドレス: "
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
         * Authentication検索
         * ====================================
         */

        let user = null;

        try {
            user =
                await auth.getUserByEmail(
                    email
                );
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
         * 既存アカウント
         * ====================================
         */

        if (user) {
            console.log("");
            console.log(
                "既存のFirebase Authenticationアカウントが見つかりました。"
            );
            console.log("");
            console.log(
                `UID:   ${user.uid}`
            );
            console.log(
                `Email: ${user.email}`
            );
            console.log("");

            /*
             * 既存ユーザーはそのまま昇格
             */

            console.log(
                "既存アカウントを管理者へ昇格します。"
            );

            /*
             * ====================================
             * LUNAGSユーザー取得
             * ====================================
             */

            const lunagsUser =
                await getOrCreateLunagsUser(
                    db,
                    user.uid
                );

            let userId =
                lunagsUser.userId;

            let userData =
                lunagsUser.userData || {};

            /*
             * ====================================
             * LUNAGSユーザーが存在しない場合
             * ====================================
             *
             * 既存Authアカウントでも、
             * LUNAGS側のユーザーがなければ
             * 最低限のユーザー情報を作成する。
             */

            if (lunagsUser.isNew) {
                console.log("");
                console.log(
                    "LUNAGSユーザー情報が存在しません。"
                );
                console.log(
                    "既存AuthenticationアカウントをLUNAGSユーザーとして登録します。"
                );
                console.log("");

                const name =
                    user.displayName ||
                    email.split("@")[0];

                const now =
                    Timestamp.now();

                const batch =
                    db.batch();

                batch.set(
                    lunagsUser.userRef,
                    {
                        uid: user.uid,
                        userId,

                        name,
                        displayName:
                            user.displayName ||
                            name,

                        email,

                        role: "代表",

                        adminAccount: true,

                        createdAt: now,
                        updatedAt: now
                    },
                    {
                        merge: true
                    }
                );

                batch.set(
                    lunagsUser.uidMapRef,
                    {
                        userId
                    },
                    {
                        merge: true
                    }
                );

                await batch.commit();

                userData = {
                    ...userData,
                    name,
                    displayName:
                        user.displayName ||
                        name,
                    email
                };
            }

            const now = Timestamp.now();

            await lunagsUser.userRef.set(
                {
                    adminAccount: true,
                    updatedAt: now
                },
                {
                    merge: true
                }
            );

            /*
             * ====================================
             * Email Verified
             * ====================================
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
             * 管理者アカウント
             * ====================================
             */

            const accountRef =
                db
                    .collection("adminAccount")
                    .doc(email);

            const existingAdminSnap =
                await accountRef.get();

            const existingAdminData =
                existingAdminSnap.exists
                    ? existingAdminSnap.data()
                    : {};

            const duration =
                Number.isFinite(
                    existingAdminData
                        .adminModeDurationMinutes
                )
                    ? existingAdminData
                        .adminModeDurationMinutes
                    : DEFAULT_ADMIN_MODE_MINUTES;

            await accountRef.set(
                {
                    email,
                    uid: user.uid,
                    userId,

                    name:
                        userData.name ||
                        user.displayName ||
                        email,

                    displayName:
                        userData.displayName ||
                        user.displayName ||
                        email,

                    active: true,

                    createdBy:
                        existingAdminData.createdBy ||
                        user.uid,

                    createdByEmail:
                        existingAdminData.createdByEmail ||
                        email,

                    createdByName:
                        existingAdminData.createdByName ||
                        user.displayName ||
                        email,

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

            await lunagsUser.userRef.set(
                {
                    adminAccount: true,
                    updatedAt: Timestamp.now()
                },
                {
                    merge: true
                }
            );

            console.log("");
            console.log(
                "既存アカウントの管理者昇格が完了しました。"
            );
            console.log("");

            printCompleteInfo(
                projectId,
                user,
                userId,
                userData,
                true
            );

            return;
        }

        /*
         * ====================================
         * 新規アカウント
         * ====================================
         */

        console.log("");
        console.log(
            "Firebase Authenticationにアカウントが存在しません。"
        );
        console.log(
            "新規管理者アカウントを作成します。"
        );
        console.log("");

        /*
         * ====================================
         * 新規登録情報
         * ====================================
         */

        const name =
            await question(
                rl,
                "名前: "
            );

        if (!name) {
            throw new Error(
                "名前が入力されていません。"
            );
        }

        const displayName =
            await question(
                rl,
                "表示名: "
            );

        if (!displayName) {
            throw new Error(
                "表示名が入力されていません。"
            );
        }

        /*
         * ====================================
         * Birthday
         * ====================================
         */

        let birthday = "";

        while (!birthday) {
            const input =
                await question(
                    rl,
                    "生年月日 (YYYY/MM/DD): "
                );

            if (
                isValidBirthday(input)
            ) {
                birthday = input;
            } else {
                console.log(
                    "生年月日の形式が正しくありません。"
                );
            }
        }

        /*
         * ====================================
         * Gender
         * ====================================
         */

        console.log("");
        console.log("性別:");
        console.log("1. 男性");
        console.log("2. 女性");
        console.log("3. その他");
        console.log("4. 回答しない");

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
         * Country
         * ====================================
         */

        const country =
            await question(
                rl,
                "国と地域: "
            );

        if (!country) {
            throw new Error(
                "国と地域が入力されていません。"
            );
        }

        /*
         * ====================================
         * Address
         * ====================================
         */

        const address =
            await question(
                rl,
                "住所: "
            );

        if (!address) {
            throw new Error(
                "住所が入力されていません。"
            );
        }

        /*
         * ====================================
         * Phone
         * ====================================
         */

        const phone =
            await question(
                rl,
                "電話番号: "
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
        console.log("役職:");

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
         * Password
         * ====================================
         */

        console.log("");
        console.log(
            "Firebase Authenticationのパスワードを設定します。"
        );

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

        /*
         * ====================================
         * Firebase Authentication作成
         * ====================================
         */

        user =
            await auth.createUser({
                email,
                password,
                displayName,

                /*
                 * 初期管理者なので
                 * メール確認済みとして扱う。
                 */
                emailVerified: true
            });

        console.log("");
        console.log(
            "Firebase Authenticationアカウントを作成しました。"
        );
        console.log(
            `UID: ${user.uid}`
        );

        /*
         * ====================================
         * LUNAGS User ID
         * ====================================
         */

        const userId =
            await generateUniqueUserId(
                db
            );

        const now =
            Timestamp.now();

        /*
         * ====================================
         * Firestore
         * ====================================
         */

        const userRef =
            db
                .collection("users")
                .doc(userId);

        const uidMapRef =
            db
                .collection("uidMap")
                .doc(user.uid);

        const accountRef =
            db
                .collection("adminAccount")
                .doc(email);

        const batch =
            db.batch();

        /*
         * users
         */

        batch.set(
            userRef,
            {
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

                adminAccount: true,

                createdAt: now,
                updatedAt: now
            },
            {
                merge: true
            }
        );

        /*
         * uidMap
         */

        batch.set(
            uidMapRef,
            {
                userId
            },
            {
                merge: true
            }
        );

        /*
         * adminAccount
         */

        batch.set(
            accountRef,
            {
                email,
                uid: user.uid,
                userId,

                name,
                displayName,

                active: true,

                createdBy: user.uid,
                createdByEmail: email,
                createdByName: displayName,

                createdAt: now,
                updatedAt: now,

                adminModeDurationMinutes:
                    DEFAULT_ADMIN_MODE_MINUTES,

                historyId: null
            },
            {
                merge: true
            }
        );

        await batch.commit();

        /*
         * ====================================
         * 完了
         * ====================================
         */

        const finalUser =
            await userRef.get();

        const finalUidMap =
            await uidMapRef.get();

        const finalAdmin =
            await accountRef.get();

        if (!finalUser.exists) {
            throw new Error(
                "usersの作成確認に失敗しました。"
            );
        }

        if (!finalUidMap.exists) {
            throw new Error(
                "uidMapの作成確認に失敗しました。"
            );
        }

        if (!finalAdmin.exists) {
            throw new Error(
                "adminAccountの作成確認に失敗しました。"
            );
        }

        printCompleteInfo(
            projectId,
            user,
            userId,
            {
                name,
                displayName,
                birthday,
                gender,
                country,
                address,
                phone,
                role
            },
            false
        );

    } finally {
        rl.close();
    }
}

/*
 * ========================================
 * 完了表示
 * ========================================
 */

function printCompleteInfo(
    projectId,
    user,
    userId,
    userData,
    existing
) {
    console.log("");
    console.log(
        "========================================"
    );
    console.log(
        " 初期管理者の登録が完了しました"
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
        `Email:          ${user.email}`
    );
    console.log(
        `UID:            ${user.uid}`
    );
    console.log(
        `Email Verified: ${user.emailVerified}`
    );
    console.log("");

    console.log(
        "【LUNAGS User】"
    );
    console.log(
        `User ID:        ${userId}`
    );
    console.log(
        `Name:           ${userData.name || "-"}`
    );
    console.log(
        `Display Name:   ${userData.displayName || "-"}`
    );

    if (userData.birthday) {
        console.log(
            `Birthday:       ${userData.birthday}`
        );
    }

    if (userData.gender) {
        console.log(
            `Gender:         ${userData.gender}`
        );
    }

    if (userData.country) {
        console.log(
            `Country:        ${userData.country}`
        );
    }

    if (userData.role) {
        console.log(
            `Role:            ${userData.role}`
        );
    }

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
        `adminAccount/${user.email}`
    );
    console.log("");

    console.log(
        "管理者アカウント: active = true"
    );

    if (existing) {
        console.log(
            "既存Firebase Authenticationアカウントをそのまま管理者へ昇格しました。"
        );
    } else {
        console.log(
            "新規Firebase Authenticationアカウントを作成して管理者へ登録しました。"
        );
    }

    console.log("");
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
            " 初期管理者の登録に失敗しました"
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